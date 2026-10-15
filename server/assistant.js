'use strict';
// Claude assistant for FreeVisualizer: the page runs the tools on the open
// project, this module only talks to the Claude API with the user's key.
// The key is stored in <data>/assistant.json and is never sent to the page.

const fs = require('fs');
const path = require('path');

const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};
const DEFAULT_MODEL = 'claude-opus-5-5';
// Server-side refusal fallback ("default" picks the right model per refusal category).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const SYSTEM = `You are the assistant built into FreeVisualizer, a free 3D lighting visualizer that DJs use with SoundSwitch (Art-Net / sACN). The user is a mobile event DJ (weddings, christenings, parties, corporate events) planning the lighting rig of a venue.

Your job: build and adjust the rig in the open project with the tools – add fixtures by name, place and aim them, move or remove them – and answer short questions about the rig.

How to work:
- Reply in the language the user writes in (usually Romanian). Keep answers short and practical.
- Before adding a fixture, call search_fixtures with the model name. Prefer an exact match from the project, then Open Fixture Library (ofl_key), then a generic profile of the same type.
- Before placing things relative to the room, the truss or other fixtures, call get_rig to read the current layout.
- DMX: the universe, start address and mode must match the DMX patch in SoundSwitch. If the user does not give them, use the next free addresses and the mode the user names (or the largest mode), and say which mode and addresses you used so they can match SoundSwitch.
- Coordinates are metres, viewed from the audience: x = left (−) / right (+), y = height, z = towards the audience (+) / towards the back wall and the DJ (−). The floor is y = 0.
- Rotations are degrees. A fixture standing on the floor (rotation 0,0,0) shines up; hanging under a truss is x = 180; x = 90 points it at the audience.
- Do what was asked, then say in one or two sentences what you changed. If something is ambiguous and getting it wrong would make a mess (for example deleting fixtures), ask first.`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const vec = (desc) => nullable({
  type: 'object', description: desc, additionalProperties: false, required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
});

const TOOLS = [
  {
    name: 'search_fixtures',
    description: 'Search fixture profiles by model or manufacturer name: profiles already in the project, built-in generic profiles and the Open Fixture Library. Returns ids / OFL keys to use with add_fixtures.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['query'],
      properties: { query: { type: 'string', description: 'Model and/or manufacturer, e.g. "BeamZ Panther 60" or "par rgbw"' } },
    },
  },
  {
    name: 'get_rig',
    description: 'Current rig: every fixture (id, name, profile, kind, universe, address, channels, position, rotation), the room size and the trusses, DJ booth, dance floor and other scene objects.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
  {
    name: 'add_fixtures',
    description: 'Add one or more fixtures of the same profile and place them. Give profile_id (from search_fixtures, source project/builtin) or ofl_key (source ofl).',
    input_schema: {
      type: 'object', additionalProperties: false,
      required: ['profile_id', 'ofl_key', 'mode', 'quantity', 'name_prefix', 'universe', 'start_address', 'placement'],
      properties: {
        profile_id: nullable({ type: 'string' }),
        ofl_key: nullable({ type: 'string', description: 'Open Fixture Library key, e.g. "chauvet-dj/intimidator-spot-260"' }),
        mode: nullable({ type: 'string', description: 'DMX mode name or channel count (e.g. "14ch"); null = largest mode' }),
        quantity: { type: 'integer' },
        name_prefix: nullable({ type: 'string', description: 'Names become "<prefix> 1", "<prefix> 2"…' }),
        universe: nullable({ type: 'integer' }),
        start_address: nullable({ type: 'integer', description: 'null = next free block' }),
        placement: {
          type: 'object', additionalProperties: false, required: ['surface', 'truss_id', 'position', 'spacing'],
          properties: {
            surface: { type: 'string', enum: ['truss', 'floor_front', 'floor_back_wall', 'left_wall', 'right_wall', 'booth', 'ceiling', 'position'] },
            truss_id: nullable({ type: 'string', description: 'Which truss (from get_rig); null = the main truss' }),
            position: vec('Start point for surface "position" (or to override the default start)'),
            spacing: nullable({ type: 'number', description: 'Metres between fixtures; null = spread evenly' }),
          },
        },
      },
    },
  },
  {
    name: 'move_fixtures',
    description: 'Move, rotate or aim fixtures. All given changes apply to every listed fixture.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['fixture_ids', 'move_by', 'set_position', 'rotate_by', 'set_rotation', 'aim_at'],
      properties: {
        fixture_ids: { type: 'array', items: { type: 'string' } },
        move_by: vec('Relative move in metres'),
        set_position: vec('Absolute position in metres'),
        rotate_by: vec('Relative rotation in degrees'),
        set_rotation: vec('Absolute rotation in degrees'),
        aim_at: vec('Point the beams at this point (metres)'),
      },
    },
  },
  {
    name: 'remove_fixtures',
    description: 'Delete fixtures from the project.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['fixture_ids'],
      properties: { fixture_ids: { type: 'array', items: { type: 'string' } } },
    },
  },
];

/** After a mid-output refusal fallback, drop model-internal blocks that came before the last fallback marker. */
function cleanContent(content) {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  if (last < 0) return content;
  return content.filter((b, i) => i > last || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

function createAssistant(dataDir) {
  const file = path.join(dataDir, 'assistant.json');
  let cfg = { apiKey: '', model: DEFAULT_MODEL };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { /* not configured yet */ }
  const save = () => fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  const key = () => cfg.apiKey || process.env.ANTHROPIC_API_KEY || '';

  let sdk = null;
  async function loadSdk() {
    if (!sdk) {
      try {
        const mod = await import('@anthropic-ai/sdk');
        sdk = mod.default || mod.Anthropic || mod;
      } catch (_) {
        throw Object.assign(new Error('Lipsește pachetul @anthropic-ai/sdk. Rulează „npm install” în folderul FreeVisualizer.'), { status: 500 });
      }
    }
    return sdk;
  }

  /** Public view of the configuration (never the key). */
  function status() {
    return { configured: !!key(), source: cfg.apiKey ? 'settings' : process.env.ANTHROPIC_API_KEY ? 'env' : null, model: cfg.model, models: MODELS };
  }

  function configure(body) {
    if (typeof body.apiKey === 'string') cfg.apiKey = body.apiKey.trim();
    if (body.model && MODELS[body.model]) cfg.model = body.model;
    save();
    return status();
  }

  /** One turn of the conversation; the page sends the full history (append-only). */
  async function turn(messages) {
    if (!key()) throw Object.assign(new Error('Adaugă cheia API Claude în Setări → Asistent.'), { status: 400 });
    if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('Conversație goală'), { status: 400 });
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey: key() });
    const params = {
      model: cfg.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS.map((t) => ({ ...t, strict: true })),
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      messages,
    };
    let response;
    try {
      response = FALLBACK_MODELS.has(cfg.model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('Cheia API nu e validă. Verific-o în Setări → Asistent.'), { status: 401 });
      if (err instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error('Cheia API nu are acces la acest model.'), { status: 403 });
      if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Prea multe cereri deodată. Mai încearcă peste un minut.'), { status: 429 });
      if (err instanceof Anthropic.BadRequestError) throw Object.assign(new Error(`Cerere respinsă de Claude: ${err.message}`), { status: 400 });
      if (err instanceof Anthropic.APIConnectionError) throw Object.assign(new Error('Nu mă pot conecta la Claude. Verifică internetul.'), { status: 502 });
      if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`Eroare Claude (${err.status}): ${err.message}`), { status: 502 });
      throw err;
    }
    return {
      content: cleanContent(response.content),
      stop_reason: response.stop_reason,
      stop_details: response.stop_details || null,
      model: response.model,
      usage: response.usage,
    };
  }

  return { status, configure, turn };
}

module.exports = { createAssistant, TOOLS, SYSTEM, MODELS, cleanContent };
