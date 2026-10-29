// Stage elements: truss, DJ booth, speakers, risers, screens, cases, stands, crowd, walls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Particles } from './particles.js';
import { tr } from './i18n.js';
import { pbrSet, PBR_TILE } from './textures.js';
import { seeded, crowdLayout, PERSON_HEIGHT, tripodParams, TRIPOD_BAR_R, totemParams, speakerStandParams } from './prop-layout.js';
import { dressCrowd, showState, MAX_ANIMATED_GUESTS, seatLayout, dressSeated, chairCount, idSeed, CHAIR_OFFSET } from './guest-layout.js';
import { loadGuests, guestsReady, createAnimatedCrowd } from './guests3d.js';
import { djFigure, DJ_BEHIND } from './dj3d.js';

export const PROP_TYPES = {
  truss: { label: tr('Truss (orizontal)'), params: { length: 6 } },
  column: { label: tr('Stâlp truss (vertical)'), params: { length: 3.5 } },
  booth: {
    label: tr('Cabină DJ'),
    params: { width: 2, height: 1.1, depth: 0.7, dj: 1, djLook: 1 },
    choices: { dj: [[0, tr('Fără')], [1, tr('DJ în spate')]], djLook: [[1, tr('Bărbat')], [2, tr('Femeie')]] },
  },
  speaker: { label: tr('Boxă'), params: { width: 0.5, height: 1.0, depth: 0.45 } },
  sub: { label: 'Subwoofer', params: { width: 0.7, height: 0.6, depth: 0.7 } },
  platform: { label: tr('Podium / scenă'), params: { width: 4, height: 0.4, depth: 2 } },
  screen: { label: tr('Ecran LED'), params: { width: 3, height: 1.7 } },
  wall: { label: tr('Perete / backdrop'), params: { width: 8, height: 4 } },
  table: { label: tr('Masă rotundă'), params: { diameter: 1.6, guests: 0 }, limits: { guests: [0, 16] } },
  headtable: { label: tr('Masa mirilor'), params: { width: 4, depth: 0.9 } },
  dancefloor: { label: tr('Ring de dans'), params: { width: 7, depth: 7 } },
  mirrorball: { label: tr('Glob disco'), params: { diameter: 0.5, drop: 0.8, rpm: 2 } },
  case: { label: tr('Case (flight case)'), params: { width: 1.2, height: 0.75, depth: 0.6, wheels: 1 }, choices: { wheels: [[0, tr('Fără roți')], [1, tr('Cu roți')]] } },
  tripod: { label: tr('Stativ trepied'), params: { height: 2.5, bar: 1.2, legs: 1.2 }, limits: { height: [1, 4], bar: [0, 3], legs: [0.5, 2.5] } },
  speakerstand: {
    label: tr('Stativ boxă'),
    params: { height: 1.8, speaker: 1, size: 12 },
    limits: { height: [1, 2.4] },
    choices: { speaker: [[0, tr('Fără boxă')], [1, tr('Cu boxă')]], size: [[10, '10"'], [12, '12"'], [15, '15"']] },
  },
  totem: {
    label: tr('Totem lumini'),
    params: { height: 2, plate: 0.5, cover: 1 },
    limits: { height: [1, 3.5], plate: [0.3, 0.8] },
    choices: { cover: [[0, tr('Fără husă')], [1, tr('Husă albă')], [2, tr('Husă neagră')]] },
  },
  crowd: {
    label: tr('Public (invitați)'),
    params: { width: 8, depth: 6, count: 45, density: 2, size: 1, activity: 1, couple: 0 },
    limits: { count: [1, 600], size: [0.8, 1.1] },
    choices: {
      density: [[1, tr('Puțini (rar)')], [2, tr('Normal')], [3, tr('Mulți (înghesuiți)')]],
      activity: [[1, tr('Dansează (ring)')], [2, tr('Amestecat')], [3, tr('Stau și vorbesc')]],
      couple: [[0, tr('Fără')], [1, tr('Mirii în mijloc')]],
    },
  },
};

const metal = () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85 });
const black = () => new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.7, metalness: 0.1 });

function trussSection(length) {
  const g = new THREE.Group();
  const size = 0.29;
  const h = size / 2;
  // Brushed aluminium (CC0 photo texture) on the chords.
  const mat = new THREE.MeshStandardMaterial({ color: 0xccd2da, roughness: 0.38, metalness: 0.65, ...pbrSet('metal', 0.3, length / PBR_TILE.metal) });
  const chordGeo = new THREE.CylinderGeometry(0.024, 0.024, length, 8);
  chordGeo.rotateZ(Math.PI / 2);
  for (const [y, z] of [[h, h], [h, -h], [-h, h], [-h, -h]]) {
    const m = new THREE.Mesh(chordGeo, mat);
    m.position.set(0, y, z);
    g.add(m);
  }
  // Diagonal lacing as line segments (cheap and reads well from a distance).
  const pts = [];
  const steps = Math.max(1, Math.round(length / size));
  const step = length / steps;
  for (let i = 0; i < steps; i++) {
    const x0 = -length / 2 + i * step;
    const x1 = x0 + step;
    const flip = i % 2 ? 1 : -1;
    pts.push(x0, h, h * flip, x1, h, -h * flip);
    pts.push(x0, -h, h * flip, x1, -h, -h * flip);
    pts.push(x0, h * flip, h, x1, -h * flip, h);
    pts.push(x0, h * flip, -h, x1, -h * flip, -h);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8a939c })));
  return g;
}

function speakerFront(w, h, d) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black());
  box.position.y = h / 2;
  g.add(box);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.9 });
  const r = Math.min(w, h) * 0.32;
  const woofer = new THREE.Mesh(new THREE.CircleGeometry(r, 32), coneMat);
  woofer.position.set(0, h * 0.32, d / 2 + 0.002);
  g.add(woofer);
  if (h > w) {
    const tw = new THREE.Mesh(new THREE.CircleGeometry(r * 0.45, 24), coneMat);
    tw.position.set(0, h * 0.75, d / 2 + 0.002);
    g.add(tw);
  }
  return g;
}

// ------------------------------------------------------------------ crowd
// Slim guest silhouettes (1.72 m at scale 1, shoulders ~0.34 m), split in a few
// InstancedMeshes so clothes, dresses and skin get their own colours.
// Vertex colours darken shoes / hair / tights; instance colours give the garment.
let crowdGeos = null;
const sharedGeos = new Set();

function shade(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** Cylinder from point a to point b (radius r0 at a, r1 at b). */
function limb(a, b, r0, r1, seg = 7) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, dir.length(), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function personGeometries() {
  if (crowdGeos) return crowdGeos;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const shoes = () => [-1, 1].map((s) => { const g = new THREE.BoxGeometry(0.085, 0.07, 0.22); g.translate(s * 0.085, 0.035, 0.035); return shade(g, () => 0.12); });
  const solid = (g, k = 1) => shade(g, () => k);
  // Trousers: two tapered legs and the hips.
  const hips = new THREE.CylinderGeometry(0.15, 0.14, 0.16, 10); hips.scale(1, 1, 0.62); hips.translate(0, 0.9, 0);
  const trousers = mergeSimple([
    ...[-1, 1].map((s) => solid(limb(V(s * 0.085, 0.06, 0), V(s * 0.09, 0.9, 0), 0.048, 0.07))),
    solid(hips), ...shoes(),
  ]);
  // Dress: flared skirt to the knee, dark tights below.
  const skirt = new THREE.CylinderGeometry(0.135, 0.25, 0.52, 14, 1, true); skirt.scale(1, 1, 0.72); skirt.translate(0, 0.76, 0);
  const waist = new THREE.CylinderGeometry(0.13, 0.135, 0.1, 12); waist.scale(1, 1, 0.66); waist.translate(0, 1.04, 0);
  const dress = mergeSimple([
    solid(skirt), solid(waist),
    ...[-1, 1].map((s) => solid(limb(V(s * 0.075, 0.06, 0), V(s * 0.08, 0.6, 0), 0.04, 0.05), 0.28)),
    ...shoes(),
  ]);
  // Upper body: tapered torso, rounded shoulders and arms (down, or up for dancing).
  const torso = () => {
    const t = new THREE.CylinderGeometry(0.145, 0.13, 0.46, 12); t.scale(1, 1, 0.6); t.translate(0, 1.19, 0);
    const sh = new THREE.SphereGeometry(0.145, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2); sh.scale(1, 0.4, 0.6); sh.translate(0, 1.42, 0);
    return [solid(t), solid(sh)];
  };
  const armsDown = mergeSimple([...torso(), ...[-1, 1].map((s) => solid(limb(V(s * 0.16, 1.41, 0), V(s * 0.19, 0.84, 0.02), 0.042, 0.032)))]);
  const armsUp = mergeSimple([...torso(), ...[-1, 1].flatMap((s) => [
    solid(limb(V(s * 0.16, 1.4, 0), V(s * 0.3, 1.66, 0.04), 0.042, 0.036)), // upper arm
    solid(limb(V(s * 0.3, 1.66, 0.04), V(s * 0.24, 1.93, 0.08), 0.036, 0.03)), // forearm
  ])]);
  // Head and neck (skin), hair darkened on top and at the back.
  const neck = new THREE.CylinderGeometry(0.048, 0.052, 0.12, 8); neck.translate(0, 1.48, 0);
  const head = new THREE.SphereGeometry(0.098, 12, 9); head.scale(0.84, 1.1, 0.98); head.translate(0, 1.61, 0);
  shade(head, (x, y, z) => (y > 1.645 || z < -0.035 ? 0.2 : 1));
  const heads = mergeSimple([solid(neck), head]);
  crowdGeos = { trousers, dress, armsDown, armsUp, heads };
  for (const g of Object.values(crowdGeos)) sharedGeos.add(g);
  return crowdGeos;
}

const TROUSER_COLORS = [0x1c2233, 0x141416, 0x2c2e33, 0x3b3f47, 0x23324a, 0x4a4239, 0x2d3a52];
const SHIRT_COLORS = [0xe9e7e2, 0xdfe6ee, 0x1a1b20, 0x262d3f, 0x8c96a6, 0x5a1d28, 0xbfae92, 0x34465e, 0xf2f0ea, 0x3d3d42];
const DRESS_COLORS = [0x6b1a2b, 0x1b2a4e, 0x121214, 0x1f4d3d, 0xd9c7a3, 0xc98f9a, 0x9e1b26, 0x2a4fa0, 0x6a5687, 0xb7b0a8];
const SKIN_COLORS = [0xf0cfb4, 0xe8bf9f, 0xdcae8b, 0xc99574, 0xa8714f, 0xf3d6c1, 0xe2b896];

/**
 * Guests: animated mannequins (guests3d.js) at Medie / Înaltă / Clip, the simple
 * silhouettes at Scăzută, while the animated ones load, and for very big crowds.
 */
function crowdModel(root, p, seed, animated, ctx) {
  const people = crowdLayout(p, seed);
  const rnd = seeded(seed * 31 + 5);
  const geos = personGeometries();
  const parts = {};
  const simple = new THREE.Group();
  root.add(simple);
  const groups = { trousers: [], dress: [], armsDown: [], armsUp: [], heads: [] };
  people.forEach((g, i) => {
    groups[g.dress ? 'dress' : 'trousers'].push(i);
    groups[g.armsUp ? 'armsUp' : 'armsDown'].push(i);
    groups.heads.push(i);
  });
  const colors = people.map((g) => {
    const lower = new THREE.Color(g.dress ? DRESS_COLORS[Math.floor(rnd() * DRESS_COLORS.length)] : TROUSER_COLORS[Math.floor(rnd() * TROUSER_COLORS.length)]);
    // A dress is one garment; some guests wear a jacket matching the trousers (a suit).
    const upper = g.dress ? (rnd() < 0.8 ? lower.clone() : new THREE.Color(SHIRT_COLORS[Math.floor(rnd() * SHIRT_COLORS.length)]))
      : (rnd() < 0.3 ? lower.clone() : new THREE.Color(SHIRT_COLORS[Math.floor(rnd() * SHIRT_COLORS.length)]));
    return { lower, upper, skin: new THREE.Color(SKIN_COLORS[Math.floor(rnd() * SKIN_COLORS.length)]) };
  });
  const base = people.map((g) => {
    const s = g.height / PERSON_HEIGHT;
    return new THREE.Matrix4().compose(new THREE.Vector3(g.x, 0, g.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.heading), new THREE.Vector3(s * g.girth, s, s * g.girth));
  });
  for (const [name, idx] of Object.entries(groups)) {
    if (!idx.length) continue;
    const mesh = new THREE.InstancedMesh(geos[name], new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: name === 'heads' ? 0.6 : 0.85, vertexColors: true }), idx.length);
    idx.forEach((pi, k) => {
      mesh.setMatrixAt(k, base[pi]);
      const c = colors[pi];
      mesh.setColorAt(k, name === 'heads' ? c.skin : name === 'trousers' || name === 'dress' ? c.lower : c.upper);
    });
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    parts[name] = { mesh, idx };
    simple.add(mesh);
  }
  // Light bounce on the beat so the room feels alive (dancers with raised arms jump a bit more).
  const tmp = new THREE.Matrix4();
  const lift = people.map((g) => (g.armsUp ? 0.06 : 0.03));
  const bounce = (t) => {
    for (const { mesh, idx } of Object.values(parts)) {
      for (let k = 0; k < idx.length; k++) {
        const pi = idx[k];
        tmp.copy(base[pi]);
        tmp.elements[13] = Math.max(0, Math.sin(t * 13.2 + people[pi].phase)) * lift[pi];
        mesh.setMatrixAt(k, tmp);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  const dressed = dressCrowd(people, { seed, activity: p.activity, couple: Number(p.couple) > 0 });
  let live = null;
  let show = null;
  if (people.length <= MAX_ANIMATED_GUESTS) loadGuests();
  animated.push((t, env) => {
    const quality = (ctx && (ctx.quality || (ctx.settings && ctx.settings.quality))) || 'high';
    const asset = quality !== 'low' && people.length <= MAX_ANIMATED_GUESTS ? guestsReady() : null;
    // Medie: the low-detail bodies; Înaltă / Clip: the detailed ones.
    const lowDetail = quality === 'medium';
    if (live && asset && live.lowDetail !== lowDetail) { root.remove(live.group); live.dispose(); live = null; }
    if (asset && !live) { live = createAnimatedCrowd(people, dressed, asset, { lowDetail }); live.lowDetail = lowDetail; root.add(live.group); }
    simple.visible = !asset;
    if (live) live.group.visible = !!asset;
    if (!asset) { bounce(t); return; }
    // They dance while the show runs (lights on), else they stand and talk.
    show = showState(show, env && env.globals ? env.globals.showLevel : 1, (env && env.dt) || 0.016);
    const bpm = (ctx && ctx.bpm) || 124;
    live.update(t, (t * bpm) / 60, show.on);
  });
  return { update() {}, dispose: () => { if (live) live.dispose(); } };
}

/** Guests sitting on the chairs of a round table (animated quality levels only). */
function seatedGuests(root, p, id, animated, ctx) {
  const seed = idSeed(id || 'table');
  const seats = seatLayout(p.diameter, p.guests, seed);
  if (!seats.length) return null;
  const dressed = dressSeated(seats, seed);
  const people = seats.map((st) => ({ ...st, girth: 1 }));
  let live = null;
  loadGuests();
  animated.push((t) => {
    const quality = (ctx && (ctx.quality || (ctx.settings && ctx.settings.quality))) || 'high';
    const asset = quality !== 'low' ? guestsReady() : null;
    if (asset && !live) { live = createAnimatedCrowd(people, dressed, asset, { lowDetail: true }); root.add(live.group); }
    if (!live) return;
    live.group.visible = !!asset;
    if (asset) live.update(t, (t * ((ctx && ctx.bpm) || 124)) / 60, false);
  });
  return { update() {}, dispose: () => { if (live) live.dispose(); } };
}

function mergeSimple(geos) {
  const positions = []; const normals = []; const colors = []; const indices = [];
  const withColor = geos.every((g) => g.attributes.color);
  let offset = 0;
  for (const g of geos) {
    const p = g.attributes.position.array; const n = g.attributes.normal.array;
    positions.push(...p); normals.push(...n);
    if (withColor) colors.push(...g.attributes.color.array);
    if (g.index) for (const i of g.index.array) indices.push(i + offset);
    else for (let i = 0; i < p.length / 3; i++) indices.push(i + offset);
    offset += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (withColor) out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}


// ------------------------------------------------------------------ road case
// Flight case: black ATA laminate, aluminium angle on every edge, ball corners,
// lid valance, recessed spring handles, butterfly latches and optional castors.
// The lid is at y = height (castors included), so cases stack and fixtures sit on top.
function roadCase(p) {
  const g = new THREE.Group();
  const w = Math.max(0.2, p.width); const d = Math.max(0.2, p.depth);
  const wheels = Number(p.wheels) > 0 && p.height > 0.3;
  const wh = wheels ? 0.11 : 0;
  const top = Math.max(0.15, p.height);
  const bh = top - wh; // body height
  const y0 = wh;
  const laminate = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.62, metalness: 0.05 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.34, metalness: 0.92 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.15, metalness: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85, metalness: 0 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };

  add(new THREE.BoxGeometry(w - 0.006, bh - 0.006, d - 0.006), laminate, 0, y0 + bh / 2, 0);
  // Aluminium angle on the 12 edges.
  const e = 0.026;
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(w - 0.05, e, e), alu, 0, y0 + bh / 2 + sy * (bh / 2 - e / 2), sz * (d / 2 - e / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(e, bh - 0.05, e), alu, sx * (w / 2 - e / 2), y0 + bh / 2, sz * (d / 2 - e / 2));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(new THREE.BoxGeometry(e, e, d - 0.05), alu, sx * (w / 2 - e / 2), y0 + bh / 2 + sy * (bh / 2 - e / 2), 0);
  // Lid valance (tongue and groove) with a dark seam just under it.
  const lidY = y0 + bh - Math.min(0.2, bh * 0.24);
  for (const sz of [-1, 1]) {
    add(new THREE.BoxGeometry(w - 0.05, 0.03, 0.008), alu, 0, lidY, sz * (d / 2 + 0.002));
    add(new THREE.BoxGeometry(w - 0.05, 0.004, 0.004), rubber, 0, lidY - 0.017, sz * (d / 2 + 0.003));
  }
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.008, 0.03, d - 0.05), alu, sx * (w / 2 + 0.002), lidY, 0);
    add(new THREE.BoxGeometry(0.004, 0.004, d - 0.05), rubber, sx * (w / 2 + 0.003), lidY - 0.017, 0);
  }
  // Ball corners.
  const ball = new THREE.SphereGeometry(0.03, 12, 8);
  const cornerPlate = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
    const cy = sy ? y0 + bh - 0.026 : y0 + 0.026;
    add(cornerPlate, chrome, sx * (w / 2 - 0.027), cy, sz * (d / 2 - 0.027));
    add(ball, chrome, sx * (w / 2 - 0.02), cy + (sy ? 0.006 : -0.006), sz * (d / 2 - 0.02));
  }
  // Recessed spring handles on both ends (two on long cases).
  const handleY = y0 + bh * 0.55;
  const handleZs = d > 0.9 ? [-d / 4, d / 4] : [0];
  for (const sx of [-1, 1]) for (const hz of handleZs) {
    add(new THREE.BoxGeometry(0.008, 0.11, 0.2), chrome, sx * (w / 2 + 0.003), handleY, hz);
    add(new THREE.BoxGeometry(0.004, 0.075, 0.16), rubber, sx * (w / 2 + 0.006), handleY, hz);
    const bar = add(new THREE.CylinderGeometry(0.009, 0.009, 0.13, 8), rubber, sx * (w / 2 + 0.013), handleY - 0.028, hz);
    bar.rotation.x = Math.PI / 2;
  }
  // Butterfly latches on the front and back at the lid seam, plus end latches on big cases.
  const latch = (x, z, ry) => {
    const l = new THREE.Group();
    l.add(new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.008), chrome));
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16), rubber);
    dish.rotation.x = Math.PI / 2; dish.position.z = 0.005;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.018, 0.007), chrome);
    wing.position.z = 0.009;
    const keeper = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.008), chrome);
    keeper.position.set(0, 0.06, 0.001);
    l.add(dish, wing, keeper);
    l.position.set(x, lidY - 0.045, z);
    l.rotation.y = ry;
    g.add(l);
  };
  const nl = w > 1.6 ? 3 : w > 0.8 ? 2 : 1;
  for (let i = 0; i < nl; i++) {
    const x = nl === 1 ? 0 : -w * 0.32 + (w * 0.64 * i) / (nl - 1);
    latch(x, d / 2 + 0.004, 0);
    latch(x, -d / 2 - 0.004, Math.PI);
  }
  if (d > 0.9) for (const sx of [-1, 1]) latch(sx * (w / 2 + 0.004), 0, sx * Math.PI / 2);
  // Castors: plate, swivel fork, rubber wheel with a grey hub.
  if (wheels) {
    const wr = 0.045;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new THREE.Group();
      const at = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); c.add(m); return m; };
      at(new THREE.BoxGeometry(0.1, 0.008, 0.1), alu, 0, wh - 0.004, 0);
      at(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 12), alu, 0, wh - 0.017, 0);
      for (const fx of [-1, 1]) at(new THREE.BoxGeometry(0.005, 0.07, 0.045), alu, fx * 0.024, wr + 0.016, -0.012);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.034, 18), rubber);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(0, wr, -0.018);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.038, 12), alu);
      hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position);
      c.add(wheel, hub);
      c.position.set(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08));
      c.rotation.y = sz > 0 ? (sx * 0.5) : 0; // front pair swivelled a bit
      g.add(c);
    }
  }
  return g;
}

// ------------------------------------------------------------------ tripod stand
// Lighting stand: three folding legs with braces, telescopic mast with clamp knobs,
// a T-bar with end caps and a centre clamp (or a top plate when bar = 0).
// `height` is the top of the T-bar (where a standing fixture sits).
function tripodStand(params) {
  const { height: H, bar, legs } = tripodParams(params);
  const g = new THREE.Group();
  const tube = new THREE.MeshStandardMaterial({ color: 0xb4bac1, roughness: 0.3, metalness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.45, metalness: 0.55 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.6, metalness: 0.05 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rod = (a, b, r, mat, seg = 10) => { const m = new THREE.Mesh(limb(a, b, r, r, seg), mat); g.add(m); return m; };
  const cyl = (r, h, y, mat, seg = 16) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.y = y; g.add(m); return m; };
  const knob = (y, r, angle) => {
    // Clamp screw sticking out of a collar, with a star knob.
    const dir = V(Math.cos(angle), 0, Math.sin(angle));
    rod(V(0, y, 0).addScaledVector(dir, r), V(0, y, 0).addScaledVector(dir, r + 0.035), 0.005, steel, 6);
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.016, 6), plastic);
    k.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
    k.position.set(0, y, 0).addScaledVector(dir, r + 0.042);
    g.add(k);
  };

  const barR = TRIPOD_BAR_R;
  const barY = H - barR; // T-bar centre
  const mastTop = bar > 0 ? barY - 0.05 : H - 0.01;
  const hU = Math.min(Math.max(0.35, legs * 0.55), Math.max(0.35, Math.min(1.0, H * 0.42)));
  const hL = Math.max(0.12, hU * 0.32);
  const R = legs / 2;
  // Telescopic mast: up to three sections, each thinner, a clamp collar + knob at each joint.
  const span = mastTop - hL;
  const n = span > 1.7 ? 3 : span > 0.9 ? 2 : 1;
  const radii = [0.0175, 0.0145, 0.0118];
  for (let i = 0; i < n; i++) {
    const a = hL - 0.04 + (span * i) / n;
    const b = i === n - 1 ? mastTop : hL + (span * (i + 1)) / n + 0.02;
    rod(V(0, a, 0), V(0, b, 0), radii[i], tube, 14);
    if (i > 0) {
      cyl(radii[i - 1] + 0.009, 0.055, a + 0.03, plastic);
      knob(a + 0.03, radii[i - 1] + 0.009, Math.PI / 2 + i * 0.8);
    }
  }
  // Upper hub (legs pivot here) and the sliding lower collar with the braces.
  cyl(0.034, 0.08, hU, plastic);
  cyl(0.03, 0.05, hL, plastic);
  knob(hL, 0.03, -Math.PI / 2 + 0.6);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3; // one leg to the back
    const c = Math.cos(a); const s = Math.sin(a);
    const hub = V(c * 0.036, hU, s * 0.036);
    const foot = V(c * R, 0.025, s * R);
    rod(hub, foot, 0.011, tube, 8);
    const mid = hub.clone().lerp(foot, 0.42);
    rod(V(c * 0.032, hL, s * 0.032), mid, 0.006, steel, 6);
    // Hinge lugs and the rubber foot.
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.026), plastic);
    lug.position.set(c * 0.042, hU - 0.01, s * 0.042);
    lug.rotation.y = -a;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 10), plastic);
    pad.position.set(c * R, 0.015, s * R);
    g.add(lug, pad);
  }
  if (bar > 0) {
    // Centre clamp: a sleeve over the mast holding a cross block, with its knob.
    rod(V(0, mastTop - 0.12, 0), V(0, barY - 0.02, 0), 0.023, plastic, 14);
    knob(mastTop - 0.06, 0.023, Math.PI / 2);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.055), plastic);
    block.position.y = barY - 0.005;
    g.add(block);
    rod(V(-bar / 2 + 0.012, barY, 0), V(bar / 2 - 0.012, barY, 0), barR, tube, 14);
    for (const sx of [-1, 1]) rod(V(sx * (bar / 2 - 0.016), barY, 0), V(sx * bar / 2, barY, 0), barR + 0.003, plastic, 14);
  } else {
    // Top plate with a short spigot.
    rod(V(0, mastTop - 0.06, 0), V(0, H - 0.008, 0), 0.014, steel, 10);
    cyl(0.055, 0.008, H - 0.004, steel, 20);
  }
  return g;
}

// ------------------------------------------------------------------ speaker stand
// Pole stand: three folding legs, a Ø35 mm telescopic pole and the speaker sitting
// on it (top-hat socket). `height` is the top of the pole = bottom of the speaker.
function speakerStand(params) {
  const { height: H, speaker, box } = speakerStandParams(params);
  const g = new THREE.Group();
  const tube = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.6 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.65, metalness: 0.05 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rod = (a, b, r, mat, seg = 10) => { const m = new THREE.Mesh(limb(a, b, r, r, seg), mat); g.add(m); return m; };
  const hub = Math.min(0.62, H * 0.42);
  const lower = Math.max(0.12, hub * 0.3);
  const R = 0.5;
  rod(V(0, lower - 0.05, 0), V(0, H * 0.62, 0), 0.0175, tube, 14);
  rod(V(0, H * 0.58, 0), V(0, H, 0), 0.0145, tube, 14);
  for (const [y, r] of [[hub, 0.033], [lower, 0.028], [H * 0.6, 0.026]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 14), plastic);
    c.position.y = y;
    g.add(c);
  }
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 6), plastic);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.045, H * 0.6, 0);
  g.add(knob);
  for (let k = 0; k < 3; k++) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 3; // one leg towards the audience
    const c = Math.cos(a); const s = Math.sin(a);
    const foot = V(c * R, 0.02, s * R);
    rod(V(c * 0.035, hub, s * 0.035), foot, 0.012, tube, 8);
    rod(V(c * 0.03, lower, s * 0.03), V(c * 0.035, hub, s * 0.035).lerp(foot, 0.45), 0.007, tube, 6);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 10), plastic);
    pad.position.set(c * R, 0.015, s * R);
    g.add(pad);
  }
  if (speaker) {
    const sp = standSpeaker(box.width, box.height, box.depth);
    sp.position.y = H;
    g.add(sp);
  }
  return g;
}

/** Active PA speaker for a pole: slightly tapered cabinet, metal grille, top handle. */
function standSpeaker(w, h, d) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.05 });
  const cab = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(0.03, w * 0.08)), shell);
  cab.position.y = h / 2;
  g.add(cab);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, h * 0.9), new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.45, metalness: 0.7, ...pbrSet('metal', 0.4, 1) }));
  grille.position.set(0, h / 2, d / 2 + 0.003);
  g.add(grille);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.28, h * 0.035), new THREE.MeshStandardMaterial({ color: 0xbfc4ca, roughness: 0.3, metalness: 0.9 }));
  logo.position.set(0, h * 0.08, d / 2 + 0.005);
  g.add(logo);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.025, 0.05), shell);
  handle.position.y = h + 0.012;
  g.add(handle);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 14), shell);
  socket.position.y = 0.02;
  g.add(socket);
  return g;
}

// ------------------------------------------------------------------ light totem
// Square truss column between a heavy base plate and a top plate for the fixtures,
// optionally dressed in a stretch-lycra cover (white takes the colour of the lights).
function lightTotem(params) {
  const { height: H, plate, cover } = totemParams(params);
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.45, metalness: 0.6 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(plate, 0.012, plate, 2, 0.004), steel);
  base.position.y = 0.006;
  const top = new THREE.Mesh(new RoundedBoxGeometry(plate, 0.012, plate, 2, 0.004), steel);
  top.position.y = H - 0.006;
  g.add(base, top);
  if (cover) {
    const white = cover === 1;
    const mat = new THREE.MeshStandardMaterial({
      color: white ? 0xf4f4f6 : 0x0f0f11, roughness: white ? 0.75 : 0.9, metalness: 0,
      ...pbrSet('linen', plate / 0.5, H / 0.5), normalScale: new THREE.Vector2(0.3, 0.3),
    });
    const sock = new THREE.Mesh(new THREE.BoxGeometry(plate - 0.015, H - 0.03, plate - 0.015), mat);
    sock.position.y = H / 2;
    g.add(sock);
  } else {
    const t = trussSection(H - 0.024);
    t.rotation.z = Math.PI / 2;
    t.scale.set(1, 0.76, 0.76); // 22 cm square truss
    t.position.y = H / 2;
    g.add(t);
  }
  return g;
}

export function createPropModel(prop, ctx) {
  const p = { ...(PROP_TYPES[prop.type] || {}).params, ...(prop.params || {}) };
  const root = new THREE.Group();
  root.userData.objectId = prop.id;
  const animated = [];
  let extra = null;

  switch (prop.type) {
    case 'truss': root.add(trussSection(p.length)); break;
    case 'column': {
      const t = trussSection(p.length);
      t.rotation.z = Math.PI / 2;
      t.position.y = p.length / 2;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), metal());
      plate.position.y = 0.01;
      root.add(t, plate);
      break;
    }
    case 'booth': {
      // Event-style DJ booth: glossy white facade, LED strip at the bottom, black desk,
      // controller with jog wheels and a laptop on a stand.
      // White stretch-lycra facade (it takes the colour of the uplights, like the real ones).
      const facadeMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.62, metalness: 0, ...pbrSet('linen', p.width / 0.5, p.height / 0.5), normalScale: new THREE.Vector2(0.4, 0.4) });
      const facade = new THREE.Mesh(new RoundedBoxGeometry(p.width, p.height, p.depth, 3, 0.03), facadeMat);
      facade.position.y = p.height / 2;
      const top = new THREE.Mesh(new RoundedBoxGeometry(p.width + 0.1, 0.04, p.depth + 0.1, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.35, metalness: 0.3 }));
      top.position.y = p.height + 0.02;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(p.width * 0.96, 0.03), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      strip.position.set(0, 0.06, p.depth / 2 + 0.004);
      animated.push((t) => strip.material.color.setHSL((t * 0.05) % 1, 0.9, 0.45));
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(p.width * 0.5, p.height * 0.18), new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.4, metalness: 0.6 }));
      logo.position.set(0, p.height * 0.6, p.depth / 2 + 0.004);
      const cw = Math.min(0.75, p.width * 0.4);
      const ctrl = new THREE.Mesh(new RoundedBoxGeometry(cw, 0.06, 0.42, 2, 0.01), new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.4, metalness: 0.4 }));
      ctrl.position.set(0, p.height + 0.07, 0.02);
      root.add(facade, top, strip, logo, ctrl);
      for (const s of [-1, 1]) {
        const jog = new THREE.Mesh(new THREE.CylinderGeometry(cw * 0.15, cw * 0.15, 0.015, 32), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 0.9 }));
        jog.position.set(s * cw * 0.27, p.height + 0.105, 0.04);
        root.add(jog);
      }
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), metal());
      stand.position.set(cw / 2 + 0.25, p.height + 0.11, -0.05);
      const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.24), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 }));
      laptopBase.position.set(cw / 2 + 0.25, p.height + 0.21, -0.05);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.21), new THREE.MeshBasicMaterial({ color: 0x2a3f66 }));
      screen.position.set(cw / 2 + 0.25, p.height + 0.32, -0.17);
      screen.rotation.x = -0.25;
      screen.material.side = THREE.DoubleSide;
      root.add(stand, laptopBase, screen);
      // The DJ behind the desk, hands on the controller (animated on the show's BPM).
      if (Number(p.dj) > 0) extra = djFigure(root, { x: 0, z: -(p.depth / 2 + DJ_BEHIND), heading: 0, look: Number(p.djLook) || 1, desk: p.height }, animated, ctx);
      break;
    }
    case 'speaker': case 'sub': root.add(speakerFront(p.width, p.height, p.depth)); break;
    case 'platform': {
      // Stage riser with black carpet.
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, p.depth), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.95, ...pbrSet('carpet', p.width / PBR_TILE.carpet, p.depth / PBR_TILE.carpet) }));
      m.position.y = p.height / 2;
      root.add(m);
      break;
    }
    case 'screen': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.06, 0.08), black());
      frame.position.y = p.height / 2;
      const mat = new THREE.MeshBasicMaterial({ color: 0x080810, toneMapped: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), mat);
      face.position.set(0, p.height / 2, 0.041);
      animated.push((t) => {
        const h = (t * 0.03) % 1;
        mat.color.setHSL(h, 0.7, 0.08 + 0.04 * Math.sin(t * 2));
      });
      root.add(frame, face);
      break;
    }
    case 'wall': {
      // Backdrop: velvet drape (sheen at grazing angles).
      const vel = pbrSet('velvet', p.width / PBR_TILE.velvet, p.height / PBR_TILE.velvet);
      const col = new THREE.Color(prop.color || 0x2a2a30);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshPhysicalMaterial({ color: col, ...vel, roughness: 0.9, sheen: 1, sheenRoughness: 0.45, sheenColor: col.clone().lerp(new THREE.Color(0xffffff), 0.3), side: THREE.DoubleSide }));
      m.position.y = p.height / 2;
      root.add(m);
      break;
    }
    case 'table': {
      // Tablecloth down to the floor, a centerpiece and a candle glow.
      const r = p.diameter / 2;
      const cloth = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, 0.76, 40, 1), new THREE.MeshStandardMaterial({ color: 0xefebe3, roughness: 0.92, ...pbrSet('linen', (Math.PI * p.diameter) / PBR_TILE.linen, 0.76 / PBR_TILE.linen) }));
      cloth.position.y = 0.38;
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.35, 16), new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 0.8, roughness: 0.3 }));
      vase.position.y = 0.76 + 0.175;
      const flowers = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf3d7dc, roughness: 0.8 }));
      flowers.position.y = 0.76 + 0.42;
      const candle = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false }));
      candle.position.set(r * 0.45, 0.82, 0);
      const flicker = Math.random() * 10;
      animated.push((tt) => {
        const f = 1.6 + 0.5 * Math.sin(tt * 13 + flicker) * Math.sin(tt * 7.3 + flicker);
        candle.material.color.setRGB(f, f * 0.62, f * 0.25);
      });
      root.add(cloth, vase, flowers, candle);
      // Chiavari-style chairs around the table.
      const chairs = chairCount(p.diameter);
      const gold = new THREE.MeshStandardMaterial({ color: 0xc9a45c, metalness: 0.7, roughness: 0.35 });
      const cushion = new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 0.9 });
      const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), cushion, chairs);
      const frame = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.45, 0.03), gold, chairs * 2);
      const back = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, 0.03), gold, chairs);
      const m4 = new THREE.Matrix4(); const q4 = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1);
      const legs = new THREE.Matrix4();
      for (let i = 0; i < chairs; i++) {
        const a = (i / chairs) * Math.PI * 2;
        const rr = r + CHAIR_OFFSET;
        q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
        const at = (dist, y) => new THREE.Vector3(Math.cos(a) * dist, y, Math.sin(a) * dist);
        seat.setMatrixAt(i, m4.compose(at(rr, 0.46), q4, one));
        back.setMatrixAt(i, m4.compose(at(rr + 0.2, 0.74), q4, one));
        frame.setMatrixAt(i * 2, legs.compose(at(rr - 0.18, 0.22), q4, one));
        frame.setMatrixAt(i * 2 + 1, legs.compose(at(rr + 0.18, 0.22), q4, one));
      }
      root.add(seat, frame, back);
      extra = seatedGuests(root, p, prop.id, animated, ctx);
      break;
    }
    case 'crowd': extra = crowdModel(root, p, prop.seed || 7, animated, ctx); break;
    case 'case': root.add(roadCase(p)); break;
    case 'tripod': root.add(tripodStand(p)); break;
    case 'speakerstand': root.add(speakerStand(p)); break;
    case 'totem': root.add(lightTotem(p)); break;
    case 'headtable': {
      const cloth = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9, ...pbrSet('linen', p.width / PBR_TILE.linen, 0.76 / PBR_TILE.linen) });
      const top = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.76, p.depth), cloth);
      top.position.y = 0.38;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.02, 0.6, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8c7a8, roughness: 0.8 }));
      skirt.position.set(0, 0.42, p.depth / 2 + 0.01);
      root.add(top, skirt);
      break;
    }
    case 'dancefloor': {
      // Black gloss panels with grooves (the floor reflection / finish comes on top).
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.03, p.depth), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.4, ...pbrSet('dancefloor', p.width / PBR_TILE.dancefloor, p.depth / PBR_TILE.dancefloor) }));
      m.position.y = 0.015;
      root.add(m);
      break;
    }
    case 'mirrorball':
      extra = mirrorBall(root, p, ctx);
      break;
    default: break;
  }

  return {
    root,
    needsEmitters: !!(extra && extra.needsEmitters),
    update(t, env) {
      for (const fn of animated) fn(t, env);
      if (extra) extra.update(t, env);
    },
    dispose() {
      if (extra) extra.dispose();
      root.traverse((o) => {
        if (o.geometry && !sharedGeos.has(o.geometry)) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };
}

// ------------------------------------------------------------------ Mirror ball
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Ray from inside the room box to its walls/floor/ceiling (null when it escapes). */
function hitRoom(o, d, box, walls) {
  let t = Infinity;
  const test = (num, den) => { if (Math.abs(den) > 1e-6) { const v = num / den; if (v > 0 && v < t) t = v; } };
  if (d.y < 0) test(box.min.y - o.y, d.y);
  if (walls) {
    if (d.y > 0) test(box.max.y - o.y, d.y);
    test((d.x > 0 ? box.max.x : box.min.x) - o.x, d.x);
    test((d.z > 0 ? box.max.z : box.min.z) - o.z, d.z);
  }
  return Number.isFinite(t) ? t : null;
}

function mirrorBall(root, p, ctx) {
  const r = p.diameter / 2;
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 3),
    new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.18, flatShading: true, emissive: 0x000000 }),
  );
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, p.drop, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  rod.position.y = r + p.drop / 2;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  motor.position.y = r + p.drop;
  root.add(ball, rod, motor);

  // Fixed reflection directions; the ball's rotation spins them around Y.
  const N = 220;
  const dirs = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    dirs.push(new THREE.Vector3(s * Math.cos(a), z * 0.85 - 0.15, s * Math.sin(a)).normalize());
  }
  const dots = new Particles(N, { additive: true, hard: true });
  const rayPos = new Float32Array(N * 6);
  const rayCol = new Float32Array(N * 6);
  const rayGeo = new THREE.BufferGeometry();
  rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3).setUsage(THREE.DynamicDrawUsage));
  rayGeo.setAttribute('color', new THREE.BufferAttribute(rayCol, 3).setUsage(THREE.DynamicDrawUsage));
  const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  rays.frustumCulled = false;
  rays.raycast = () => {};
  ctx.world.add(dots.points, rays);
  const light = [0, 0, 0];

  return {
    needsEmitters: true,
    update(t, env) {
      ball.rotation.y = t * (p.rpm / 60) * Math.PI * 2;
      // Light reaching the ball from fixtures whose beam cone contains it.
      ball.getWorldPosition(_c);
      light[0] = light[1] = light[2] = 0;
      for (const e of (env && env.emitters) || []) {
        _d.copy(_c).sub(e.pos).normalize();
        if (_d.dot(e.dir) < e.cosHalf) continue;
        light[0] += e.color[0] * e.intensity; light[1] += e.color[1] * e.intensity; light[2] += e.color[2] * e.intensity;
      }
      const lvl = Math.min(1.5, Math.max(light[0], light[1], light[2]));
      ball.material.emissive.setRGB(light[0] * 0.25, light[1] * 0.25, light[2] * 0.25);
      dots.count = 0;
      let n = 0;
      if (lvl > 0.01) {
        const haze = env ? env.globals.rawHaze : 0.5;
        _q.setFromAxisAngle(_up, ball.rotation.y);
        for (const d0 of dirs) {
          _d.copy(d0).applyQuaternion(_q);
          const hitT = hitRoom(_c, _d, ctx.roomBox, ctx.walls);
          if (hitT == null) continue;
          const hx = _c.x + _d.x * hitT; const hy = _c.y + _d.y * hitT; const hz = _c.z + _d.z * hitT;
          dots.spawn(hx, hy, hz, 0, 0, 0, 1, 0.05 + hitT * 0.006, light[0] * 1.6, light[1] * 1.6, light[2] * 1.6);
          const k = n * 6;
          rayPos[k] = _c.x; rayPos[k + 1] = _c.y; rayPos[k + 2] = _c.z;
          rayPos[k + 3] = hx; rayPos[k + 4] = hy; rayPos[k + 5] = hz;
          const rc = 0.07 * haze;
          for (let j = 0; j < 2; j++) { rayCol[k + j * 3] = light[0] * rc; rayCol[k + j * 3 + 1] = light[1] * rc; rayCol[k + j * 3 + 2] = light[2] * rc; }
          n++;
        }
      }
      rayGeo.setDrawRange(0, n * 2);
      rayGeo.attributes.position.needsUpdate = true;
      rayGeo.attributes.color.needsUpdate = true;
      dots.update(0, {}, (i, tt, o) => { o.alpha = 1; });
    },
    dispose() {
      ctx.world.remove(dots.points, rays);
      dots.dispose();
      rayGeo.dispose();
      rays.material.dispose();
    },
  };
}
