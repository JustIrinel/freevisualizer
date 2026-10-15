// Gobos and prisms: procedural gobo designs in a canvas atlas, the per-fixture
// projection texture (wheel 1 × wheel 2, rotation, prism copies, frost) and the
// manager that gives the projection to a limited number of spot lights.
import * as THREE from 'three';
import { GOBO_DESIGNS, MAX_COPIES } from './gobo-layout.js';

export { projectionLayout } from './gobo-layout.js';

const ATLAS = 1024;
const GRID = 8; // 8 × 8 cells of 128 px: 16 built-in designs + 48 custom images
const CELL = ATLAS / GRID;
const PAD = 3;

// ------------------------------------------------------------------ designs
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Draw design `i` (white = light passes) in a unit circle centred on 0,0 (radius 1). */
function drawDesign(g, i) {
  const name = GOBO_DESIGNS[i];
  const TAU = Math.PI * 2;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  const circle = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
  const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
  switch (name) {
    case 'dots':
      circle(0, 0, 0.17);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; circle(Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0.15); }
      for (let k = 0; k < 12; k++) { const a = ((k + 0.5) / 12) * TAU; circle(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.09); }
      break;
    case 'star': {
      const pts = [];
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU - Math.PI / 2; const r = k % 2 ? 0.38 : 0.95; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      poly(pts);
      break;
    }
    case 'flower':
      for (let k = 0; k < 6; k++) {
        g.save(); g.rotate((k / 6) * TAU);
        g.beginPath(); g.ellipse(0, -0.5, 0.17, 0.42, 0, 0, TAU); g.fill();
        g.restore();
      }
      g.fillStyle = '#000'; circle(0, 0, 0.12); g.fillStyle = '#fff'; circle(0, 0, 0.07);
      break;
    case 'breakup': {
      const rnd = seeded(7);
      for (let k = 0; k < 26; k++) {
        const a = rnd() * TAU; const d = Math.sqrt(rnd()) * 0.85;
        g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(rnd() * TAU);
        g.beginPath(); g.ellipse(0, 0, 0.06 + rnd() * 0.13, 0.04 + rnd() * 0.07, 0, 0, TAU); g.fill();
        g.restore();
      }
      break;
    }
    case 'rings':
      g.lineWidth = 0.1;
      for (const r of [0.25, 0.52, 0.8]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
      circle(0, 0, 0.07);
      // Metal bridges that hold the rings.
      g.strokeStyle = '#000'; g.lineWidth = 0.05;
      for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.3; g.beginPath(); g.moveTo(Math.cos(a) * 0.15, Math.sin(a) * 0.15); g.lineTo(Math.cos(a), Math.sin(a)); g.stroke(); }
      break;
    case 'triangles':
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU - Math.PI / 2; const cx = Math.cos(a) * 0.45; const cy = Math.sin(a) * 0.45;
        const pts = [];
        for (let j = 0; j < 3; j++) { const b = a + (j / 3) * TAU; pts.push([cx + Math.cos(b) * 0.42, cy + Math.sin(b) * 0.42]); }
        poly(pts);
      }
      break;
    case 'spiral':
      g.lineWidth = 0.13; g.lineCap = 'round';
      for (let arm = 0; arm < 2; arm++) {
        g.beginPath();
        for (let t = 0; t <= 1; t += 0.01) { const a = t * 2.4 * Math.PI + arm * Math.PI; const r = 0.08 + t * 0.82; (t ? g.lineTo : g.moveTo).call(g, Math.cos(a) * r, Math.sin(a) * r); }
        g.stroke();
      }
      break;
    case 'brokenCircle':
      g.lineWidth = 0.2;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.beginPath(); g.arc(0, 0, 0.72, a + 0.12, a + TAU / 8 - 0.12); g.stroke(); }
      g.lineWidth = 0.12;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; g.beginPath(); g.arc(0, 0, 0.35, a + 0.25, a + TAU / 5 - 0.25); g.stroke(); }
      break;
    case 'bars':
      for (let k = -3; k <= 3; k++) g.fillRect(k * 0.27 - 0.08, -1, 0.16, 2);
      break;
    case 'cross':
      for (const [x, y, s] of [[0, 0, 0.3], [0.55, 0.55, 0.2], [-0.55, 0.55, 0.2], [0.55, -0.55, 0.2], [-0.55, -0.55, 0.2]]) {
        g.fillRect(x - s, y - s * 0.28, s * 2, s * 0.56); g.fillRect(x - s * 0.28, y - s, s * 0.56, s * 2);
      }
      break;
    case 'petals':
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU; const b = a + 0.16;
        poly([[Math.cos(a - 0.16) * 0.2, Math.sin(a - 0.16) * 0.2], [Math.cos(a) * 0.97, Math.sin(a) * 0.97], [Math.cos(b) * 0.2, Math.sin(b) * 0.2]]);
      }
      break;
    case 'sun':
      circle(0, 0, 0.3);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU; const w = 0.06;
        poly([[Math.cos(a - w) * 0.42, Math.sin(a - w) * 0.42], [Math.cos(a) * (k % 2 ? 0.75 : 0.97), Math.sin(a) * (k % 2 ? 0.75 : 0.97)], [Math.cos(a + w) * 0.42, Math.sin(a + w) * 0.42]]);
      }
      break;
    case 'cells':
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          const cx = (x + (y % 2 ? 0.5 : 0)) * 0.24; const cy = y * 0.21;
          if (Math.hypot(cx, cy) < 0.9) {
            const pts = [];
            for (let j = 0; j < 6; j++) { const b = (j / 6) * TAU + Math.PI / 6; pts.push([cx + Math.cos(b) * 0.095, cy + Math.sin(b) * 0.095]); }
            poly(pts);
          }
        }
      }
      break;
    case 'waves':
      g.lineWidth = 0.1;
      for (let k = -3; k <= 3; k++) {
        g.beginPath();
        for (let x = -1; x <= 1; x += 0.02) { const y = k * 0.26 + Math.sin(x * 7) * 0.07; (x > -1 ? g.lineTo : g.moveTo).call(g, x, y); }
        g.stroke();
      }
      break;
    case 'snowflake':
      g.lineWidth = 0.09; g.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        g.save(); g.rotate((k / 6) * TAU);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -0.9);
        for (const d of [0.35, 0.6]) { g.moveTo(0, -d); g.lineTo(0.2, -d - 0.2); g.moveTo(0, -d); g.lineTo(-0.2, -d - 0.2); }
        g.stroke();
        g.restore();
      }
      break;
    case 'squares':
      for (let y = -3; y <= 3; y++) {
        for (let x = -3; x <= 3; x++) {
          const cx = x * 0.27; const cy = y * 0.27;
          if (Math.hypot(cx, cy) < 0.86) { g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4 * ((x + y) % 2)); g.fillRect(-0.085, -0.085, 0.17, 0.17); g.restore(); }
        }
      }
      break;
    default:
      circle(0, 0, 1);
  }
}

let atlas = null;
const imageCells = new Map(); // file → cell index (or a promise while loading)

function cellOrigin(index) {
  return [(index % GRID) * CELL, Math.floor(index / GRID) * CELL];
}

function getAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, ATLAS, ATLAS);
  GOBO_DESIGNS.forEach((_, i) => {
    const [x, y] = cellOrigin(i);
    const r = CELL / 2 - PAD;
    g.save();
    g.translate(x + CELL / 2, y + CELL / 2);
    g.scale(r, r);
    g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.clip();
    drawDesign(g, i);
    g.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.flipY = false;
  atlas = { canvas, g, texture, next: GOBO_DESIGNS.length };
  return atlas;
}

/** Cell of a custom gobo image (loads it the first time; -1 until it is ready). */
function imageCell(file) {
  const known = imageCells.get(file);
  if (typeof known === 'number') return known;
  if (known) return -1;
  const a = getAtlas();
  if (a.next >= GRID * GRID) return -1;
  const index = a.next++;
  imageCells.set(file, (async () => {
    try {
      const res = await fetch(`/api/models/${file}`);
      if (!res.ok) throw new Error(res.statusText);
      const bmp = await createImageBitmap(await res.blob());
      const [x, y] = cellOrigin(index);
      a.g.save();
      a.g.fillStyle = '#000';
      a.g.fillRect(x, y, CELL, CELL);
      a.g.beginPath(); a.g.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - PAD, 0, Math.PI * 2); a.g.clip();
      a.g.drawImage(bmp, x + PAD, y + PAD, CELL - PAD * 2, CELL - PAD * 2);
      a.g.restore();
      a.texture.needsUpdate = true;
      imageCells.set(file, index);
    } catch (err) {
      console.warn('gobo image', file, err.message);
      imageCells.set(file, -2);
    }
  })());
  return -1;
}

/** Atlas cell to use for a wheel entry of the layout: design, or the profile's own image. */
function cellFor(wheel) {
  if (wheel.image) {
    const c = imageCell(wheel.image);
    if (c >= 0) return c;
  }
  return wheel.design;
}

// ------------------------------------------------------------------ projection texture
const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const quadFragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uField;
  uniform float uBeam;
  uniform float uFrost;
  uniform int uCount;
  uniform vec3 uCopies[${MAX_COPIES}];
  uniform vec4 uCell[2];
  uniform vec2 uRot[2];
  varying vec2 vUv;
  float wheel(vec4 c, vec2 rot, vec2 v) {
    if (c.w < 0.5) return 1.0;
    vec2 r = vec2(rot.x * v.x - rot.y * v.y, rot.y * v.x + rot.x * v.y);
    // Frost: a much blurrier mip level, fading towards the gobo's average light.
    float g = texture2D(uAtlas, c.xy + (r * 0.5 + 0.5) * c.z, uFrost * 6.0).r;
    return mix(g, 0.45, uFrost * 0.55);
  }
  void main() {
    vec2 q = (vUv * 2.0 - 1.0) * uField;
    float soft = 0.025 + uFrost * 0.5;
    float sum = 0.0;
    for (int k = 0; k < ${MAX_COPIES}; k++) {
      if (k >= uCount) break;
      vec2 v = (q - uCopies[k].xy) / uBeam;
      float r = length(v);
      if (r > 1.0 + soft) continue;
      float ap = 1.0 - smoothstep(1.0 - soft, 1.0 + soft * 0.4, r);
      // A little brighter in the middle, like a real lens (and softer with frost).
      ap *= 1.0 - 0.25 * r * r * (1.0 - uFrost);
      sum += uCopies[k].z * ap * wheel(uCell[0], uRot[0], v) * wheel(uCell[1], uRot[1], v);
    }
    gl_FragColor = vec4(vec3(min(sum, 1.0)), 1.0);
  }
`;

let quad = null;
function getQuad() {
  if (quad) return quad;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: getAtlas().texture },
      uField: { value: 1 },
      uBeam: { value: 0.5 },
      uFrost: { value: 0 },
      uCount: { value: 1 },
      uCopies: { value: Array.from({ length: MAX_COPIES }, () => new THREE.Vector3()) },
      uCell: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uRot: { value: [new THREE.Vector2(1, 0), new THREE.Vector2(1, 0)] },
    },
    vertexShader: quadVertex,
    fragmentShader: quadFragment,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  quad = { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material };
  return quad;
}

/** Soft round spot: projection of an open beam (used by mapped lights without gobo). */
let openTexture = null;
export function getOpenTexture() {
  if (openTexture) return openTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.75, '#e6e6e6');
  grd.addColorStop(0.97, '#000');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  openTexture = new THREE.CanvasTexture(c);
  return openTexture;
}

export const PROJECTION_SIZE = 256;

/** Per-fixture projection texture, redrawn only when the layout changes. */
export class ProjectionTexture {
  constructor(size = PROJECTION_SIZE) {
    this.target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.texture = this.target.texture;
    this.key = null;
    this.layout = null;
    this.dirty = false;
    this.waiting = false;
  }

  request(layout) {
    this.layout = layout;
    // A custom image still loading was drawn with a stand-in design: redraw until it is in the atlas.
    if (layout.key !== this.key || this.waiting) this.dirty = true;
  }

  render(renderer) {
    if (!this.dirty || !this.layout) return;
    this.dirty = false;
    const L = this.layout;
    this.key = L.key;
    this.waiting = false;
    const q = getQuad();
    const u = q.material.uniforms;
    u.uField.value = L.fieldTan;
    u.uBeam.value = L.beamTan;
    u.uFrost.value = L.frost;
    u.uCount.value = Math.min(MAX_COPIES, L.copies.length);
    L.copies.forEach((c, i) => { if (i < MAX_COPIES) u.uCopies.value[i].set(c.x, c.y, c.w); });
    for (let w = 0; w < 2; w++) {
      const wheel = L.wheels[w];
      const cell = u.uCell.value[w];
      if (!wheel) { cell.set(0, 0, 0, 0); continue; }
      const index = cellFor(wheel);
      if (wheel.image && typeof imageCells.get(wheel.image) !== 'number') this.waiting = true;
      const [x, y] = cellOrigin(index);
      cell.set((x + PAD) / ATLAS, (y + PAD) / ATLAS, (CELL - PAD * 2) / ATLAS, 1);
      u.uRot.value[w].set(Math.cos(wheel.angle), Math.sin(wheel.angle));
    }
    const prev = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.render(q.scene, q.camera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = auto;
  }

  dispose() {
    this.target.dispose();
  }
}

// ------------------------------------------------------------------ light manager
/**
 * Only a few spot lights can carry a projection (each one is a texture and a
 * varying in every lit material). The number of mapped lights stays constant
 * so materials are not recompiled when gobos come and go; which lights get the
 * slots is decided every frame by priority (active gobo/prism first, then brightness).
 */
export class GoboLightManager {
  constructor(max = 6) {
    this.max = max;
    this.models = new Set();
    this._up = new THREE.Vector3();
  }

  register(model) { this.models.add(model); }

  unregister(model) {
    this.models.delete(model);
    if (model.light) model.light.map = null;
  }

  update(renderer) {
    const list = [...this.models].filter((m) => m.light && !m.disposed);
    for (const m of list) {
      const s = m.lastState;
      const level = s ? s.intensity : 0;
      m._goboPriority = (m.projActive ? 10 : 0) + level;
    }
    list.sort((a, b) => b._goboPriority - a._goboPriority);
    list.forEach((m, i) => {
      const mapped = i < this.max;
      const light = m.light;
      light.penumbra = mapped && m.projActive ? 0.04 : 0.45;
      if (!mapped) { light.map = null; return; }
      light.map = m.projActive ? m.proj.texture : getOpenTexture();
      // Keep the projection's "up" glued to the head so it turns with it.
      m.beamOrigin.updateWorldMatrix(true, false);
      light.shadow.camera.up.setFromMatrixColumn(m.beamOrigin.matrixWorld, 2).normalize();
    });
    for (const m of list) if (m.projActive && m.proj) m.proj.render(renderer);
  }
}
