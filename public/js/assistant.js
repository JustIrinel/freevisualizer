// "✨ Asistent": chat with Claude, who edits the open project through tools
// (search fixtures, read the scene, add / move / remove fixtures and scene objects,
// change the room) and can recreate a setup from a photo of a real venue.
// The server holds the API key; this page runs the tools and the loop.
import { h, toast } from './dom.js';
import { KINDS, uid } from './profiles.js';
import { nextFreeAddress } from './project.js';
import { oflToProfile, listModes } from './ofl-import.js';
import { aimRotation } from './aim.js';
import { tripodParams, tripodMount, caseMount, spreadOver, totemParams, totemMount } from './prop-layout.js';
import { tr, tp } from './i18n.js';

const MAX_STEPS = 20;
const MAX_PHOTOS = 3;
const PHOTO_EDGE = 1568; // longest side sent to Claude (bigger photos are scaled down by the API anyway)

/** Photo file → downscaled JPEG for an Anthropic image block ({ media_type, data, url }). */
export async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { media_type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), url };
}
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
        position: f.position, rotation: f.rotation, ...(f.locked ? { locked: true } : {}),
      };
    }),
    objects: p.props.map((o) => ({ id: o.id, type: o.type, name: o.name, position: o.position, rotation: o.rotation, params: o.params })),
  };
}

/** get_scene: get_rig + the room in full, props with lock / group, and the profiles the user owns. */
function getScene(app) {
  const p = app.project;
  const rig = getRig(app);
  const used = new Set(p.fixtures.map((f) => f.profileId));
  const profiles = [...p.profiles, ...app.builtins.filter((b) => used.has(b.id))].map((pr) => ({
    profile_id: pr.id, name: `${pr.manufacturer ? `${pr.manufacturer} ` : ''}${pr.name}`, kind: pr.kind, channels: pr.channels.length,
    in_use: p.fixtures.filter((f) => f.profileId === pr.id).length,
  }));
  return {
    room: {
      style: p.room.style || 'dark', width: p.room.width, depth: p.room.depth, height: p.room.height,
      floor_finish: p.room.floorFinish || 'satin', floor_color: p.room.floorColor, wall_color: p.room.wallColor,
      walls: p.room.walls !== false, back_wall_z: -p.room.depth / 2,
    },
    props: p.props.map((o) => ({
      id: o.id, type: o.type, name: o.name, position: o.position, rotation: o.rotation, params: o.params,
      ...(o.locked ? { locked: true } : {}), ...(o.groupId ? { group: o.groupId } : {}),
    })),
    fixtures: rig.fixtures,
    profiles,
  };
}

// ------------------------------------------------------------------ scene tools
const ROOM_STYLES = ['banquet', 'plain', 'dark'];
const FINISHES = ['gloss', 'satin', 'matte'];
const HEX = /^#[0-9a-f]{6}$/i;
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function setRoom(app, input) {
  const patch = {};
  if (input.style != null) {
    if (!ROOM_STYLES.includes(input.style)) throw new Error(`style must be one of ${ROOM_STYLES.join(', ')}`);
    patch.style = input.style;
  }
  if (isNum(input.width)) patch.width = r2(clampNum(input.width, 4, 200));
  if (isNum(input.depth)) patch.depth = r2(clampNum(input.depth, 4, 200));
  if (isNum(input.height)) patch.height = r2(clampNum(input.height, 2, 40));
  if (input.floor_finish != null) {
    if (!FINISHES.includes(input.floor_finish)) throw new Error(`floor_finish must be one of ${FINISHES.join(', ')}`);
    patch.floorFinish = input.floor_finish;
  }
  if (input.floor_color != null && HEX.test(input.floor_color)) patch.floorColor = input.floor_color;
  if (input.wall_color != null && HEX.test(input.wall_color)) patch.wallColor = input.wall_color;
  if (!Object.keys(patch).length) throw new Error('Nothing to change: give style, width, depth, height, floor_finish, floor_color or wall_color.');
  app.updateRoom(patch);
  return { room: getScene(app).room };
}

async function propTypes(app) {
  return app.propTypes || (await import('./props3d.js')).PROP_TYPES;
}

const vec3 = (v, fallback) => (v && isNum(v.x) && isNum(v.y) && isNum(v.z) ? { x: r2(v.x), y: r2(v.y), z: r2(v.z) } : fallback);

/** Only the parameters this prop type has, as numbers, within its limits. */
function cleanParams(def, params, ignored) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    if (!(k in (def.params || {})) || !isNum(Number(v))) { ignored.push(k); continue; }
    let n = Number(v);
    const lim = def.limits && def.limits[k];
    if (lim) n = clampNum(n, lim[0], lim[1]);
    const choices = def.choices && def.choices[k];
    if (choices && !choices.some(([c]) => Number(c) === n)) { ignored.push(k); continue; }
    out[k] = r2(n);
  }
  return out;
}

async function addProps(app, input) {
  const types = await propTypes(app);
  const list = input.props || [];
  if (!list.length) throw new Error('props is empty.');
  const unknown = list.filter((x) => !types[x.type]).map((x) => x.type);
  if (unknown.length) throw new Error(`Unknown prop type(s): ${unknown.join(', ')}. Known: ${Object.keys(types).join(', ')}.`);
  app.checkpoint();
  const added = [];
  const ignored = [];
  for (const x of list) {
    const def = types[x.type];
    const prop = {
      id: uid('pr'), type: x.type, name: (x.name && String(x.name).trim()) || def.label,
      position: vec3(x.position, { x: 0, y: 0, z: 0 }),
      rotation: vec3(x.rotation, { x: 0, y: 0, z: 0 }),
      params: { ...def.params, ...cleanParams(def, x.params, ignored) },
    };
    prop.position.y = Math.max(0, prop.position.y);
    app.project.props.push(prop);
    app.vis.addProp(prop);
    added.push({ id: prop.id, type: prop.type, name: prop.name, position: prop.position });
  }
  app.saveSoon();
  return { added, ...(ignored.length ? { ignored_params: [...new Set(ignored)] } : {}) };
}

function findProp(app, ref) {
  return app.project.props.find((o) => o.id === ref) || app.project.props.find((o) => o.name === ref) || null;
}

async function updateProps(app, input) {
  const types = await propTypes(app);
  const done = []; const locked = []; const missing = []; const ignored = [];
  for (const x of input.props || []) {
    const prop = findProp(app, x.id);
    if (!prop) { missing.push(x.id); continue; }
    if (prop.locked) { locked.push(prop.id); continue; }
    const def = types[prop.type] || { params: prop.params || {} };
    const patch = {};
    const pos = vec3(x.position, null);
    if (pos) patch.position = { ...pos, y: Math.max(0, pos.y) };
    const rot = vec3(x.rotation, null);
    if (rot) patch.rotation = rot;
    if (x.name && String(x.name).trim()) patch.name = String(x.name).trim();
    const params = cleanParams(def, x.params, ignored);
    if (Object.keys(params).length) patch.params = { ...prop.params, ...params };
    if (!Object.keys(patch).length) continue;
    app.updateItems([prop.id], () => patch, { rebuild: !!patch.params });
    done.push(prop.id);
  }
  if (!done.length && !locked.length) throw new Error(missing.length ? `Props not found: ${missing.join(', ')}. Use the ids from get_scene.` : 'Nothing to change.');
  return {
    updated: done.length,
    ...(locked.length ? { locked_not_changed: locked } : {}),
    ...(missing.length ? { not_found: missing } : {}),
    ...(ignored.length ? { ignored_params: [...new Set(ignored)] } : {}),
  };
}

function removeProps(app, input) {
  const ids = []; const missing = [];
  for (const ref of input.ids || []) {
    const prop = findProp(app, ref);
    if (prop) ids.push(prop.id); else missing.push(ref);
  }
  if (!ids.length) throw new Error(`Props not found: ${missing.join(', ')}. Use the ids from get_scene (remove_fixtures deletes fixtures).`);
  const locked = ids.filter((id) => app.isLocked(id));
  const free = ids.filter((id) => !app.isLocked(id));
  if (!free.length) throw new Error('These objects are locked by the user (🔒). Ask the user to unlock them first.');
  app.removeItems(free);
  return { removed: free.length, ...(locked.length ? { locked_not_removed: locked } : {}), ...(missing.length ? { not_found: missing } : {}) };
}

/** Profile from a project/builtin id or an OFL key (+ mode by name or channel count). */
async function resolveProfile(app, { profile_id: profileId, ofl_key: oflKey, mode }) {
  if (profileId) {
    const p = app.profilesById[profileId];
    if (!p) throw new Error(tr('Profilul {id} nu există. Folosește search_fixtures.', { id: profileId }));
    return p;
  }
  if (!oflKey) throw new Error(tr('Dă profile_id sau ofl_key (din search_fixtures).'));
  const res = await fetch(`/api/ofl/fixture?key=${encodeURIComponent(oflKey)}`);
  const fixture = await res.json();
  if (!res.ok) throw new Error(fixture.error || tr('nu pot descărca fixtura'));
  const modes = listModes(fixture);
  if (!modes.length) throw new Error(tr('Fixtura nu are moduri DMX.'));
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
      if (!t) throw new Error(tr('Nu există truss în scenă. Folosește alt surface.'));
      const half = ((t.params?.length || 6) / 2) * 0.85;
      return line(t.position.x, half).map((x) => ({ position: v(x, t.position.y - 0.17, t.position.z), rotation: { x: 180, y: 0, z: 0 } }));
    }
    case 'stand': case 'case': case 'totem': {
      // Spread over the tripods / cases / totems (or only the one named in truss_id), left to right.
      const type = surface === 'stand' ? 'tripod' : surface;
      let targets = app.project.props.filter((o) => o.type === type);
      if (placement.truss_id) targets = targets.filter((o) => o.id === placement.truss_id || o.name === placement.truss_id);
      if (!targets.length) {
        throw new Error(surface === 'stand' ? tr('Nu există stative trepied în scenă. Adaugă unul sau folosește alt surface.')
          : surface === 'totem' ? tr('Nu există totemuri în scenă. Adaugă unul (add_props, type totem) sau folosește alt surface.')
            : tr('Nu există caseuri în scenă. Adaugă unul sau folosește alt surface.'));
      }
      const lengthOf = (o) => (surface === 'stand' ? tripodParams(o.params).bar
        : surface === 'totem' ? Math.max(0, totemParams(o.params).plate - 0.24)
          : Math.max(0, (o.params?.width || 1.2) - 0.3));
      const mount = surface === 'stand' ? tripodMount : surface === 'totem' ? totemMount : caseMount;
      return spreadOver(targets, n, lengthOf).map(({ target, offset }) => mount(target, offset));
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
  if (!out.length) throw new Error(tr('Nu găsesc fixturile: {list}. Folosește id-urile din get_scene.', { list: missing.join(', ') }));
  return { ids: out, missing };
}

function moveFixtures(app, input) {
  const found = idsFrom(app, input.fixture_ids);
  const missing = found.missing;
  const locked = found.ids.filter((id) => app.isLocked(id));
  const ids = found.ids.filter((id) => !app.isLocked(id));
  if (!ids.length) throw new Error('These fixtures are locked by the user (🔒). Ask the user to unlock them first.');
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
  return { moved: ids.length, ...(missing.length ? { not_found: missing } : {}), ...(locked.length ? { locked_not_moved: locked } : {}) };
}

function removeFixtures(app, input) {
  const found = idsFrom(app, input.fixture_ids);
  const locked = found.ids.filter((id) => app.isLocked(id));
  const ids = found.ids.filter((id) => !app.isLocked(id));
  if (!ids.length) throw new Error('These fixtures are locked by the user (🔒). Ask the user to unlock them first.');
  app.removeItems(ids);
  return { removed: ids.length, ...(found.missing.length ? { not_found: found.missing } : {}), ...(locked.length ? { locked_not_removed: locked } : {}) };
}

export async function runTool(app, name, input) {
  switch (name) {
    case 'search_fixtures': return searchFixtures(app, input);
    case 'get_scene': return getScene(app);
    case 'get_rig': return getScene(app); // older conversations
    case 'set_room': return setRoom(app, input);
    case 'add_props': return addProps(app, input);
    case 'update_props': return updateProps(app, input);
    case 'remove_props': return removeProps(app, input);
    case 'add_fixtures': return addFixtures(app, input);
    case 'move_fixtures': return moveFixtures(app, input);
    case 'remove_fixtures': return removeFixtures(app, input);
    default: throw new Error(tr('Instrument necunoscut: {name}', { name }));
  }
}

const TOOL_LABEL = {
  search_fixtures: (i) => tr('🔎 Caut „{q}”', { q: i.query }),
  get_rig: () => tr('📋 Citesc rigul'),
  get_scene: () => tr('📋 Citesc scena'),
  set_room: () => tr('🏛 Schimb sala'),
  add_props: (i) => tp((i.props || []).length, '🧱 Adaug un element de scenă', '🧱 Adaug {n} elemente de scenă'),
  update_props: (i) => tp((i.props || []).length, '↔ Modific un element de scenă', '↔ Modific {n} elemente de scenă'),
  remove_props: (i) => tp((i.ids || []).length, '🗑 Șterg un element de scenă', '🗑 Șterg {n} elemente de scenă'),
  add_fixtures: (i) => tp(i.quantity || 1, '➕ Adaug o fixtură', '➕ Adaug {n} fixturi'),
  move_fixtures: (i) => tp((i.fixture_ids || []).length, '↔ Mut / rotesc o fixtură', '↔ Mut / rotesc {n} fixturi'),
  remove_fixtures: (i) => tp((i.fixture_ids || []).length, '🗑 Șterg o fixtură', '🗑 Șterg {n} fixturi'),
};

// ------------------------------------------------------------------ panel
// The assistant is optional (it needs a paid Anthropic key): the ✨ button shows
// only when it is switched on in Settings. Unset = on if a key is already saved.
const VIS_KEY = 'freevis.assistant.v1';

export function assistantPreference() {
  try { return localStorage.getItem(VIS_KEY); } catch (_) { return null; }
}

export function setAssistantVisible(on) {
  try { localStorage.setItem(VIS_KEY, on ? 'on' : 'off'); } catch (_) { /* storage blocked */ }
  document.getElementById('assistantBtn')?.classList.toggle('hidden', !on);
  if (!on) window.freevis?.assistant?.toggle(false);
}

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
    this.photos = []; // photos waiting to be sent: { media_type, data, url }
    this.tray = this.el.querySelector('.as-photos');
    this.fileInput = this.el.querySelector('.as-file');
    this.el.querySelector('.as-photo').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => { this.addPhotos(this.fileInput.files); this.fileInput.value = ''; });
    this.input.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); this.addPhotos(files); }
    });
    // Drag & drop on the panel: handled here and kept away from the window's
    // fixture / project drop (its overlay hides while the pointer is over the panel).
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    for (const type of ['dragenter', 'dragover', 'dragleave']) {
      this.el.addEventListener(type, (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (type !== 'dragleave') this.el.classList.add('as-drop');
        else if (!this.el.contains(e.relatedTarget)) this.el.classList.remove('as-drop');
      });
    }
    this.el.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      this.el.classList.remove('as-drop');
      document.getElementById('dropOverlay')?.classList.add('hidden');
      this.addPhotos(e.dataTransfer.files);
    });
    this.el.querySelector('.as-close').addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.as-new').addEventListener('click', () => this.reset());
    this.sendBtn.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not trigger the app shortcuts
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.applyVisibility();
  }

  async applyVisibility() {
    const btn = document.getElementById('assistantBtn');
    const pref = assistantPreference();
    if (pref) { btn?.classList.toggle('hidden', pref !== 'on'); return; }
    btn?.classList.add('hidden');
    try {
      const st = await (await fetch('/api/assistant/status')).json();
      btn?.classList.toggle('hidden', !st.configured);
    } catch (_) { /* server offline: keep it hidden */ }
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
      this.bubble('assistant', tr('Salut! Spune-mi ce să adaug sau să mut. De exemplu: „Pune 4 BeamZ Panther 60 pe truss, de la adresa 200” sau „Adaugă 6 par-uri RGBW pe peretele din spate”.'));
      this.note(tr('📷 Poți trimite și o poză dintr-o sală: refac setup-ul (boxe, lumini, cabină, ring) cu aparatele tale.'));
    }
  }

  reset() {
    this.messages = [];
    this.log.innerHTML = '';
    this.photos = [];
    this.renderPhotos();
    this.refreshStatus();
  }

  /** Add photos to the next message (downscaled JPEG, at most MAX_PHOTOS). */
  async addPhotos(fileList) {
    const files = [...(fileList || [])];
    const images = files.filter((f) => /^image\//.test(f.type));
    if (files.length && !images.length) { toast(tr('Aici merg doar poze (JPEG, PNG, WebP…).'), 'error'); return; }
    for (const file of images) {
      if (this.photos.length >= MAX_PHOTOS) { toast(tp(MAX_PHOTOS, 'Maxim o poză pe mesaj.', 'Maxim {n} poze pe mesaj.'), 'error'); break; }
      try {
        this.photos.push(await shrinkPhoto(file));
      } catch (_) {
        toast(tr('Nu pot citi poza {name}.', { name: file.name }), 'error');
      }
    }
    this.renderPhotos();
    this.input.focus();
  }

  renderPhotos() {
    this.tray.innerHTML = '';
    this.tray.classList.toggle('hidden', !this.photos.length);
    this.photos.forEach((ph, i) => {
      this.tray.append(h('span', { class: 'as-thumb' },
        h('img', { src: ph.url, alt: '' }),
        h('button', { class: 'icon', title: tr('Scoate poza'), onclick: () => { this.photos.splice(i, 1); this.renderPhotos(); } }, '✕')));
    });
  }

  bubble(role, text, photos = []) {
    const b = h('div', { class: `as-msg as-${role}` });
    if (photos.length) b.append(h('div', { class: 'as-msg-photos' }, photos.map((ph) => h('img', { src: ph.url, alt: '' }))));
    if (text) b.append(document.createTextNode(text));
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
    const photos = this.photos;
    let text = this.input.value.trim();
    if ((!text && !photos.length) || this.busy) return;
    if (!this.status?.configured) { toast(tr('Adaugă întâi cheia API Claude.'), 'error'); return; }
    this.input.value = '';
    this.photos = [];
    this.renderPhotos();
    this.bubble('user', text, photos);
    if (!text) text = tr('Recreează în proiect setup-ul din poză (sală, ring, cabină, boxe, lumini), cu aparatele mele.');
    const startLen = this.messages.length;
    this.messages.push({
      role: 'user',
      content: photos.length
        ? [...photos.map((ph) => ({ type: 'image', source: { type: 'base64', media_type: ph.media_type, data: ph.data } })), { type: 'text', text }]
        : text,
    });
    this.busy = true;
    this.sendBtn.disabled = true;
    const thinking = this.note(tr('Claude lucrează…'), 'as-wait');
    // Everything Claude changes in this message is one undo step.
    this.app.beginBatch();
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: this.messages }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.stop_reason === 'refusal') {
          this.messages.length = startLen;
          this.note(tr('Claude a refuzat această cerere. Reformulează, te rog.'), 'as-error');
          break;
        }
        // Keep the assistant turn exactly as returned (thinking blocks included).
        this.messages.push({ role: 'assistant', content: data.content });
        for (const b of data.content) if (b.type === 'text' && b.text.trim()) this.bubble('assistant', b.text.trim());
        const calls = data.content.filter((b) => b.type === 'tool_use');
        if (data.stop_reason === 'max_tokens') this.note(tr('Răspunsul a fost tăiat (prea lung).'), 'as-error');
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
        if (step === MAX_STEPS - 1) this.note(tr('M-am oprit după prea mulți pași. Spune-mi dacă să continui.'), 'as-error');
      }
    } catch (err) {
      // Drop this exchange so the history stays valid for the next message.
      this.messages.length = startLen;
      this.note(err.message, 'as-error');
    } finally {
      thinking.remove();
      this.app.endBatch();
      // Room and prop changes show in the side panels too.
      import('./ui.js').then((ui) => ui.renderAll(this.app)).catch(() => {});
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
    if (res.ok) { toast(tr('Cheia a fost salvată pe acest calculator.')); setAssistantVisible(true); panel.refreshStatus(); }
  } }, tr('Salvează'));
  for (const el of [key]) el.addEventListener('keydown', (e) => e.stopPropagation());
  return h('div', { class: 'form' },
    h('p', { class: 'small' }, tr('Asistentul folosește Claude cu cheia ta API (plătești direct la Anthropic, după consum). Cheia rămâne doar pe acest calculator.')),
    h('label', {}, tr('Cheie API Claude'), key),
    h('label', {}, 'Model', model),
    h('div', { class: 'row' }, save, h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener', class: 'small' }, tr('Obține o cheie ↗'))));
}

export { setupForm };
