// Bakes the animated wedding guests (public/models/guests.bin) from Quaternius'
// "Universal Animation Library" 1 + 2 (CC0): the male mannequin, the female mannequin
// and their animation clips.
//
//   node --import ./test/helpers/three-loader.mjs tools/bake-guests.mjs UAL1_Standard.glb UAL2_Standard.glb Mannequin_F.glb [out.bin]
//
// What it does (all offline, so the app only loads one small binary):
// - merges each mannequin's body + joint meshes, welds and simplifies them;
// - paints clothing regions (skin, jacket / bodice, trousers / skirt, shoes, shirt, tie,
//   sleeves, hair) from the bone weights in the bind pose, and adds garments the
//   mannequins do not have (long and short skirts, hair, bun) skinned to the same bones;
// - samples every clip at 30 fps into bone matrices (3×4, half floats). A few dances are
//   layered on the real "Dance_Loop" (arms up, fist pump, slow sway) so the dance floor
//   does not move like one person. Beat-locked clips last a whole number of beats at 120 BPM.
// - the DJ behind the booth (djMix / djHand / djHeadphone): a still pose, hands on the
//   controller by two-bone IK, nodding on the beat (see DJ_* in guest-layout.js).
// Runtime: public/js/guests3d.js (one InstancedMesh per body, skinning in the vertex shader).
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { GUEST_REGIONS as R, DJ_HEIGHT, DJ_DESK, DJ_REACH } from '../public/js/guest-layout.js';

const [ual1Path, ual2Path, femPath, outPath = 'public/models/guests.bin'] = process.argv.slice(2);
if (!femPath) { console.error('usage: bake-guests.mjs UAL1_Standard.glb UAL2_Standard.glb Mannequin_F.glb [out.bin]'); process.exit(1); }
const FPS = 30;
const TARGET_TRIS = { male: 7000, female: 7000 };
// Low-detail bodies (seated guests, Medie quality): fewer triangles, coarser garments.
const TARGET_TRIS_LO = 2400;
let LOW = false;

const load = (f) => new Promise((res, rej) => {
  const b = fs.readFileSync(f);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej);
});
const ual1 = await load(ual1Path);
const ual2 = await load(ual2Path);
const fem = await load(femPath);
const allClips = [...ual1.animations, ...ual2.animations];
const clipByName = (n) => { const c = allClips.find((a) => a.name === n); if (!c) throw new Error(`clip ${n} missing`); return c; };

// ------------------------------------------------------------------ geometry
function skinnedMeshes(gltf) {
  const out = [];
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) out.push(o); });
  return out;
}

/** Body + joints in one indexed geometry, vertices welded by position. */
function mergedBody(gltf) {
  const meshes = skinnedMeshes(gltf);
  const pos = []; const nor = []; const si = []; const sw = []; const idx = [];
  const map = new Map();
  for (const m of meshes) {
    const g = m.geometry;
    const P = g.attributes.position; const N = g.attributes.normal; const I = g.attributes.skinIndex; const W = g.attributes.skinWeight;
    const local = new Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const key = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
      let k = map.get(key);
      if (k === undefined) {
        k = pos.length / 3;
        map.set(key, k);
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        nor.push(0, 0, 0);
        si.push(I.getX(i), I.getY(i), I.getZ(i), I.getW(i));
        sw.push(W.getX(i), W.getY(i), W.getZ(i), W.getW(i));
      }
      nor[k * 3] += N.getX(i); nor[k * 3 + 1] += N.getY(i); nor[k * 3 + 2] += N.getZ(i);
      local[i] = k;
    }
    const gi = g.index;
    for (let t = 0; t < gi.count; t++) idx.push(local[gi.getX(t)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.normalizeNormals();
  return { geometry: g, skeleton: meshes[0].skeleton, root: gltf.scene };
}

/** Edge-collapse simplification that keeps the skin attributes of the surviving vertices. */
function simplify(geo, targetTris) {
  const tris = geo.index.count / 3;
  if (tris <= targetTris) return geo;
  const n = geo.attributes.position.count;
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', geo.attributes.position.clone());
  tmp.setIndex(geo.index.clone());
  // Remember which original vertex each one is (the modifier only moves vertices onto others).
  const id = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) id[i * 2] = i;
  tmp.setAttribute('uv', new THREE.BufferAttribute(id, 2));
  const simp = new SimplifyModifier().modify(tmp, Math.floor(n * (1 - targetTris / tris)));
  const ids = simp.attributes.uv;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const src = geo.attributes[name];
    const arr = new src.array.constructor(ids.count * src.itemSize);
    for (let i = 0; i < ids.count; i++) {
      const o = Math.round(ids.getX(i));
      for (let c = 0; c < src.itemSize; c++) arr[i * src.itemSize + c] = src.array[o * src.itemSize + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
  }
  out.setIndex(simp.index ? simp.index.clone() : [...Array(ids.count).keys()]);
  return out;
}

const boneIndex = (skel, name) => { const i = skel.bones.findIndex((b) => b.name === name); if (i < 0) throw new Error(`bone ${name}`); return i; };
const worldPos = (skel, name) => skel.bones[boneIndex(skel, name)].getWorldPosition(new THREE.Vector3());

/** Dominant bone name per vertex. */
function dominant(geo, skel) {
  const I = geo.attributes.skinIndex; const W = geo.attributes.skinWeight;
  const out = new Array(I.count);
  for (let i = 0; i < I.count; i++) {
    let best = 0; let bw = -1;
    for (let c = 0; c < 4; c++) { const w = W.getComponent(i, c); if (w > bw) { bw = w; best = I.getComponent(i, c); } }
    out[i] = skel.bones[best].name;
  }
  return out;
}

function headInfo(geo, dom) {
  const P = geo.attributes.position;
  const box = new THREE.Box3();
  for (let i = 0; i < P.count; i++) if (dom[i] === 'Head') box.expandByPoint(new THREE.Vector3().fromBufferAttribute(P, i));
  return { box, c: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
}

/** Clothing regions painted on the mannequin. */
function paintRegions(geo, skel, female) {
  const dom = dominant(geo, skel);
  const P = geo.attributes.position;
  const head = headInfo(geo, dom);
  const hip = worldPos(skel, 'thigh_l').y;
  const handX = Math.abs(worldPos(skel, 'hand_l').x);
  const region = new Uint8Array(P.count);
  const p = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    const b = dom[i];
    const ax = Math.abs(p.x);
    let r = R.skin;
    if (b === 'Head') {
      const top = head.box.max.y - (female ? 0.075 : 0.06);
      const back = p.z < head.c.z - (female ? 0.0 : 0.025) && p.y > head.box.min.y + (female ? 0.03 : 0.07);
      const side = ax > head.size.x * 0.4 && p.y > head.c.y + 0.0 && p.z < head.c.z + 0.02;
      r = p.y > top || back || side ? R.hair : R.skin;
    } else if (b === 'neck_01') {
      r = female ? R.skin : (p.y < 1.5 ? R.shirt : R.skin);
      if (female && p.z < head.c.z - 0.03 && p.y > 1.5) r = R.hair;
    } else if (/^(hand|index|middle|pinky|ring|thumb)/.test(b)) r = R.skin;
    else if (/^(upperarm|lowerarm)/.test(b)) r = !female && ax > handX - 0.035 ? R.shirt : R.arms;
    else if (/^(spine|clavicle)/.test(b) || (b === 'pelvis' && p.y > hip + (female ? 0.07 : 0.02))) {
      r = R.top;
      if (!female && p.z > 0.02 && p.y > 1.22) {
        const w = p.y > 1.47 ? 0.06 : 0.06 * Math.max(0, (p.y - 1.27) / 0.2);
        if (ax < w) r = R.shirt;
        if (ax < 0.014 + 0.012 * Math.max(0, (1.44 - p.y) / 0.22) && p.y < 1.445 && p.y > 1.2) r = R.tie;
      }
      if (female && ((p.z > 0.0 && p.y > 1.36 && ax < 0.13) || p.y > 1.43)) r = R.skin; // neckline, bare shoulders
    } else if (b === 'pelvis' || /^(thigh|calf)/.test(b)) r = female ? (b === 'pelvis' ? R.top : R.skin) : R.bottom;
    else if (/^(foot|ball)/.test(b)) r = R.shoes;
    region[i] = r;
  }
  geo.setAttribute('region', new THREE.BufferAttribute(region, 1));
  return { head, dom };
}

/**
 * Mannequin → clothes: smooth away the muscle detail under the clothes and push them out
 * a little (a jacket stands off the body more than trousers).
 */
function clothe(geo, female) {
  const P = geo.attributes.position; const reg = geo.attributes.region.array;
  const n = P.count;
  const nb = Array.from({ length: n }, () => new Set());
  const I = geo.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]; const b = I[t + 1]; const c = I[t + 2];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  const cloth = female ? new Set([R.top]) : new Set([R.top, R.arms, R.bottom, R.shirt, R.tie]);
  const pos = P.array;
  for (let it = 0; it < (female ? 1 : 3); it++) {
    const next = pos.slice();
    for (let i = 0; i < n; i++) {
      if (!cloth.has(reg[i]) || !nb[i].size) continue;
      let x = 0; let y = 0; let z = 0;
      for (const j of nb[i]) { x += pos[j * 3]; y += pos[j * 3 + 1]; z += pos[j * 3 + 2]; }
      const k = nb[i].size;
      next[i * 3] = 0.5 * pos[i * 3] + 0.5 * x / k;
      next[i * 3 + 1] = 0.5 * pos[i * 3 + 1] + 0.5 * y / k;
      next[i * 3 + 2] = 0.5 * pos[i * 3 + 2] + 0.5 * z / k;
    }
    pos.set(next);
  }
  geo.computeVertexNormals();
  const N = geo.attributes.normal.array;
  const push = female ? { [R.top]: 0.003 } : { [R.top]: 0.013, [R.shirt]: 0.012, [R.tie]: 0.016, [R.arms]: 0.009, [R.bottom]: 0.007 };
  for (let i = 0; i < n; i++) {
    const d = push[reg[i]] || 0;
    if (!d) continue;
    for (let c = 0; c < 3; c++) pos[i * 3 + c] += N[i * 3 + c] * d;
  }
  P.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Ellipse (rx, rz, cz) that holds the body (no arms) around height y. */
function bodyRing(geo, dom, y, band = 0.03) {
  const P = geo.attributes.position;
  let rx = 0.05; let zMin = 1; let zMax = -1;
  for (let i = 0; i < P.count; i++) {
    const py = P.getY(i);
    if (Math.abs(py - y) > band || /arm|hand|index|middle|pinky|ring|thumb/.test(dom[i])) continue;
    rx = Math.max(rx, Math.abs(P.getX(i)));
    zMin = Math.min(zMin, P.getZ(i)); zMax = Math.max(zMax, P.getZ(i));
  }
  if (zMax < zMin) { zMin = -0.08; zMax = 0.08; }
  return { rx, rz: (zMax - zMin) / 2, cz: (zMax + zMin) / 2 };
}

/**
 * Skinned garment: a flared skirt (lathe) from the waist to `hemY`, hem radius `hemR`.
 * opts.top: waist height above the hip joints; opts.ease: extra room over the body.
 */
function skirt(body, skel, dom, hemY, hemR, regionId, opts = {}) {
  const waistY = worldPos(skel, 'thigh_l').y + (opts.top ?? 0.15);
  const ease = opts.ease ?? 0.02;
  const rings = LOW ? Math.max(3, Math.round((opts.rings || 10) * 0.6)) : (opts.rings || 10); const seg = LOW ? 16 : 28;
  const pel = boneIndex(skel, 'pelvis'); const tl = boneIndex(skel, 'thigh_l'); const trr = boneIndex(skel, 'thigh_r');
  const cl = boneIndex(skel, 'calf_l'); const cr = boneIndex(skel, 'calf_r');
  const pos = []; const si = []; const sw = []; const idx = []; const reg = [];
  const kneeY = worldPos(skel, 'calf_l').y;
  let prev = null;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = waistY + (hemY - waistY) * t;
    const fit = bodyRing(body, dom, y, 0.035);
    // A-line: never narrower than the body (+ ease), never narrower than the ring above.
    const flare = hemR * Math.min(1, 0.25 + 0.75 * Math.pow(t, 0.9));
    // Extra room over the hips so the thighs do not poke through when the knees bend.
    const room = ease + (opts.hipRoom ?? 0.05) * THREE.MathUtils.smoothstep(t, 0, 0.3);
    let rx = Math.max(fit.rx + room, t > 0.12 ? flare : 0);
    let rz = Math.max(fit.rz + room, t > 0.12 ? flare * 0.95 : 0);
    if (prev) { rx = Math.max(rx, prev.rx); rz = Math.max(rz, prev.rz); }
    const cz = THREE.MathUtils.lerp(fit.cz, 0, Math.min(1, t * 0.8));
    prev = { rx, rz };
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = Math.sin(a) * rx; const z = cz + Math.cos(a) * rz;
      pos.push(x, y, z);
      reg.push(regionId);
      // Waist on the pelvis; lower down the legs pull the cloth (left half → left leg),
      // the front more than the back (knees push the cloth forward).
      const s = THREE.MathUtils.clamp(x / (rx * 0.6), -1, 1);
      const front = Math.max(0, Math.cos(a));
      const legW = Math.min(0.9, (opts.pull ?? 0.8) * (0.3 + 0.7 * front) * Math.min(1, t * 3));
      const belowKnee = y < kneeY ? Math.min(1, (kneeY - y) / 0.3) * 0.2 : 0;
      const wl = legW * (0.5 + 0.5 * s); const wr = legW * (0.5 - 0.5 * s);
      si.push(pel, s >= 0 ? tl : trr, s >= 0 ? cl : cr, s >= 0 ? trr : tl);
      const main = s >= 0 ? wl : wr; const other = s >= 0 ? wr : wl;
      const calf = main * belowKnee;
      sw.push(1 - legW, main - calf, calf, other);
    }
  }
  // Inside of the cloth (seen from below): own vertices a few mm in, so normals face inwards.
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]; const z = pos[i * 3 + 2];
    const l = Math.hypot(x, z) || 1;
    pos.push(x - (x / l) * 0.004, pos[i * 3 + 1], z - (z / l) * 0.004);
    reg.push(reg[i]);
    si.push(si[i * 4], si[i * 4 + 1], si[i * 4 + 2], si[i * 4 + 3]);
    sw.push(sw[i * 4], sw[i * 4 + 1], sw[i * 4 + 2], sw[i * 4 + 3]);
  }
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < seg; k++) {
      const a = j * seg + k; const b = j * seg + ((k + 1) % seg); const c = a + seg; const d = b + seg;
      idx.push(a, c, b, b, c, d); // outside
      idx.push(a + n, b + n, c + n, b + n, d + n, c + n); // inside
    }
  }
  return garment(pos, si, sw, reg, idx);
}

/** Ellipsoid shell around a point, skinned to one or two bones (hair, bun). */
function blob(center, radii, regionId, bones, wsplit = null, opts = {}) {
  const geo = new THREE.SphereGeometry(1, LOW ? 10 : (opts.w || 16), LOW ? 7 : (opts.h || 12), 0, Math.PI * 2, opts.t0 || 0, opts.t1 || Math.PI);
  const P = geo.attributes.position;
  const pos = []; const si = []; const sw = []; const reg = [];
  const tilt = opts.tilt || 0; const ct = Math.cos(tilt); const st = Math.sin(tilt);
  for (let i = 0; i < P.count; i++) {
    // Ellipsoid, tilted about X around its centre (positive tilt: front edge up, back down).
    const ly = P.getY(i) * radii.y; const lz = P.getZ(i) * radii.z;
    const x = center.x + P.getX(i) * radii.x; const y = center.y + ly * ct + lz * st; const z = center.z - ly * st + lz * ct;
    pos.push(x, y, z);
    reg.push(regionId);
    const w = wsplit ? wsplit(y) : 1;
    si.push(bones[0], bones[1] ?? bones[0], 0, 0);
    sw.push(w, 1 - w, 0, 0);
  }
  return garment(pos, si, sw, reg, [...geo.index.array]);
}

function garment(pos, si, sw, reg, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('region', new THREE.BufferAttribute(new Uint8Array(reg), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function append(base, extra) {
  const out = new THREE.BufferGeometry();
  const off = base.attributes.position.count;
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight', 'region']) {
    const a = base.attributes[name]; const b = extra.attributes[name];
    const arr = new a.array.constructor(a.array.length + b.array.length);
    arr.set(a.array); arr.set(b.array, a.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex([...base.index.array, ...[...extra.index.array].map((i) => i + off)]);
  return out;
}

function buildBody(gltf, female, target) {
  const { geometry, skeleton, root } = mergedBody(gltf);
  root.updateMatrixWorld(true);
  let geo = simplify(geometry, target);
  geo.computeVertexNormals();
  const { head, dom } = paintRegions(geo, skeleton, female);
  clothe(geo, female);
  const headB = boneIndex(skeleton, 'Head'); const neckB = boneIndex(skeleton, 'neck_01'); const chestB = boneIndex(skeleton, 'spine_03');
  const hc = head.c; const hs = head.size;
  if (female) {
    geo = append(geo, skirt(geo, skeleton, dom, 0.02, 0.4, R.bottom, { rings: 12 }));
    geo = append(geo, skirt(geo, skeleton, dom, 0.5, 0.2, R.skirtShort, { pull: 0.85, hipRoom: 0.035 }));
    // Hair: a cap over the painted hair, a bun, and long hair down the back (alternatives per guest).
    geo = append(geo, blob(new THREE.Vector3(hc.x, hc.y + hs.y * 0.04, hc.z - hs.z * 0.04), new THREE.Vector3(hs.x * 0.56, hs.y * 0.52, hs.z * 0.57), R.hair, [headB], null, { t1: Math.PI * 0.5, tilt: 0.45 }));
    geo = append(geo, blob(new THREE.Vector3(hc.x, hc.y + hs.y * 0.12, hc.z - hs.z * 0.55), new THREE.Vector3(0.05, 0.05, 0.045), R.bun, [headB]));
    geo = append(geo, blob(new THREE.Vector3(hc.x, hc.y - hs.y * 0.32, hc.z - hs.z * 0.32), new THREE.Vector3(hs.x * 0.52, hs.y * 0.62, hs.z * 0.3), R.hairLong, [headB, neckB],
      (y) => THREE.MathUtils.clamp((y - (hc.y - hs.y * 0.5)) / (hs.y * 0.5), 0, 1)));
  } else {
    // Jacket skirt over the hips: a suit, not a body suit.
    geo = append(geo, skirt(geo, skeleton, dom, worldPos(skeleton, 'thigh_l').y - 0.13, 0, R.hem, { top: 0.1, ease: 0.014, pull: 0.9, rings: 4, hipRoom: 0.012 }));
    geo = append(geo, blob(new THREE.Vector3(hc.x, hc.y + hs.y * 0.06, hc.z - hs.z * 0.05), new THREE.Vector3(hs.x * 0.54, hs.y * 0.48, hs.z * 0.56), R.hair, [headB], null, { t1: Math.PI * 0.42, tilt: 0.5 }));
  }
  void chestB;
  return { geometry: geo, skeleton, root };
}

// ------------------------------------------------------------------ animation
const _q = new THREE.Quaternion();

/** Rotate `bone` (world space) so it points from itself to `child` along `dirWorld`. */
function pointBone(bone, child, dirWorld) {
  bone.updateWorldMatrix(true, true);
  const a = bone.getWorldPosition(new THREE.Vector3());
  const b = child.getWorldPosition(new THREE.Vector3());
  const cur = b.sub(a).normalize();
  const delta = _q.setFromUnitVectors(cur, dirWorld.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const target = delta.multiply(world);
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateWorldMatrix(false, true);
}

/**
 * Arm pose in the chest frame. Each segment is [elevation, sweep] in degrees: elevation 0 =
 * horizontal, 90 = up, −90 = down; sweep 0 = out to the side, 90 = forward, 180 = across the body.
 */
function poseArm(get, side, upperDeg, foreDeg, chestNow, chestBind) {
  const sgn = side === 'l' ? 1 : -1;
  const rot = chestNow.clone().multiply(chestBind.clone().invert());
  const dir = ([elev, sweep]) => {
    const e = THREE.MathUtils.degToRad(elev); const f = THREE.MathUtils.degToRad(sweep);
    return new THREE.Vector3(sgn * Math.cos(e) * Math.cos(f), Math.sin(e), Math.cos(e) * Math.sin(f)).applyQuaternion(rot);
  };
  pointBone(get(`upperarm_${side}`), get(`lowerarm_${side}`), dir(upperDeg));
  pointBone(get(`lowerarm_${side}`), get(`hand_${side}`), dir(foreDeg));
}

/**
 * Clip definitions: `beats` > 0 → beat-locked (the clip lasts that many beats at the
 * runtime BPM; source time is scaled so it does at 120 BPM), else free-running seconds.
 * `hit`: loop fraction where the beat lands (pelvis lowest).
 */
const CLIPS = [
  { name: 'dance', src: 'Dance_Loop', beats: 2, hit: 8 / 30 },
  { name: 'danceUp', src: 'Dance_Loop', beats: 2, hit: 8 / 30, layer: 'armsUp' },
  { name: 'dancePump', src: 'Dance_Loop', beats: 2, hit: 8 / 30, layer: 'pump' },
  { name: 'sway', src: 'Idle_Loop', beats: 4, hit: 0, layer: 'sway', srcLen: 2.5 },
  { name: 'talk', src: 'Idle_Talking_Loop' },
  { name: 'idle', src: 'Idle_Loop' },
  { name: 'fold', src: 'Idle_FoldArms_Loop' },
  { name: 'phone', src: 'Idle_TalkingPhone_Loop' },
  { name: 'sit', src: 'Sitting_Idle_Loop' },
  { name: 'sitTalk', src: 'Sitting_Talking_Loop' },
  // The DJ behind the booth: a still standing pose with everything else procedural (hands on
  // the controller by IK, nodding on the beat). 20 fps is plenty for these slow moves.
  { name: 'djMix', src: 'Idle_Loop', beats: 2, hit: 0, layer: 'djMix', still: true, fps: 20 },
  { name: 'djHand', src: 'Idle_Loop', beats: 4, hit: 0, layer: 'djHand', still: true, fps: 20 },
  { name: 'djHeadphone', src: 'Idle_Loop', beats: 4, hit: 0, layer: 'djHeadphone', still: true, fps: 20 },
];

function bakeClips(body, female, usedBones) {
  const { root, skeleton } = body;
  const get = (n) => skeleton.bones[boneIndex(skeleton, n)];
  // Bind-pose chest rotation (arms are posed relative to the chest).
  skeleton.pose();
  root.updateMatrixWorld(true);
  const chestBind = get('spine_03').getWorldQuaternion(new THREE.Quaternion());
  // DJ clips are posed in metres of the app: the runtime scales this body to DJ_HEIGHT.
  const djScale = (female ? DJ_HEIGHT.female : DJ_HEIGHT.male) / new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position).max.y * 1.02;
  const rows = [];
  const meta = [];
  const mixer = new THREE.AnimationMixer(root);
  for (const def of CLIPS) {
    let clip = clipByName(def.src);
    if (female) {
      // Keep the female proportions: only the root / pelvis may move.
      clip = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => !t.name.endsWith('.position') || /^(root|pelvis)\./.test(t.name)));
    }
    const seconds = def.beats ? def.beats * 0.5 : clip.duration;
    const frames = Math.max(2, Math.round(seconds * (def.fps || FPS)));
    const action = mixer.clipAction(clip);
    action.play();
    const start = rows.length;
    for (let f = 0; f < frames; f++) {
      const u = f / frames; // loop fraction
      const srcLen = def.srcLen || clip.duration;
      skeleton.pose();
      mixer.setTime(def.still ? 0 : (def.beats ? u * Math.min(srcLen, clip.duration) : u * clip.duration) % clip.duration);
      root.updateMatrixWorld(true);
      if (def.layer && def.layer.startsWith('dj')) djLayer(def.layer, u, def.beats, get, djScale);
      else if (def.layer) applyLayer(def.layer, u, def.beats, get, chestBind);
      root.updateMatrixWorld(true);
      const row = new Float32Array(usedBones.length * 12);
      const m = new THREE.Matrix4();
      usedBones.forEach((bi, k) => {
        m.multiplyMatrices(skeleton.bones[bi].matrixWorld, skeleton.boneInverses[bi]);
        const e = m.elements; // column-major
        // Rows of the 3×4 matrix: (m00 m01 m02 m03), (m10 …), (m20 …)
        for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) row[k * 12 + r * 4 + c] = e[c * 4 + r];
      });
      rows.push(row);
    }
    action.stop();
    mixer.uncacheAction(clip);
    meta.push({ name: def.name, row: start, frames, beats: def.beats || 0, seconds, hit: def.hit || 0 });
  }
  return { rows, meta };
}

function applyLayer(layer, u, beats, get, chestBind) {
  const chest = get('spine_03').getWorldQuaternion(new THREE.Quaternion());
  const beat = u * beats; // 0..beats
  const ph = beat % 1;
  const s = Math.sin(beat * Math.PI * 2);
  if (layer === 'armsUp') {
    // Both hands up, waving left / right with the music.
    const sway = Math.sin(u * Math.PI * 2);
    poseArm(get, 'l', [58 + 10 * sway, 25], [80 + 6 * s, 120], chest, chestBind);
    poseArm(get, 'r', [58 - 10 * sway, 25], [80 - 6 * s, 120], chest, chestBind);
  } else if (layer === 'pump') {
    // Right fist pumping on every beat.
    const k = Math.pow(1 - ph, 3);
    poseArm(get, 'r', [35 + 35 * k, 45], [75 + 10 * k, 100], chest, chestBind);
  } else if (layer === 'sway') {
    // Slow dance: hips rock once per two beats, knees give on the beat, hands in front.
    const rock = Math.sin(u * Math.PI * 2 * (beats / 2));
    const dip = 0.5 - 0.5 * Math.cos(beat * Math.PI * 2);
    const pelvis = get('pelvis');
    pelvis.position.x += 0.035 * rock;
    pelvis.position.y -= 0.018 * dip;
    pelvis.rotateZ(0.05 * rock);
    get('spine_02').rotateZ(-0.07 * rock);
    get('thigh_l').rotateZ(-0.05 * rock); get('thigh_r').rotateZ(-0.05 * rock);
    get('pelvis').updateWorldMatrix(true, true);
    const ch = get('spine_03').getWorldQuaternion(new THREE.Quaternion());
    poseArm(get, 'l', [-62 + 5 * rock, 40], [-8, 115], ch, chestBind);
    poseArm(get, 'r', [-62 - 5 * rock, 40], [-8, 115], ch, chestBind);
  }
}

// ------------------------------------------------------------------ the DJ
/** Rotate a bone by `angle` around a world axis (parents may be rotated). */
function turnWorld(bone, axis, angle) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const target = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(world);
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(target));
  bone.updateWorldMatrix(false, true);
}

/** Two-bone IK: wrist of `side` to `target` (world), elbow bending towards `pole`. */
function reach(get, side, target, pole) {
  const up = get(`upperarm_${side}`); const lo = get(`lowerarm_${side}`); const hand = get(`hand_${side}`);
  up.updateWorldMatrix(true, true);
  const A = up.getWorldPosition(new THREE.Vector3());
  const B = lo.getWorldPosition(new THREE.Vector3());
  const C = hand.getWorldPosition(new THREE.Vector3());
  const l1 = A.distanceTo(B); const l2 = B.distanceTo(C);
  const toT = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const dir = toT.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = A.clone().addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  const wrist = A.clone().addScaledVector(dir, d);
  pointBone(up, lo, elbow.clone().sub(A));
  pointBone(lo, hand, wrist.sub(elbow));
}

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

/**
 * DJ poses (the figure faces +z, its left hand is +x). Positions are in app metres and
 * divided by `scale` (the runtime scale of this body), so the wrists land on a controller
 * on a DJ_DESK-high booth, DJ_REACH in front of the DJ, whatever the body.
 */
function djLayer(layer, u, beats, get, scale) {
  const beat = u * beats;
  const ph = beat % 1;
  const nod = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2); // 1 on the beat
  const V = (x, y, z) => new THREE.Vector3(x / scale, y / scale, z / scale);
  // Lean over the decks, knees give a little on the beat, head nods.
  const pelvis = get('pelvis');
  pelvis.position.y -= (0.012 * nod) / scale;
  pelvis.updateWorldMatrix(true, true);
  turnWorld(get('spine_01'), X, 0.1);
  turnWorld(get('spine_02'), X, 0.05 + 0.03 * nod);
  turnWorld(get('neck_01'), X, 0.14 + 0.12 * nod);
  // Wrist height and distance for hands resting on the controller.
  const wy = DJ_DESK + 0.15; const wz = DJ_REACH;
  // Left hand on the left jog wheel (slow circles), right hand on the mixer / right jog.
  const a = beat * Math.PI;
  const left = V(0.2 + 0.025 * Math.cos(a), wy + 0.01 * nod, wz + 0.02 * Math.sin(a));
  let right = V(-0.07 - 0.06 * Math.sin(beat * Math.PI * 0.5) ** 2, wy + 0.012 * (1 - nod), wz - 0.02);
  const poleDesk = (sgn) => new THREE.Vector3(sgn * 0.7, -0.6, -0.4);
  let poleR = poleDesk(-1);
  let handDirR = new THREE.Vector3(0, -0.25, 1);
  if (layer === 'djHand') {
    // Right hand up (beats 0–0.8), pumping on beats 1–3, back on the decks by beat 4.
    const w = smooth(0, 0.8, beat) * (1 - smooth(3.2, 3.95, beat));
    const pump = beat > 0.8 && beat < 3.2 ? Math.pow(1 - ph, 3) : 0;
    const up = V(-0.24, 2.02 + 0.07 * pump, 0.22 + 0.04 * pump);
    right = right.lerp(up, w);
    poleR = poleR.lerp(new THREE.Vector3(-0.9, -0.1, -0.3), w);
    handDirR = handDirR.lerp(new THREE.Vector3(0, 1, 0.15), w);
  } else if (layer === 'djHeadphone') {
    // Right hand to the right ear (holding a headphone cup), head tilted into it.
    const w = smooth(0, 0.8, beat) * (1 - smooth(3.2, 3.95, beat));
    turnWorld(get('Head'), Z, 0.16 * w);
    const head = get('Head').getWorldPosition(new THREE.Vector3());
    const ear = head.clone().add(V(-0.12, 0.01, 0.01));
    right = right.lerp(ear, w);
    poleR = poleR.lerp(new THREE.Vector3(-0.55, -0.75, 0.45), w);
    handDirR = handDirR.lerp(new THREE.Vector3(0.35, 1, -0.05), w);
  }
  reach(get, 'l', left, poleDesk(1));
  reach(get, 'r', right, poleR);
  // Fingers forward over the controller (or up for the raised hand).
  for (const [side, dir] of [['l', new THREE.Vector3(0, -0.25, 1)], ['r', handDirR]]) {
    pointBone(get(`hand_${side}`), get(`middle_01_${side}`), dir);
  }
}

// ------------------------------------------------------------------ output
function toHalf(f32) {
  const out = new Uint16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = THREE.DataUtils.toHalfFloat(f32[i]);
  return out;
}

const male = buildBody(ual1, false, TARGET_TRIS.male);
const female = buildBody(fem, true, TARGET_TRIS.female);
LOW = true;
const maleLo = buildBody(ual1, false, TARGET_TRIS_LO);
const femaleLo = buildBody(fem, true, TARGET_TRIS_LO);
LOW = false;
// Bones any vertex uses (all bodies share bone names and order).
const used = new Set();
for (const b of [male, female, maleLo, femaleLo]) {
  const I = b.geometry.attributes.skinIndex; const W = b.geometry.attributes.skinWeight;
  for (let i = 0; i < I.count; i++) for (let c = 0; c < 4; c++) if (W.getComponent(i, c) > 0) used.add(I.getComponent(i, c));
}
const usedBones = [...used].sort((a, b) => a - b);
const remap = new Map(usedBones.map((b, k) => [b, k]));

const chunks = [];
let offset = 0;
const push = (typed) => { const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; } const o = offset; chunks.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)); offset += typed.byteLength; return [o, typed.length]; };
const header = { version: 1, fps: FPS, bones: usedBones.length, boneNames: usedBones.map((i) => male.skeleton.bones[i].name), bodies: {}, regions: R };
for (const [name, body, bonesFrom] of [['male', male], ['female', female], ['maleLo', maleLo, 'male'], ['femaleLo', femaleLo, 'female']]) {
  const g = body.geometry;
  const n = g.attributes.position.count;
  const si = new Uint8Array(n * 4); const sw = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let sum = 0; const w = [];
    for (let c = 0; c < 4; c++) { w.push(g.attributes.skinWeight.getComponent(i, c)); sum += w[c]; }
    let acc = 0;
    for (let c = 0; c < 4; c++) {
      const bi = g.attributes.skinIndex.getComponent(i, c);
      si[i * 4 + c] = w[c] > 0 ? remap.get(bi) : 0;
      const q = c < 3 ? Math.round((w[c] / (sum || 1)) * 255) : 255 - acc;
      sw[i * 4 + c] = Math.max(0, q); acc += q;
    }
  }
  const nor = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) nor[i] = Math.round(g.attributes.normal.array[i] * 127);
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  // Same skeleton and clips as the detailed body: the low-detail one reuses its bone texture.
  const anim = bonesFrom ? null : bakeClips(body, name === 'female', usedBones);
  let bones = null;
  if (anim) {
    const flat = new Float32Array(anim.rows.length * usedBones.length * 12);
    anim.rows.forEach((r, k) => flat.set(r, k * r.length));
    bones = push(toHalf(flat));
  }
  header.bodies[name] = {
    vertices: n,
    triangles: g.index.count / 3,
    height: box.max.y,
    position: push(new Float32Array(g.attributes.position.array)),
    normal: push(nor),
    skinIndex: push(si),
    skinWeight: push(sw),
    region: push(new Uint8Array(g.attributes.region.array)),
    index: push(new Uint16Array(g.index.array)),
    ...(anim ? { clips: anim.meta, rows: anim.rows.length, bones } : { bonesFrom }),
  };
  console.log(name, 'verts', n, 'tris', g.index.count / 3, 'rows', anim ? anim.rows.length : bonesFrom, 'height', box.max.y.toFixed(3));
}
const json = new TextEncoder().encode(JSON.stringify(header));
const pad = (4 - ((8 + json.length) % 4)) % 4;
const head = new Uint8Array(8 + json.length + pad);
head.set(new TextEncoder().encode('FVG1'), 0);
new DataView(head.buffer).setUint32(4, json.length + pad, true);
head.set(json, 8);
head.fill(32, 8 + json.length); // JSON padded with spaces
const total = new Uint8Array(head.length + offset);
total.set(head, 0);
let o = head.length;
for (const c of chunks) { total.set(c, o); o += c.length; }
fs.writeFileSync(outPath, total);
console.log('wrote', outPath, (total.length / 1024).toFixed(0), 'KB, bones', usedBones.length);
