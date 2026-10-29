// Project model: fixtures, props, room, custom profiles and view settings.
import { uid } from './profiles.js';
import { tr } from './i18n.js';
import { safeFileName } from './dom.js';
import { pruneGroups } from './groups.js';
import { tripodMount, barSlots } from './prop-layout.js';
import { aimRotation } from './aim.js';

export const PROJECT_VERSION = 1;
export const AUTOSAVE_KEY = 'freevis.autosave.v1';

export function defaultSettings() {
  return { haze: 0.5, bloom: 0.9, ambient: 0.08, houseLight: 0.3, workLights: false, lightPower: 1, showLabels: false, artnetOffset: 1 };
}

export function emptyProject(name = tr('Proiect nou')) {
  return {
    version: PROJECT_VERSION,
    name,
    room: { style: 'plain', width: 24, depth: 20, height: 6, walls: true, grid: true, floorColor: '#9a9792', wallColor: '#bdbab4' },
    settings: defaultSettings(),
    profiles: [],
    fixtures: [],
    props: [],
    groups: [],
    camera: null,
  };
}

const v = (x, y, z) => ({ x, y, z });
const num = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);
/** A full {x, y, z} with numbers, whatever was saved (missing axis, string, null). */
const vec = (o) => v(num(o && o.x), num(o && o.y), num(o && o.z));
const clampInt = (n, lo, hi, d) => { const x = Math.round(num(n, d)); return Math.min(hi, Math.max(lo, x)); };

function fixture(name, profileId, universe, address, position, rotation = v(0, 0, 0), extra = {}) {
  return { id: uid('fx'), name, profileId, universe, address, position, rotation, invertPan: false, invertTilt: false, ...extra };
}

function prop(type, name, position, rotation = v(0, 0, 0), params = {}) {
  return { id: uid('pr'), type, name, position, rotation, params };
}

/** A small club / wedding rig so the first start already looks like a show. */
export function demoProject() {
  const p = emptyProject(tr('Rig demo – nuntă / club'));
  p.room.style = 'dark';
  p.room.floorColor = '#2c2c31';
  p.room.wallColor = '#6e6a66';
  const trussZ = -7.5;
  const trussY = 3.75;
  p.props.push(
    prop('column', tr('Stâlp stânga'), v(-4.6, 0, trussZ), v(0, 0, 0), { length: 3.6 }),
    prop('column', tr('Stâlp dreapta'), v(4.6, 0, trussZ), v(0, 0, 0), { length: 3.6 }),
    prop('truss', tr('Truss față'), v(0, trussY, trussZ), v(0, 0, 0), { length: 9.5 }),
    prop('booth', tr('Cabină DJ'), v(0, 0, -6.2), v(0, 0, 0), { width: 2.2, height: 1.1, depth: 0.75 }),
    prop('speaker', tr('Boxă stânga'), v(-2.4, 0, -6.2)),
    prop('speaker', tr('Boxă dreapta'), v(2.4, 0, -6.2)),
    prop('screen', tr('Ecran LED'), v(0, 1.4, -9.85), v(0, 0, 0), { width: 4, height: 2.25 }),
    prop('crowd', tr('Invitați'), v(0, 0, 1.5), v(0, 0, 0), { width: 12, depth: 8, count: 45 }),
  );

  const hang = v(180, 0, 0);
  p.fixtures.push(
    fixture('Spot 1', 'gen-mh-spot-11', 1, 1, v(-3.3, trussY - 0.17, trussZ), hang),
    fixture('Beam 1', 'gen-mh-beam-16', 1, 12, v(-1.1, trussY - 0.17, trussZ), hang),
    fixture('Beam 2', 'gen-mh-beam-16', 1, 28, v(1.1, trussY - 0.17, trussZ), hang),
    fixture('Spot 2', 'gen-mh-spot-11', 1, 44, v(3.3, trussY - 0.17, trussZ), hang),
  );
  const ups = [[-10.5, -9.5, -12], [-7, -9.5, -12], [7, -9.5, -12], [10.5, -9.5, -12]];
  ups.forEach(([x, z, rx], i) => p.fixtures.push(fixture(`Uplight ${i + 1}`, 'gen-par-rgbwauv-6', 1, 61 + i * 6, v(x, 0, z), v(rx, 0, 0))));
  p.fixtures.push(
    fixture('Uplight 5', 'gen-par-rgbwauv-6', 1, 85, v(-11.6, 0, -2), v(0, 0, 14)),
    fixture('Uplight 6', 'gen-par-rgbwauv-6', 1, 91, v(11.6, 0, -2), v(0, 0, -14)),
  );
  p.fixtures.push(
    fixture(tr('Bară LED {n}', { n: 1 }), 'gen-bar-8x-rgb-26', 1, 101, v(-3, 0.05, -9.4), v(-18, 0, 0)),
    fixture(tr('Bară LED {n}', { n: 2 }), 'gen-bar-8x-rgb-26', 1, 127, v(3, 0.05, -9.4), v(-18, 0, 0)),
    fixture('Strobe', 'gen-strobe-2', 1, 161, v(0, trussY, trussZ + 0.22), v(70, 0, 0)),
    fixture(tr('Fum'), 'gen-fog-1', 1, 170, v(1.6, 0, -6.6)),
  );
  p.camera = { position: [0, 3.4, 11.5], target: [0, 2.4, -5] };
  return p;
}

/** Wedding venue: DJ booth with truss, retro lights, uplights on every wall,
 *  dance floor with cold sparks, mirror ball with pinspots and low fog. */
export function weddingProject() {
  const p = emptyProject(tr('Rig nuntă – sală de evenimente'));
  p.room = { ...p.room, style: 'banquet', width: 26, depth: 20, height: 5.5, floorColor: '#2b2725', wallColor: '#d8cdbd' };
  const trussZ = -9;
  const trussY = 3.35;
  p.props.push(
    prop('column', tr('Stâlp stânga'), v(-3.6, 0, trussZ), v(0, 0, 0), { length: 3.2 }),
    prop('column', tr('Stâlp dreapta'), v(3.6, 0, trussZ), v(0, 0, 0), { length: 3.2 }),
    prop('truss', tr('Truss DJ'), v(0, trussY, trussZ), v(0, 0, 0), { length: 7.5 }),
    prop('booth', tr('Cabină DJ'), v(0, 0, -8.2), v(0, 0, 0), { width: 2.2, height: 1.1, depth: 0.75 }),
    prop('speaker', tr('Boxă stânga'), v(-4.6, 0, -8.6)),
    prop('speaker', tr('Boxă dreapta'), v(4.6, 0, -8.6)),
    prop('dancefloor', tr('Ring de dans'), v(0, 0, -3.5), v(0, 0, 0), { width: 8, depth: 7 }),
    prop('crowd', tr('Invitați pe ring'), v(0, 0, -3.5), v(0, 0, 0), { width: 6.5, depth: 5.5, count: 24 }),
    prop('headtable', tr('Masa mirilor'), v(-10.6, 0, -3.5), v(0, 90, 0), { width: 4, depth: 0.9 }),
    prop('mirrorball', tr('Glob disco'), v(0, 4.4, -3.5), v(0, 0, 0), { diameter: 0.5, drop: 0.6, rpm: 2 }),
  );
  let t = 1;
  for (const x of [-8, -4, 0, 4, 8]) for (const z of [3.5, 7.5]) p.props.push(prop('table', tr('Masa {n}', { n: t++ }), v(x, 0, z), v(0, 0, 0), { diameter: 1.8 }));
  for (const z of [-6.5, -2]) p.props.push(prop('table', tr('Masa {n}', { n: t++ }), v(9.5, 0, z), v(0, 0, 0), { diameter: 1.8 }));

  const hang = v(180, 0, 0);
  const face = v(90, 0, 0);
  p.fixtures.push(
    fixture('Spot 1', 'gen-mh-spot-11', 1, 1, v(-3.05, trussY - 0.17, trussZ), hang),
    fixture('Spot 2', 'gen-mh-spot-11', 1, 12, v(3.05, trussY - 0.17, trussZ), hang),
    fixture('Wash 1', 'gen-mh-wash-14', 1, 23, v(-1.7, 0, -8.6)),
    fixture('Wash 2', 'gen-mh-wash-14', 1, 37, v(1.7, 0, -8.6)),
  );
  [-2.4, -0.8, 0.8, 2.4].forEach((x, i) => p.fixtures.push(fixture(`Retro ${i + 1}`, 'gen-retro-9', 1, 51 + i * 9, v(x, 2.95, trussZ + 0.25), face)));
  const ups = [
    [-11, -9.6, v(-12, 0, 0)], [-7, -9.6, v(-12, 0, 0)], [7, -9.6, v(-12, 0, 0)], [11, -9.6, v(-12, 0, 0)],
    [-12.6, -6, v(0, 0, 14)], [-12.6, -1, v(0, 0, 14)], [-12.6, 4, v(0, 0, 14)], [-12.6, 8, v(0, 0, 14)],
    [12.6, -6, v(0, 0, -14)], [12.6, -1, v(0, 0, -14)], [12.6, 4, v(0, 0, -14)], [12.6, 8, v(0, 0, -14)],
  ];
  ups.forEach(([x, z, r], i) => p.fixtures.push(fixture(`Uplight ${i + 1}`, 'gen-par-rgbwauv-6', 1, 101 + i * 6, v(x, 0, z), r)));
  [[-4.2, -7], [4.2, -7], [-4.2, 0], [4.2, 0]].forEach(([x, z], i) => p.fixtures.push(fixture(tr('Scântei {n}', { n: i + 1 }), 'gen-spark-2', 1, 181 + i * 2, v(x, 0, z))));
  p.fixtures.push(
    fixture('Pinspot 1', 'gen-pinspot-1', 1, 191, v(-2.5, 5.2, -3.5), v(0, 0, -107.8)),
    fixture('Pinspot 2', 'gen-pinspot-1', 1, 192, v(2.5, 5.2, -3.5), v(0, 0, 107.8)),
    fixture(tr('Fum greu'), 'gen-lowfog-1', 1, 195, v(0, 0, -7.3)),
    fixture('Laser', 'gen-laser-6', 1, 201, v(0, trussY + 0.25, trussZ), v(80, 0, 0)),
  );
  // Two tripod stands beside the booth, two pars on each T-bar aimed at the dance floor.
  [-1, 1].forEach((side, k) => {
    const stand = prop('tripod', tr('Stativ {n}', { n: k + 1 }), v(side * 6, 0, -7.6), v(0, 0, 0), { height: 2.6, bar: 1.2, legs: 1.2 });
    p.props.push(stand);
    barSlots(1.2, 2).forEach((off, j) => {
      const at = tripodMount(stand, off).position;
      p.fixtures.push(fixture(`Par ${k * 2 + j + 1}`, 'gen-par-rgbwauv-6', 1, 211 + (k * 2 + j) * 6, at, aimRotation(at, v(side * 2.2, 0, -4.4))));
    });
  });
  p.camera = { position: [8.5, 4.4, 10.5], target: [0, 1.8, -4.5] };
  return p;
}

/** Upgrade / repair a project loaded from disk. */
export function normalizeProject(raw) {
  const base = emptyProject();
  const p = { ...base, ...(raw || {}) };
  p.room = { ...base.room, ...(raw && raw.room) };
  // Projects saved before room styles: halls with tables become the banquet hall, the rest keep the dark room.
  if (raw && raw.room && !raw.room.style) {
    const banquet = (raw.props || []).some((x) => x.type === 'table' || x.type === 'headtable');
    p.room.style = banquet ? 'banquet' : 'dark';
    if (banquet) p.room.wallColor = '#d8cdbd';
  }
  p.settings = { ...base.settings, ...(raw && raw.settings) };
  p.profiles = Array.isArray(p.profiles) ? p.profiles : [];
  p.fixtures = (Array.isArray(p.fixtures) ? p.fixtures : []).filter((f) => f && typeof f === 'object').map((f) => ({
    invertPan: false, invertTilt: false, ...f,
    id: f.id || uid('fx'),
    position: vec(f.position),
    rotation: vec(f.rotation),
    universe: clampInt(f.universe, 1, 32768, 1),
    address: clampInt(f.address, 1, 512, 1),
  }));
  p.props = (Array.isArray(p.props) ? p.props : []).filter((x) => x && typeof x === 'object' && x.type).map((x) => ({
    ...x,
    id: x.id || uid('pr'),
    position: vec(x.position),
    rotation: vec(x.rotation),
    params: x.params && typeof x.params === 'object' ? x.params : {},
  }));
  p.groups = (Array.isArray(p.groups) ? p.groups : []).filter((g) => g && g.id).map((g) => ({ id: g.id, name: g.name || g.id }));
  pruneGroups(p);
  p.version = PROJECT_VERSION;
  return p;
}

export function autosave(project) {
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project)); } catch (_) { /* storage full / private mode */ }
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch (_) {
    return null;
  }
}

export async function listServerProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(tr('Nu pot lista proiectele'));
  return res.json();
}

export async function saveServerProject(project) {
  const res = await fetch(`/api/projects/${encodeURIComponent(project.name)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(project, null, 1),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || tr('Eroare la salvare'));
  return body;
}

export async function loadServerProject(name) {
  const res = await fetch(`/api/projects/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(tr('Proiectul nu a putut fi încărcat'));
  return normalizeProject(await res.json());
}

export async function deleteServerProject(name) {
  await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = safeFileName(filename);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** Address helpers */
export function fixtureEnd(f, profile) {
  return f.address + (profile ? profile.channels.length : 1) - 1;
}

export function nextFreeAddress(project, profilesById, universe, count) {
  const used = project.fixtures
    .filter((f) => f.universe === universe && profilesById[f.profileId])
    .map((f) => [f.address, fixtureEnd(f, profilesById[f.profileId])])
    .sort((a, b) => a[0] - b[0]);
  let addr = 1;
  for (const [s, e] of used) {
    if (addr + count - 1 < s) break;
    addr = Math.max(addr, e + 1);
  }
  return addr + count - 1 <= 512 ? addr : null;
}

export function findConflicts(project, profilesById) {
  const conflicts = new Set();
  const list = project.fixtures.filter((f) => profilesById[f.profileId]);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const ae = fixtureEnd(a, profilesById[a.profileId]);
    if (ae > 512) conflicts.add(a.id);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.universe !== b.universe) continue;
      const be = fixtureEnd(b, profilesById[b.profileId]);
      if (a.address <= be && b.address <= ae) { conflicts.add(a.id); conflicts.add(b.id); }
    }
  }
  return conflicts;
}

export function nextName(name, existing) {
  const m = /^(.*?)(\d+)$/.exec(name);
  const base = m ? m[1] : `${name} `;
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (existing.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}
