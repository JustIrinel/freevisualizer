// Animated wedding guests: Quaternius' CC0 mannequins (baked by tools/bake-guests.mjs into
// public/models/guests.bin) drawn as one InstancedMesh per body. The vertex shader does the
// skinning from a texture of baked bone matrices, so a crowd costs two draw calls and no
// per-guest CPU work; each guest picks its clip, loop offset and clothes colours.
import * as THREE from 'three';
import { REGION_COUNT, loopOffset } from './guest-layout.js';

const ASSET_URL = new URL('../models/guests.bin', import.meta.url);
let assetPromise = null;
let asset = null;

/** Load (once) and parse the baked guests. Resolves to null when unavailable (Node tests, missing file). */
export function loadGuests() {
  if (asset) return Promise.resolve(asset);
  if (!assetPromise) {
    assetPromise = (typeof fetch === 'function' && typeof location !== 'undefined'
      ? fetch(ASSET_URL).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => (buf ? (asset = parseGuests(buf)) : null))
      : Promise.resolve(null)).catch((e) => { console.warn('guests:', e); return null; });
  }
  return assetPromise;
}

/** The parsed asset if it is already loaded (sync). */
export function guestsReady() { return asset; }

/** Parse guests.bin: { bodies: { male, female: { geometry, bones (DataTexture), clips } } }. */
export function parseGuests(buf) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'FVG1') throw new Error('guests.bin: bad magic');
  const len = new DataView(buf).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + len)));
  const base = 8 + len;
  const view = (T, [off, n]) => new T(buf, base + off, n);
  const bodies = {};
  for (const [name, b] of Object.entries(header.bodies)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(view(Float32Array, b.position), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(view(Int8Array, b.normal), 3, true));
    g.setAttribute('fvJoint', new THREE.BufferAttribute(view(Uint8Array, b.skinIndex), 4));
    g.setAttribute('fvWeight', new THREE.BufferAttribute(view(Uint8Array, b.skinWeight), 4, true));
    g.setAttribute('fvRegion', new THREE.BufferAttribute(view(Uint8Array, b.region), 1));
    g.setIndex(new THREE.BufferAttribute(view(Uint16Array, b.index), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    let tex = null; let clips = null;
    if (b.bones) {
      tex = new THREE.DataTexture(view(Uint16Array, b.bones), header.bones * 3, b.rows, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      clips = {};
      for (const c of b.clips) clips[c.name] = c;
    }
    bodies[name] = { geometry: g, bones: tex, clips, height: b.height, triangles: b.triangles, bonesFrom: b.bonesFrom };
  }
  // Low-detail bodies share the skeleton animation of their detailed body.
  for (const b of Object.values(bodies)) if (b.bonesFrom) { b.bones = bodies[b.bonesFrom].bones; b.clips = bodies[b.bonesFrom].clips; }
  return { header, bodies };
}

// ------------------------------------------------------------------ shader
const HEAD = /* glsl */`
uniform highp sampler2D fvBones;
uniform highp sampler2D fvPal;
uniform float fvBeat;
uniform float fvTime;
attribute vec4 fvAnim;   // first row, frames, loop offset, beats per loop (>0) or -seconds
attribute vec4 fvJoint;
attribute vec4 fvWeight;
attribute float fvRegion;
mat4 fvBone(int row, int b) {
  int x = b * 3;
  vec4 r0 = texelFetch(fvBones, ivec2(x, row), 0);
  vec4 r1 = texelFetch(fvBones, ivec2(x + 1, row), 0);
  vec4 r2 = texelFetch(fvBones, ivec2(x + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 fvSkin() {
  float u = fvAnim.w > 0.0 ? fract(fvAnim.z + fvBeat / fvAnim.w) : fract(fvAnim.z + fvTime / -fvAnim.w);
  float f = u * fvAnim.y;
  float f0 = floor(f);
  float w = f - f0;
  int r0 = int(fvAnim.x + f0);
  int r1 = int(fvAnim.x + mod(f0 + 1.0, fvAnim.y));
  mat4 m = mat4(0.0);
  for (int i = 0; i < 4; i++) {
    float wt = fvWeight[i];
    if (wt > 0.0) {
      int b = int(fvJoint[i] + 0.5);
      m += (wt * (1.0 - w)) * fvBone(r0, b) + (wt * w) * fvBone(r1, b);
    }
  }
  return m;
}
`;
const PAL = 'vec4 fvP = texelFetch(fvPal, ivec2(int(fvRegion + 0.5), gl_InstanceID), 0);';
// Hidden parts (negative roughness) collapse to a point: no triangles drawn.
const POS = 'transformed = fvP.a < 0.0 ? vec3(0.0) : (fvM * vec4(transformed, 1.0)).xyz;';

function hook(material, uniforms, withColor) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\n${HEAD}${withColor ? 'varying vec3 fvColor;\nvarying float fvRough;\n' : ''}`);
    if (withColor) {
      vs = vs.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nmat4 fvM = fvSkin();\n${PAL}\nobjectNormal = mat3(fvM) * objectNormal;\nfvColor = fvP.rgb;\nfvRough = fvP.a;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${POS}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 fvColor;\nvarying float fvRough;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * fvColor, opacity );')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp( fvRough, 0.04, 1.0 );');
    } else {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>\nmat4 fvM = fvSkin();\n${PAL}\n${POS}`);
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => (withColor ? 'fv-guests' : 'fv-guests-depth');
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/**
 * Animated crowd. `people` from crowdLayout(), `dressed` from dressCrowd() (same order).
 * lowDetail: the ~3k-triangle bodies (seated guests, Medie quality).
 * Returns { group, update(time, beat, dancing), dispose() }.
 */
export function createAnimatedCrowd(people, dressed, guests, { lowDetail = false } = {}) {
  const group = new THREE.Group();
  const parts = [];
  for (const body of ['male', 'female']) {
    const idx = [];
    dressed.forEach((d, i) => { if (d.body === body) idx.push(i); });
    if (!idx.length) continue;
    const src = (lowDetail && guests.bodies[`${body}Lo`]) || guests.bodies[body];
    // Own attribute objects over the body's arrays (no copy in memory): each crowd has its own
    // GPU buffers, so removing one crowd cannot free the buffers another one still draws.
    const geo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.geometry.attributes)) geo.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
    geo.setIndex(new THREE.BufferAttribute(src.geometry.index.array, 1));
    geo.boundingBox = src.geometry.boundingBox;
    geo.boundingSphere = src.geometry.boundingSphere;
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('fvAnim', anim);
    // Palette texture: one row per guest, one texel per region (linear RGB + roughness).
    const pal = new Float32Array(idx.length * REGION_COUNT * 4);
    idx.forEach((pi, k) => {
      dressed[pi].palette.forEach(([hex, rough], r) => {
        _c.setHex(hex); // sRGB hex → linear working colour
        pal.set([_c.r, _c.g, _c.b, rough], (k * REGION_COUNT + r) * 4);
      });
    });
    const palTex = new THREE.DataTexture(pal, REGION_COUNT, idx.length, THREE.RGBAFormat, THREE.FloatType);
    palTex.minFilter = palTex.magFilter = THREE.NearestFilter;
    palTex.needsUpdate = true;
    const uniforms = { fvBones: { value: src.bones }, fvPal: { value: palTex }, fvBeat: { value: 0 }, fvTime: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
    hook(mat, uniforms, true);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    hook(depth, uniforms, false);
    const dist = new THREE.MeshDistanceMaterial();
    hook(dist, uniforms, false);
    const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = dist;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.guests = true;
    // Passes that draw the scene with one override material (the ambient-occlusion normal
    // pass) cannot skin the guests: they would show up in the bind pose, so skip them there.
    const own = new Set([mat, depth, dist]);
    mesh.onBeforeRender = (r, s, c, g, material) => {
      if (!own.has(material)) { mesh.userData.count = mesh.count; mesh.count = 0; }
    };
    mesh.onAfterRender = () => {
      if (mesh.userData.count !== undefined) { mesh.count = mesh.userData.count; mesh.userData.count = undefined; }
    };
    const base = idx.map((pi) => {
      const g = people[pi];
      const d = dressed[pi];
      const s = d.height / src.height * 1.02;
      return { x: g.x, z: g.z, heading: g.heading, sx: s * (g.girth * 0.3 + 0.7), sy: s };
    });
    // Cheap picking: a box per guest instead of thousands of triangles each.
    mesh.raycast = (raycaster, hits) => raycastBoxes(mesh, base, raycaster, hits);
    group.add(mesh);
    parts.push({ body, mesh, idx, anim, base, uniforms, palTex, mats: [mat, depth, dist], clips: src.clips, state: null });
  }

  const setClips = (part, dancing) => {
    const { idx, anim, clips } = part;
    idx.forEach((pi, k) => {
      const d = dressed[pi];
      const c = clips[dancing ? d.clip : d.rest] || clips.idle;
      anim.setXYZW(k, c.row, c.frames, loopOffset(c, d.beatOffset, d.phase), c.beats > 0 ? c.beats : -c.seconds);
    });
    anim.needsUpdate = true;
    part.state = dancing;
  };

  const place = (part, time, dancing) => {
    const { mesh, base, idx } = part;
    for (let k = 0; k < base.length; k++) {
      const b = base[k];
      const d = dressed[idx[k]];
      // Dancers turn a little now and then; the couple face each other.
      const turn = dancing && d.clip !== 'sway' ? d.turn * 0.45 * Math.sin(time * 0.23 + d.phase * 6.28) : 0;
      _q.setFromAxisAngle(_up, b.heading + turn);
      mesh.setMatrixAt(k, _m.compose(_p.set(b.x, 0, b.z), _q, _s.set(b.sx, b.sy, b.sx)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Animated limbs reach a bit outside the bind pose bounds.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1;
  };

  let lastTurn = -1;
  return {
    group,
    meshes: parts.map((p) => p.mesh),
    /** time: seconds, beat: beats since start (time·BPM/60), dancing: the show is on. */
    update(time, beat, dancing) {
      for (const part of parts) {
        if (part.state !== dancing) { setClips(part, dancing); place(part, time, dancing); }
        part.uniforms.fvBeat.value = beat;
        part.uniforms.fvTime.value = time;
      }
      // Turning is slow: refresh the matrices ~10× a second.
      if (dancing && time - lastTurn > 0.1) {
        lastTurn = time;
        for (const part of parts) place(part, time, dancing);
      }
    },
    dispose() {
      for (const p of parts) {
        p.mesh.geometry.dispose();
        p.palTex.dispose();
        for (const m of p.mats) m.dispose();
        p.mesh.dispose();
      }
    },
  };
}

const _box = new THREE.Box3();
const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _hit = new THREE.Vector3();
function raycastBoxes(mesh, base, raycaster, hits) {
  _inv.copy(mesh.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  for (let k = 0; k < base.length; k++) {
    const b = base[k];
    const h = 1.75 * b.sy; const r = 0.24 * b.sx;
    _box.min.set(b.x - r, 0, b.z - r); _box.max.set(b.x + r, h, b.z + r);
    if (!_ray.intersectBox(_box, _hit)) continue;
    _hit.applyMatrix4(mesh.matrixWorld);
    const distance = raycaster.ray.origin.distanceTo(_hit);
    if (distance < raycaster.near || distance > raycaster.far) continue;
    hits.push({ distance, point: _hit.clone(), object: mesh, instanceId: k });
  }
}
