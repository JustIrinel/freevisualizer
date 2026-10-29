// Real 3D models for profiles: a .glb uploaded by the user or the manufacturer
// models inside a GDTF file. Files live on the server (/api/models/<hash>.<ext>).
//
// profile.model = {
//   type: 'glb', file, rotX?, height?          (one model; parts named Base / Yoke / Head move)
//   type: 'gdtf', files: { modelName: file }, geometry: { models, tree }, rotX?
//   type: 'builtin', file, height?             (a model shipped in public/models, see BUILTIN_MODELS)
// }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { tr } from './i18n.js';

const loaded = new Map();

/**
 * Models shipped with the app (public/models, credits in public/models/CREDITS.md).
 * pan / tilt: node names that move; height: real height in metres (beam pointing up);
 * lensR: radius of the front lens at that height (glow disc).
 */
export const BUILTIN_MODELS = {
  'panther-60.glb': {
    name: 'BeamZ Panther 60',
    credit: 'Moving Head Beam (high Poly) – Lord Henry, CC BY 4.0',
    pan: 'Support', tilt: 'Head', height: 0.29, lensR: 0.036, tint: 0.2,
  },
};
const tinted = new Map();
/** Shared darker copy of a model material (the Panther is black, the source model grey). */
function tintMaterial(mat, k) {
  const key = `${mat.uuid}:${k}`;
  if (!tinted.has(key)) {
    const m = mat.clone();
    m.color.multiplyScalar(k);
    m.userData.cached = true;
    tinted.set(key, m);
  }
  return tinted.get(key);
}

/** GLTFLoader that also reads meshopt-compressed / quantized files (EXT_meshopt_compression). */
export function gltfLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

export async function uploadAsset(bytes, ext) {
  const res = await fetch(`/api/models?ext=${ext}`, { method: 'POST', body: bytes });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || tr('upload eșuat'));
  return data.file;
}

/** Load (once) and return a fresh clone of a stored model. */
export async function loadAsset(file) {
  if (!loaded.has(file)) {
    loaded.set(file, (async () => {
      const res = await fetch(BUILTIN_MODELS[file] ? `/models/${file}` : `/api/models/${file}`);
      if (!res.ok) throw new Error(tr('modelul {file} lipsește', { file }));
      const buf = await res.arrayBuffer();
      if (file.endsWith('.3ds')) return new TDSLoader().parse(buf, '');
      const gltf = await gltfLoader().parseAsync(buf, '');
      return gltf.scene;
    })());
  }
  const obj = await loaded.get(file);
  return obj.clone(true);
}

// GDTF: Z up, fixture described hanging (beam towards −Z). Ours: Y up, standing, beam +Y.
// (x, y, z) → (x, −z, y)
const GDTF_TO_OURS = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

/** Scale a model mesh to the GDTF Length × Width × Height (x, y, z), whatever axis convention the file uses. */
function fitToGdtf(obj, dims) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (!(dims.length > 0 && dims.height > 0) || size.lengthSq() === 0) return obj;
  const wrap = new THREE.Group();
  wrap.add(obj);
  // A glTF is Y up: if its Y matches the height better than Z, turn it Z up.
  const yUp = Math.abs(size.y - dims.height) < Math.abs(size.z - dims.height);
  if (yUp) obj.rotation.x = Math.PI / 2;
  wrap.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(wrap);
  const s2 = b2.getSize(new THREE.Vector3());
  const k = [dims.length / (s2.x || 1), (dims.width || dims.length) / (s2.y || 1), dims.height / (s2.z || 1)];
  // Uniform scale unless the file is clearly in other units.
  const avg = (k[0] + k[1] + k[2]) / 3;
  const inner = new THREE.Group();
  inner.add(wrap);
  if (Math.abs(avg - 1) > 0.05) wrap.scale.setScalar(avg);
  return inner;
}

/**
 * Assemble a model in our frame (standing, beam +Y, base on the floor at y = 0).
 * Returns { root, parts: { base: Object3D[], yoke: Object3D[], head: Object3D[] }, panPivot, tiltPivot, beam }
 * – pivots and beam position in the root frame (null when not found).
 */
export async function assembleModel(spec, kind) {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  root.add(holder);
  const parts = { base: [], yoke: [], head: [] };
  let panNode = null; let tiltNode = null; let beamNode = null;
  const preset = spec.type === 'builtin' ? BUILTIN_MODELS[spec.file] : null;
  if (spec.type === 'builtin' && !preset) throw new Error(tr('modelul {file} lipsește', { file: spec.file }));

  if (spec.type === 'gdtf') {
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(GDTF_TO_OURS);
    const build = async (node, part, parent) => {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.matrix.fromArray(node.matrix).transpose(); // GDTF rows → column-major
      g.name = node.name;
      parent.add(g);
      let myPart = part;
      if (node.tag === 'Axis') {
        if (!panNode) { panNode = g; myPart = 'yoke'; } else if (!tiltNode) { tiltNode = g; myPart = 'head'; }
      }
      if (/^Beam$/i.test(node.tag) && !beamNode) beamNode = g;
      const file = spec.files && spec.files[node.model];
      if (file) {
        const mesh = fitToGdtf(await loadAsset(file), spec.geometry.models[node.model] || {});
        g.add(mesh);
        parts[myPart].push(mesh);
      }
      for (const c of node.children || []) await build(c, myPart, g);
    };
    for (const n of spec.geometry.tree) await build(n, 'base', holder);
  } else {
    const scene = await loadAsset(spec.file);
    holder.add(scene);
    // Built-in models name their moving parts; other files follow the GDTF convention.
    const panName = spec.pan || preset?.pan; const tiltName = spec.tilt || preset?.tilt;
    if (preset?.tint) scene.traverse((o) => { if (o.isMesh && o.material?.color) o.material = tintMaterial(o.material, preset.tint); });
    scene.traverse((o) => {
      if (panName || tiltName) {
        if (!panNode && o.name === panName) panNode = o;
        else if (!tiltNode && o.name === tiltName) tiltNode = o;
        return;
      }
      if (!panNode && /yoke|arm/i.test(o.name)) panNode = o;
      else if (!tiltNode && /^head|[_ ]head/i.test(o.name)) tiltNode = o;
      else if (!beamNode && /beam|lens/i.test(o.name)) beamNode = o;
    });
    if (panNode) parts.yoke.push(panNode);
    if (tiltNode) parts.head.push(tiltNode);
    if (tiltNode && panNode && isAncestor(panNode, tiltNode)) parts.yoke = parts.yoke.filter((x) => x !== tiltNode);
    parts.base.push(scene);
  }
  // Orientation fix chosen by the user (model lying down / upside down).
  holder.rotation.x = THREE.MathUtils.degToRad(spec.rotX || 0);
  if (spec.type === 'gdtf' && spec.rotX) {
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(spec.rotX)).multiply(GDTF_TO_OURS));
  }
  root.updateMatrixWorld(true);
  // Plain .glb: scale to a sensible real size.
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  if (spec.type !== 'gdtf' && size.y > 0) {
    const target = spec.height || preset?.height || ({ moving: 0.42, retro: 0.6, bar: 0.12, strobe: 0.2, fog: 0.25, lowfog: 0.4, spark: 0.3, laser: 0.2 }[kind] || 0.3);
    const k = target / Math.max(size.y, 1e-6);
    root.scale.setScalar(k);
    root.updateMatrixWorld(true);
  }
  // Stand on the floor, centred.
  const b = new THREE.Box3().setFromObject(root);
  const c = b.getCenter(new THREE.Vector3());
  const offset = new THREE.Group();
  offset.position.set(-c.x, -b.min.y, -c.z);
  offset.add(root);
  offset.updateMatrixWorld(true);

  const worldPos = (o) => (o ? o.getWorldPosition(new THREE.Vector3()) : null);
  let panPivot = worldPos(panNode); let tiltPivot = worldPos(tiltNode);
  if (preset) {
    // Built-in models: the node origins are the real pan / tilt axes.
  } else if (spec.type !== 'gdtf') {
    // Pivots of named glb parts: bottom-centre of the yoke, centre of the head.
    if (panNode) { const bb = new THREE.Box3().setFromObject(panNode); panPivot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2); }
    if (tiltNode) tiltPivot = new THREE.Box3().setFromObject(tiltNode).getCenter(new THREE.Vector3());
  }
  let beam = worldPos(beamNode);
  if (!beam) {
    const src = tiltNode || offset;
    const bb = new THREE.Box3().setFromObject(src);
    beam = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2);
  }
  const lensR = preset?.lensR ? preset.lensR * (spec.height || preset.height) / preset.height : null;
  return { root: offset, parts, panPivot, tiltPivot, beam, lensR, size: b.getSize(new THREE.Vector3()) };
}

function isAncestor(a, b) {
  for (let o = b.parent; o; o = o.parent) if (o === a) return true;
  return false;
}

/**
 * Swap the procedural housing of a fixture model for the real model.
 * Keeps beams, lights and DMX behaviour; moving parts follow pan/tilt.
 */
export async function applyModel(model, profile) {
  const spec = profile.model;
  const asm = await assembleModel(spec, profile.kind);
  if (model.disposed) return;
  const root = model.root;
  // Hide the procedural housing (beams, lights and labels stay).
  root.traverse((o) => { if (o.isMesh && !o.material?.isShaderMaterial && !o.userData.glow) o.visible = false; });
  const saved = model.yoke ? { pan: model.yoke.rotation.y, tilt: model.head.rotation.x } : null;
  if (model.yoke) { model.yoke.rotation.y = 0; model.head.rotation.x = 0; }
  asm.root.traverse((o) => { if (o.isMesh) o.userData.imported = true; });
  // Assembled model sits in the fixture frame.
  root.add(asm.root);
  root.updateMatrixWorld(true);
  if (model.yoke && asm.panPivot && (asm.parts.yoke.length || asm.parts.head.length)) {
    model.yoke.position.copy(asm.panPivot);
    root.updateMatrixWorld(true);
    if (asm.tiltPivot) {
      model.head.position.copy(model.yoke.worldToLocal(root.localToWorld(asm.tiltPivot.clone())));
    }
    root.updateMatrixWorld(true);
    for (const o of asm.parts.yoke) model.yoke.attach(o);
    for (const o of asm.parts.head) model.head.attach(o);
    if (asm.beam && model.beamOrigin) {
      model.beamOrigin.position.copy(model.head.worldToLocal(root.localToWorld(asm.beam.clone())));
    }
  } else if (model.beam && !model.yoke && !model.cells) {
    model.beam.mesh.position.copy(asm.beam);
    if (model.light) model.light.position.copy(asm.beam);
  }
  // A glowing disc at the beam origin so the lens still lights up.
  if (model.lensMat) {
    const r = asm.lensR || Math.max(0.03, Math.min(asm.size.x, asm.size.z) * 0.18);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), model.lensMat);
    disc.rotation.x = -Math.PI / 2;
    const parent = model.beamOrigin || root;
    disc.position.copy(model.beamOrigin ? new THREE.Vector3(0, 0.002, 0) : asm.beam.clone().add(new THREE.Vector3(0, 0.002, 0)));
    parent.add(disc);
  }
  if (saved) { model.yoke.rotation.y = saved.pan; model.head.rotation.x = saved.tilt; }
  model.modelLoaded = true;
}
