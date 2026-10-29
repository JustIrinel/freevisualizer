'use strict';
// Claude assistant for FreeVisualizer: the page runs the tools on the open
// project, this module only talks to the Claude API with the user's key.
// The key is stored in <data>/assistant.json and is never sent to the page.

const fs = require('fs');
const path = require('path');
const { tr } = require('./i18n');

const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};
const DEFAULT_MODEL = 'claude-opus-5-5';
// Server-side refusal fallback ("default" picks the right model per refusal category).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const SYSTEM = `You are the assistant built into FreeVisualizer, a 3D lighting visualizer that DJs use with SoundSwitch (Art-Net / sACN). The user is a mobile event DJ (weddings, christenings, parties, corporate events) planning the lighting rig of a venue.

Your job: build and adjust the rig in the open project with the tools – add fixtures by name, place and aim them, move or remove them – and answer short questions about the rig.

How to work:
- Reply in the language the user writes in (usually Romanian). Keep answers short and practical.
- Before adding a fixture, call search_fixtures with the model name. Prefer an exact match from the project, then Open Fixture Library (ofl_key), then a generic profile of the same type.
- Before placing things relative to the room, the truss or other fixtures, call get_scene to read the current layout.
- DMX: the universe, start address and mode must match the DMX patch in SoundSwitch. If the user does not give them, use the next free addresses and the mode the user names (or the largest mode), and say which mode and addresses you used so they can match SoundSwitch.
- Coordinates are metres, viewed from the audience: x = left (−) / right (+), y = height, z = towards the audience (+) / towards the back wall and the DJ (−). The floor is y = 0.
- Rotations are degrees. A fixture standing on the floor (rotation 0,0,0) shines up; hanging under a truss is x = 180; x = 90 points it at the audience.
- Mobile DJs often put lights on tripod stands with a T-bar (objects of type "tripod") or on road cases (type "case"): use add_fixtures surface "stand" / "case" for those (and "totem" for light totems).
- Do what was asked, then say in one or two sentences what you changed. If something is ambiguous and getting it wrong would make a mess (for example deleting fixtures), ask first.

Scene objects (props): besides fixtures you can build the venue with add_props / update_props / remove_props and set_room. Types: truss (horizontal, params.length), column (vertical truss), totem (light totem: truss column with a base plate and a top plate for fixtures; params height 1–3.5 m, plate 0.3–0.8 m, cover 0 none / 1 white lycra / 2 black lycra), tripod (lighting stand with T-bar; params height, bar, legs), speakerstand (pole stand with a speaker on top; params height 1–2.4 m = speaker bottom, speaker 0/1, size 10/12/15 inch), speaker, sub, booth (DJ booth; params width, height, depth, dj 0/1 = DJ figure behind it, djLook 1 man / 2 woman), platform (stage riser), screen (LED screen), wall (backdrop), table (round guest table; params diameter, guests), headtable (bride and groom table), dancefloor, mirrorball, case (road case), crowd (dancing guests; params width, depth, count). Props stand on the floor at their position (y = 0) unless lifted; a truss position is its centre (typically y 3–4 m). A prop's front faces +z (the audience) at rotation y = 0: a booth with the DJ behind it at the back wall has rotation y = 0; speakers at the sides of the booth face +z. Put fixtures on a totem with add_fixtures surface "totem".

Recreate a setup from a photo: when the user sends a photo of a real venue or event setup, recreate its layout in the project, even if the equipment in the photo is not the user's.
1. Look at the photo carefully and estimate: the room type (banquet hall → style "banquet", club / dark room → "dark", empty or industrial room → "plain"), its approximate width, depth and height (use doors ≈ 2.1 m, people ≈ 1.7 m, tables ≈ 0.76 m as scale), and the floor finish (gloss / satin / matte).
2. Note where things are relative to the DJ: the DJ booth, the dance floor, the speakers (on pole stands → speakerstand, on the floor → speaker / sub), guest tables, trusses (horizontal or goalpost), totems, tripod stands, LED screens, backdrops.
3. Note which kinds of lights stand where: moving heads (beam / spot / wash), pars or uplights, retro / vintage lights, strobes, LED bars, hazers / fog, sparks, lasers, mirror ball.
4. Call get_scene to see what is already there. If the project already has fixtures or props that would be in the way, ASK the user whether to remove them before deleting anything (remove nothing without a yes).
5. Rebuild: set_room first, then add_props for the structure, then add_fixtures. Use the fixture profiles ALREADY in the project (get_scene lists them under "profiles") for each kind of light — for example the user's moving heads where the photo has moving heads, their pars where it has uplights, their retro lights where it has vintage lights, their hazer where there is haze — and only search Open Fixture Library or use a generic profile for kinds the user does not own. Use the next free DMX addresses (start_address null) and say which profiles and addresses you used.
6. Finish with a short summary of what you recreated and what you had to guess.`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const vec = (desc) => nullable({
  type: 'object', description: desc, additionalProperties: false, required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
});

// Scene tools are not strict: strict schemas share a budget of 16 nullable (union) parameters
// per request, and the fixture tools already use most of it. The page validates their input.
const point = (description) => ({
  type: 'object', description, additionalProperties: false, required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
});
const PROP_PARAMS = {
  length: { type: 'number', description: 'truss / column length (m)' },
  width: { type: 'number', description: 'm' },
  height: { type: 'number', description: 'm (tripod / totem: top height; speakerstand: speaker bottom; booth, case, speaker: body height)' },
  depth: { type: 'number', description: 'm' },
  diameter: { type: 'number', description: 'm (table, mirrorball)' },
  guests: { type: 'integer', description: 'guests seated at a table, 0–16' },
  count: { type: 'integer', description: 'crowd: number of guests' },
  bar: { type: 'number', description: 'tripod T-bar length (m), 0 = none' },
  legs: { type: 'number', description: 'tripod leg spread (m)' },
  plate: { type: 'number', description: 'totem plate size (m), 0.3–0.8' },
  cover: { type: 'integer', enum: [0, 1, 2], description: 'totem cover: 0 none, 1 white lycra, 2 black lycra' },
  speaker: { type: 'integer', enum: [0, 1], description: 'speakerstand: 1 = with speaker' },
  size: { type: 'integer', enum: [10, 12, 15], description: 'speakerstand speaker size (inch)' },
  dj: { type: 'integer', enum: [0, 1], description: 'booth: 1 = DJ figure behind it' },
  djLook: { type: 'integer', enum: [1, 2], description: 'booth DJ: 1 man, 2 woman' },
  wheels: { type: 'integer', enum: [0, 1], description: 'case: 1 with castors' },
};
const PROP_PARAM_KEYS = Object.keys(PROP_PARAMS);
const PROP_TYPE_IDS = ['truss', 'column', 'totem', 'tripod', 'speakerstand', 'speaker', 'sub', 'booth', 'platform', 'screen', 'wall', 'table', 'headtable', 'dancefloor', 'mirrorball', 'case', 'crowd'];
const propParams = (description) => ({ type: 'object', additionalProperties: false, properties: PROP_PARAMS, description });

// Photos sent with a message (Anthropic image blocks, base64).
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

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
    name: 'get_scene',
    strict: false,
    description: 'Current scene: the room (style, size, floor finish, colours), every scene object / prop (id, type, name, position, rotation, params, locked, group), every fixture (id, name, profile, kind, universe, address, channels, position, rotation) and the fixture profiles in the project (id, name, kind).',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'set_room',
    strict: false,
    description: 'Change the room. Only the given fields change.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        style: { type: 'string', enum: ['banquet', 'plain', 'dark'], description: 'banquet = event hall (wedding), plain = empty room, dark = club' },
        width: { type: 'number', description: 'Metres (x), 4–200' },
        depth: { type: 'number', description: 'Metres (z), 4–200' },
        height: { type: 'number', description: 'Metres, 2–40' },
        floor_finish: { type: 'string', enum: ['gloss', 'satin', 'matte'] },
        floor_color: { type: 'string', description: 'Hex colour, e.g. "#2b2725"' },
        wall_color: { type: 'string', description: 'Hex colour' },
      },
    },
  },
  {
    name: 'add_props',
    strict: false,
    description: 'Add scene objects (props): truss, column, totem, tripod, speakerstand, speaker, sub, booth, platform, screen, wall, table, headtable, dancefloor, mirrorball, case, crowd. Returns their ids.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['props'],
      properties: {
        props: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['type', 'position'],
            properties: {
              type: { type: 'string', enum: PROP_TYPE_IDS },
              name: { type: 'string' },
              position: point('Metres; y = 0 stands on the floor'),
              rotation: point('Degrees; default 0,0,0 (front faces the audience, +z)'),
              params: propParams('Type-specific parameters; leave out the ones that keep their default'),
            },
          },
        },
      },
    },
  },
  {
    name: 'update_props',
    strict: false,
    description: 'Move, rotate, rename or change parameters of scene objects. Locked objects (🔒) are skipped.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['props'],
      properties: {
        props: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['id'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              position: point('New absolute position (metres)'),
              rotation: point('New absolute rotation (degrees)'),
              params: propParams('Only the given values change'),
            },
          },
        },
      },
    },
  },
  {
    name: 'remove_props',
    strict: false,
    description: 'Delete scene objects (props). Locked objects are kept. Ask the user before removing things they did not ask to remove.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['ids'],
      properties: { ids: { type: 'array', items: { type: 'string' } } },
    },
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
            surface: { type: 'string', enum: ['truss', 'stand', 'case', 'totem', 'floor_front', 'floor_back_wall', 'left_wall', 'right_wall', 'booth', 'ceiling', 'position'], description: '"stand" = on the T-bars of the tripod stands, "case" = on top of the road cases, "totem" = on the top plates of the light totems (fixtures are spread over all of them, left to right)' },
            truss_id: nullable({ type: 'string', description: 'Target object id (from get_scene): which truss, tripod stand, case or totem; null = the main truss / all stands / all cases' }),
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

/** Photos must be base64 JPEG / PNG / WebP of at most 5 MB (throws a 400 in the page's language). */
function validateImages(messages, lang) {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (!b || b.type !== 'image') continue;
      const src = b.source || {};
      if (src.type !== 'base64' || typeof src.data !== 'string' || !IMAGE_TYPES.has(src.media_type)) {
        throw Object.assign(new Error(tr(lang, 'Poza trebuie să fie JPEG, PNG sau WebP.')), { status: 400 });
      }
      if (src.data.length > MAX_IMAGE_BASE64) throw Object.assign(new Error(tr(lang, 'Poza e prea mare (maxim 5 MB).')), { status: 400 });
    }
  }
}

/**
 * Request parameters for one turn. Prompt caching: the system prompt, and the last photo
 * of the conversation (so every tool step after a photo reads it from the cache).
 * The page's messages are not changed.
 */
function buildParams(model, messages) {
  let last = null;
  messages.forEach((m, i) => {
    if (Array.isArray(m.content)) m.content.forEach((b, j) => { if (b && b.type === 'image') last = [i, j]; });
  });
  const out = messages.map((m, i) => {
    if (!last || i !== last[0]) return m;
    return { ...m, content: m.content.map((b, j) => (j === last[1] ? { ...b, cache_control: { type: 'ephemeral' } } : b)) };
  });
  return {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS.map(({ strict, ...t }) => ({ ...t, strict: strict !== false })),
    tool_choice: { type: 'auto' },
    output_config: { effort: 'medium' },
    messages: out,
  };
}

function createAssistant(dataDir) {
  const file = path.join(dataDir, 'assistant.json');
  let cfg = { apiKey: '', model: DEFAULT_MODEL };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { /* not configured yet */ }
  const save = () => fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  const key = () => cfg.apiKey || process.env.ANTHROPIC_API_KEY || '';

  let sdk = null;
  async function loadSdk(lang) {
    if (!sdk) {
      try {
        const mod = await import('@anthropic-ai/sdk');
        sdk = mod.default || mod.Anthropic || mod;
      } catch (_) {
        throw Object.assign(new Error(tr(lang, 'Lipsește pachetul @anthropic-ai/sdk. Rulează „npm install” în folderul FreeVisualizer.')), { status: 500 });
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
  async function turn(messages, lang) {
    if (!key()) throw Object.assign(new Error(tr(lang, 'Adaugă cheia API Claude în Setări → Asistent.')), { status: 400 });
    if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error(tr(lang, 'Conversație goală')), { status: 400 });
    validateImages(messages, lang);
    const Anthropic = await loadSdk(lang);
    const client = new Anthropic({ apiKey: key() });
    const params = buildParams(cfg.model, messages);
    let response;
    try {
      response = FALLBACK_MODELS.has(cfg.model)
        ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error(tr(lang, 'Cheia API nu e validă. Verific-o în Setări → Asistent.')), { status: 401 });
      if (err instanceof Anthropic.PermissionDeniedError) throw Object.assign(new Error(tr(lang, 'Cheia API nu are acces la acest model.')), { status: 403 });
      if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error(tr(lang, 'Prea multe cereri deodată. Mai încearcă peste un minut.')), { status: 429 });
      if (err instanceof Anthropic.BadRequestError) throw Object.assign(new Error(tr(lang, 'Cerere respinsă de Claude: {err}', { err: err.message })), { status: 400 });
      if (err instanceof Anthropic.APIConnectionError) throw Object.assign(new Error(tr(lang, 'Nu mă pot conecta la Claude. Verifică internetul.')), { status: 502 });
      if (err instanceof Anthropic.APIError) throw Object.assign(new Error(tr(lang, 'Eroare Claude ({status}): {err}', { status: err.status, err: err.message })), { status: 502 });
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

module.exports = { createAssistant, TOOLS, SYSTEM, MODELS, cleanContent, buildParams, validateImages, PROP_TYPE_IDS, PROP_PARAM_KEYS };
