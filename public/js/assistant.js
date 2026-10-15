// "✨ Asistent": chat with Claude, who edits the open project through tools
// (search fixtures, read the rig, add / move / remove fixtures).
// The server holds the API key; this page runs the tools and the loop.
import { h, toast } from './dom.js';
import { KINDS, uid } from './profiles.js';
import { nextFreeAddress } from './project.js';
import { oflToProfile, listModes } from './ofl-import.js';
import { aimRotation } from './aim.js';

const MAX_STEPS = 14;
const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ tools
function matches(text, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

async function searchFixtures(app, { query }) {
  const describe = (p) => ({ profile_id: p.id, name: p.name, manufacturer: p.manufacturer || '', kind: p.kind, channels: p.channels.length });
  const q = String(query || '');
  const project = app.project.profiles.filter((p) => matches(`${p.manufacturer} ${p.name} ${KINDS[p.kind]}`, q)).slice(0, 10).map(describe);
  const builtin = app.builtins.filter((p) => matches(`${p.name} ${KINDS[p.kind]} ${p.kind}`, q)).slice(0, 8).map(describe);
  let ofl = [];
  let oflError = null;
  try {
    const res = await fetch(`/api/ofl/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'eroare');
    ofl = data.slice(0, 10).map((r) => ({ ofl_key: r.key, manufacturer: r.manufacturer, name: r.name }));
  } catch (err) { oflError = err.message; }
  // Retry with fewer words when nothing matched (e.g. "BeamZ Panther 60 LED Beam").
  if (!project.length && !ofl.length && q.split(/\s+/).length > 1) {
    const shorter = q.split(/\s+/).slice(0, -1).join(' ');
    const again = await searchFixtures(app, { query: shorter });
    return { ...again, note: `Nimic pentru „${q}”; rezultate pentru „${shorter}”.` };
  }
  return { project, builtin, ofl, ...(oflError ? { ofl_error: oflError } : {}) };
}

function getRig(app) {
  const p = app.project;
  return {
    room: { width: p.room.width, depth: p.room.depth, height: p.room.height, style: p.room.style || 'dark', back_wall_z: -p.room.depth / 2 },
    fixtures: p.fixtures.map((f) => {
      const prof = app.profile(f.profileId);
      return {
        id: f.id, name: f.name, profile: `${prof.manufacturer ? `${prof.manufacturer} ` : ''}${prof.name}`, kind: prof.kind,
        universe: f.universe, address: f.address, channels: prof.channels.length,
        position: f.position, rotation: f.rotation,
      };
    }),
    objects: p.props.map((o) => ({ id: o.id, type: o.type, name: o.name, position: o.position, rotation: o.rotation, params: o.params })),
  };
}

/** Profile from a project/builtin id or an OFL key (+ mode by name or channel count). */
async function resolveProfile(app, { profile_id: profileId, ofl_key: oflKey, mode }) {
  if (profileId) {
    const p = app.profilesById[profileId];
    if (!p) throw new Error(`Profilul ${profileId} nu există. Folosește search_fixtures.`);
    return p;
  }
  if (!oflKey) throw new Error('Dă profile_id sau ofl_key (din search_fixtures).');
  const res = await fetch(`/api/ofl/fixture?key=${encodeURIComponent(oflKey)}`);
  const fixture = await res.json();
  if (!res.ok) throw new Error(fixture.error || 'nu pot descărca fixtura');
  const modes = listModes(fixture);
  if (!modes.length) throw new Error('Fixtura nu are moduri DMX.');
  let chosen = modes.reduce((best, m) => (m.channels > best.channels ? m : best), modes[0]);
  if (mode) {
    const want = String(mode).toLowerCase();
    const count = Number((/(\d+)/.exec(want) || [])[1]);
    chosen = modes.find((m) => m.name.toLowerCase() === want)
      || modes.find((m) => m.name.toLowerCase().includes(want))
      || (count ? modes.find((m) => m.channels === count) : null)
      || chosen;
  }
  const profile = oflToProfile(fixture, chosen.index, oflKey);
  const existing = app.project.profiles.find((p) => p.id === profile.id);
  return existing || app.saveProfile(profile);
}

function mainTruss(app, id) {
  const trusses = app.project.props.filter((o) => o.type === 'truss');
  if (id) return trusses.find((t) => t.id === id || t.name === id) || null;
  return trusses.filter((t) => Math.abs(t.rotation?.z || 0) < 10).sort((a, b) => b.position.y - a.position.y)[0] || trusses[0] || null;
}

function spread(n, center, half) {
  if (n <= 1) return [center];
  return Array.from({ length: n }, (_, i) => center - half + (2 * half * i) / (n - 1));
}

/** Positions and rotations for n fixtures on a surface of the room. */
export function placementFor(app, n, placement) {
  const room = app.project.room;
  const w = room.width; const d = room.depth; const hgt = room.height;
  const { surface, spacing } = placement;
  const pos = placement.position;
  const line = (center, half) => {
    if (spacing && n > 1) return spread(n, pos ? pos.x + (spacing * (n - 1)) / 2 : center, (spacing * (n - 1)) / 2);
    return spread(n, pos ? pos.x : center, half);
  };
  const v = (x, y, z) => ({ x: r2(x), y: r2(y), z: r2(z) });
  const booth = app.project.props.find((o) => o.type === 'booth');
  switch (surface) {
    case 'truss': {
      const t = mainTruss(app, placement.truss_id);
      if (!t) throw new Error('Nu există truss în scenă. Folosește alt surface.');
      const half = ((t.params?.length || 6) / 2) * 0.85;
      return line(t.position.x, half).map((x) => ({ position: v(x, t.position.y - 0.17, t.position.z), rotation: { x: 180, y: 0, z: 0 } }));
    }
    case 'floor_back_wall':
      return line(0, Math.min(w / 2 - 1.5, Math.max(2, n * 1.2))).map((x) => ({ position: v(x, 0, -d / 2 + 0.4), rotation: { x: -12, y: 0, z: 0 } }));
    case 'left_wall': case 'right_wall': {
      const side = surface === 'left_wall' ? -1 : 1;
      const zs = spacing && n > 1 ? spread(n, pos ? pos.z : 0, (spacing * (n - 1)) / 2) : spread(n, 0, d / 2 - 2.5);
      return zs.map((z) => ({ position: v(side * (w / 2 - 0.4), 0, z), rotation: { x: 0, y: 0, z: side * -14 } }));
    }
    case 'booth': {
      const bx = booth ? booth.position.x : 0; const bz = booth ? booth.position.z : -d / 2 + 1.8;
      const top = booth ? (booth.params?.height || 1.1) + 0.04 : 1.1;
      const half = booth ? (booth.params?.width || 2) / 2 - 0.25 : 0.8;
      return line(bx, half).map((x) => ({ position: v(x, top, bz), rotation: { x: 0, y: 0, z: 0 } }));
    }
    case 'ceiling':
      return line(0, Math.min(w / 2 - 2, Math.max(2, n))).map((x) => ({ position: v(x, hgt - 0.3, pos ? pos.z : -d / 6), rotation: { x: 180, y: 0, z: 0 } }));
    case 'position': {
      const p0 = pos || { x: 0, y: 0, z: 0 };
      const step = spacing || 1;
      return Array.from({ length: n }, (_, i) => ({ position: v(p0.x + i * step, p0.y, p0.z), rotation: p0.y > 2 ? { x: 180, y: 0, z: 0 } : { x: 0, y: 0, z: 0 } }));
    }
    default: { // floor_front: a row on the floor in front of the DJ booth
      const z = booth ? booth.position.z + 1.3 : -d / 2 + 3;
      return line(0, Math.min(w / 2 - 1.5, Math.max(1.5, n * 0.9))).map((x) => ({ position: v(x, 0, z), rotation: { x: 0, y: 0, z: 0 } }));
    }
  }
}

async function addFixtures(app, input) {
  const profile = await resolveProfile(app, input);
  const n = Math.max(1, Math.min(64, input.quantity || 1));
  const ch = profile.channels.length;
  const lastU = app.project.fixtures.length ? Math.max(...app.project.fixtures.map((f) => f.universe)) : 1;
  let u = input.universe || lastU;
  let a = input.start_address || nextFreeAddress(app.project, app.profilesById, u, ch * n) || nextFreeAddress(app.project, app.profilesById, u, ch) || 1;
  const spots = placementFor(app, n, input.placement || { surface: 'floor_front' });
  const prefix = input.name_prefix || profile.name.replace(/\s*\(.*\)$/, '');
  const names = app.project.fixtures.map((f) => f.name);
  const list = [];
  for (let i = 0; i < n; i++) {
    if (a + ch - 1 > 512) { u += 1; a = 1; }
    let name = `${prefix} ${i + 1}`;
    for (let k = 2; names.includes(name); k++) name = `${prefix} ${i + k}`;
    names.push(name);
    list.push({ id: uid('fx'), name, profileId: profile.id, universe: u, address: a, position: spots[i].position, rotation: spots[i].rotation, invertPan: false, invertTilt: false });
    a += ch;
  }
  app.addFixtures(list);
  // Tell Claude about DMX overlaps so it can warn the user or re-address.
  const conflicts = app.conflicts();
  const clash = app.project.fixtures.filter((f) => conflicts.has(f.id) && !list.some((x) => x.id === f.id)).map((f) => `${f.name} (U${f.universe}.${f.address})`);
  return {
    added: list.map((f) => ({ id: f.id, name: f.name, universe: f.universe, address: f.address, position: f.position })),
    profile: `${profile.manufacturer ? `${profile.manufacturer} ` : ''}${profile.name}`, channels_per_fixture: ch,
    ...(clash.length ? { warning: `DMX addresses overlap with: ${clash.join(', ')}. Tell the user, or change the addresses if they did not ask for these.` } : {}),
  };
}

function idsFrom(app, list) {
  const out = [];
  const missing = [];
  for (const x of list || []) {
    const f = app.project.fixtures.find((it) => it.id === x) || app.project.fixtures.find((it) => it.name === x);
    if (f) out.push(f.id); else missing.push(x);
  }
  if (!out.length) throw new Error(`Nu găsesc fixturile: ${missing.join(', ')}. Folosește id-urile din get_rig.`);
  return { ids: out, missing };
}

function moveFixtures(app, input) {
  const { ids, missing } = idsFrom(app, input.fixture_ids);
  const target = input.aim_at;
  app.updateItems(ids, (it) => {
    const patch = {};
    let pos = { ...it.position };
    if (input.set_position) pos = { ...input.set_position };
    if (input.move_by) pos = { x: pos.x + input.move_by.x, y: pos.y + input.move_by.y, z: pos.z + input.move_by.z };
    patch.position = { x: r2(pos.x), y: r2(Math.max(0, pos.y)), z: r2(pos.z) };
    let rot = { ...it.rotation };
    if (input.set_rotation) rot = { ...input.set_rotation };
    if (input.rotate_by) rot = { x: rot.x + input.rotate_by.x, y: rot.y + input.rotate_by.y, z: rot.z + input.rotate_by.z };
    if (target) rot = aimRotation(patch.position, target);
    patch.rotation = { x: Math.round(rot.x), y: Math.round(rot.y), z: Math.round(rot.z) };
    return patch;
  });
  return { moved: ids.length, ...(missing.length ? { not_found: missing } : {}) };
}

function removeFixtures(app, input) {
  const { ids, missing } = idsFrom(app, input.fixture_ids);
  app.removeItems(ids);
  return { removed: ids.length, ...(missing.length ? { not_found: missing } : {}) };
}

export async function runTool(app, name, input) {
  switch (name) {
    case 'search_fixtures': return searchFixtures(app, input);
    case 'get_rig': return getRig(app);
    case 'add_fixtures': return addFixtures(app, input);
    case 'move_fixtures': return moveFixtures(app, input);
    case 'remove_fixtures': return removeFixtures(app, input);
    default: throw new Error(`Instrument necunoscut: ${name}`);
  }
}

const TOOL_LABEL = {
  search_fixtures: (i) => `🔎 Caut „${i.query}”`,
  get_rig: () => '📋 Citesc rigul',
  add_fixtures: (i) => `➕ Adaug ${i.quantity} fixturi`,
  move_fixtures: (i) => `↔ Mut / rotesc ${(i.fixture_ids || []).length} fixturi`,
  remove_fixtures: (i) => `🗑 Șterg ${(i.fixture_ids || []).length} fixturi`,
};

// ------------------------------------------------------------------ panel
export class AssistantPanel {
  constructor(app) {
    this.app = app;
    this.messages = [];
    this.busy = false;
    this.el = document.getElementById('assistantPanel');
    this.log = this.el.querySelector('.as-log');
    this.input = this.el.querySelector('textarea');
    this.sendBtn = this.el.querySelector('.as-send');
    this.setup = this.el.querySelector('.as-setup');
    this.el.querySelector('.as-close').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.as-new').addEventListener('click', () => this.reset());
    this.sendBtn.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger the app shortcuts
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  async toggle(force) {
    const open = force ?? this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !open);
    document.getElementById('assistantBtn')?.classList.toggle('active', open);
    if (open) {
      await this.refreshStatus();
      setTimeout(() => this.input.focus(), 50);
    }
  }

  async refreshStatus() {
    try {
      this.status = await (await fetch('/api/assistant/status')).json();
    } catch (_) {
      this.status = { configured: false, models: {} };
    }
    this.setup.innerHTML = '';
    if (!this.status.configured) this.setup.append(setupForm(this));
    this.setup.classList.toggle('hidden', !!this.status.configured);
    if (!this.log.children.length && this.status.configured) {
      this.bubble('assistant', 'Salut! Spune-mi ce să adaug sau să mut. De exemplu: „Pune 4 BeamZ Panther 60 pe truss, de la adresa 200” sau „Adaugă 6 par-uri RGBW pe peretele din spate”.');
    }
  }

  reset() {
    this.messages = [];
    this.log.innerHTML = '';
    this.refreshStatus();
  }

  bubble(role, text) {
    const b = h('div', { class: `as-msg as-${role}` });
    b.textContent = text;
    this.log.append(b);
    this.log.scrollTop = this.log.scrollHeight;
    return b;
  }

  note(text, cls = '') {
    const n = h('div', { class: `as-note ${cls}` }, text);
    this.log.append(n);
    this.log.scrollTop = this.log.scrollHeight;
    return n;
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    if (!this.status?.configured) { toast('Adaugă întâi cheia API Claude.', 'error'); return; }
    this.input.value = '';
    this.bubble('user', text);
    const startLen = this.messages.length;
    this.messages.push({ role: 'user', content: text });
    this.busy = true;
    this.sendBtn.disabled = true;
    const thinking = this.note('Claude lucrează…', 'as-wait');
    // Everything Claude changes in this message is one undo step.
    this.app.beginBatch();
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: this.messages }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.stop_reason === 'refusal') {
          this.messages.length = startLen;
          this.note('Claude a refuzat această cerere. Reformulează, te rog.', 'as-error');
          break;
        }
        // Keep the assistant turn exactly as returned (thinking blocks included).
        this.messages.push({ role: 'assistant', content: data.content });
        for (const b of data.content) if (b.type === 'text' && b.text.trim()) this.bubble('assistant', b.text.trim());
        const calls = data.content.filter((b) => b.type === 'tool_use');
        if (data.stop_reason === 'max_tokens') this.note('Răspunsul a fost tăiat (prea lung).', 'as-error');
        if (!calls.length) break;
        const results = [];
        for (const call of calls) {
          const label = (TOOL_LABEL[call.name] || ((x) => x))(call.input || {});
          const line = this.note(label, 'as-tool');
          try {
            const out = await runTool(this.app, call.name, call.input || {});
            results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out) });
          } catch (err) {
            line.classList.add('as-error');
            line.textContent = `${label} – ${err.message}`;
            results.push({ type: 'tool_result', tool_use_id: call.id, content: err.message, is_error: true });
          }
        }
        // All results of this turn go back in one message.
        this.messages.push({ role: 'user', content: results });
        if (step === MAX_STEPS - 1) this.note('M-am oprit după prea mulți pași. Spune-mi dacă să continui.', 'as-error');
      }
    } catch (err) {
      // Drop this exchange so the history stays valid for the next message.
      this.messages.length = startLen;
      this.note(err.message, 'as-error');
    } finally {
      thinking.remove();
      this.app.endBatch();
      this.busy = false;
      this.sendBtn.disabled = false;
    }
  }
}

function setupForm(panel) {
  const key = h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' });
  const model = h('select', {}, Object.entries(panel.status.models || {}).map(([id, label]) => h('option', { value: id, selected: id === panel.status.model }, label)));
  const save = h('button', { class: 'primary', onclick: async () => {
    const res = await fetch('/api/assistant/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key.value, model: model.value }) });
    if (res.ok) { toast('Cheia a fost salvată pe acest calculator.'); panel.refreshStatus(); }
  } }, 'Salvează');
  for (const el of [key]) el.addEventListener('keydown', (e) => e.stopPropagation());
  return h('div', { class: 'form' },
    h('p', { class: 'small' }, 'Asistentul folosește Claude cu cheia ta API (plătești direct la Anthropic, după consum). Cheia rămâne doar pe acest calculator.'),
    h('label', {}, 'Cheie API Claude', key),
    h('label', {}, 'Model', model),
    h('div', { class: 'row' }, save, h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener', class: 'small' }, 'Obține o cheie ↗')));
}

export { setupForm };
