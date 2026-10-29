// Building blocks for realistic fixture housings (dimensions in metres, after
// real DJ fixtures: BeamZ Panther 60, Chauvet Intimidator Spot, slim LED pars…).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { grilleTexture, lcdTexture, ledDotsTexture, fresnelTexture, plasticTexture } from './textures.js';

const shared = new WeakSet();
const cache = {};
const keep = (m) => { shared.add(m); return m; };
export const isShared = (m) => shared.has(m);

/** Textured black plastic housing. */
export function housing() {
  return cache.housing || (cache.housing = keep(new THREE.MeshStandardMaterial({ color: 0x3a3b40, map: plasticTexture(), roughness: 0.58, metalness: 0.15 })));
}
/** Slightly lighter side covers / trims. */
export function trim() {
  return cache.trim || (cache.trim = keep(new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.45, metalness: 0.3 })));
}
/** Painted steel brackets. */
export function steel() {
  return cache.steel || (cache.steel = keep(new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.38, metalness: 0.75 })));
}
/** Bright aluminium (screws, knobs, reflectors). */
export function alu() {
  return cache.alu || (cache.alu = keep(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 })));
}
export function rubber() {
  return cache.rubber || (cache.rubber = keep(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9, metalness: 0 })));
}
export function grille() {
  return cache.grille || (cache.grille = keep(new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.7, metalness: 0.3 })));
}
export function glass() {
  return cache.glass || (cache.glass = keep(new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false })));
}

/**
 * Lens / LED face: dark glossy glass that glows with the fixture colour (see setGlow).
 * `pattern` adds visible LEDs or Fresnel rings when lit.
 */
export function lens(pattern = null) {
  return new THREE.MeshStandardMaterial({
    color: 0x07080a, roughness: 0.06, metalness: 0.1, emissive: 0x000000,
    emissiveMap: pattern === 'fresnel' ? fresnelTexture() : pattern ? ledDotsTexture(pattern[0], pattern[1]) : null,
  });
}

/** Light up a lens material: colour (0..1 rgb) × intensity × boost. */
export function setGlow(mat, color, intensity, boost = 5) {
  const k = intensity * boost;
  if (mat.emissive) mat.emissive.setRGB(color[0] * k, color[1] * k, color[2] * k);
  else mat.color.setRGB(0.05 + color[0] * k, 0.05 + color[1] * k, 0.05 + color[2] * k);
}

export function rbox(w, h, d, r = 0.012, mat = housing()) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat);
}

export function cyl(rTop, rBottom, h, mat, seg = 28) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat);
}

/** LCD + buttons on the front of a base or a box (faces +Z). */
export function controlPanel(w, address) {
  const g = new THREE.Group();
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.32, w * 0.12), new THREE.MeshBasicMaterial({ map: lcdTexture(`A${String(address || 1).padStart(3, '0')}`), toneMapped: false }));
  lcd.position.x = -w * 0.12;
  g.add(lcd);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.025, w * 0.025, 0.006, 12), rubber());
    b.rotation.x = Math.PI / 2;
    b.position.set(w * 0.1 + i * w * 0.075, 0, 0.002);
    g.add(b);
  }
  return g;
}

/** Carry handle (half torus) standing on +Y. */
export function handle(span, mat = trim()) {
  const h = new THREE.Mesh(new THREE.TorusGeometry(span / 2, 0.009, 8, 20, Math.PI), mat);
  return h;
}

/** Rubber feet under a box of footprint w×d (y = 0..0.01). */
export function feet(w, d) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const f = cyl(0.014, 0.016, 0.01, rubber(), 12);
    f.position.set(sx * (w / 2 - 0.025), 0.005, sz * (d / 2 - 0.025));
    g.add(f);
  }
  return g;
}

/** Moving-head base: rounded box with LCD, buttons, side handles and feet. Bottom at y = 0. */
export function movingBase(w, h, d, address) {
  const g = new THREE.Group();
  const body = rbox(w, h, d, 0.02);
  body.position.y = 0.01 + h / 2;
  g.add(body, feet(w, d));
  const panel = controlPanel(w, address);
  panel.position.set(0, 0.01 + h * 0.5, d / 2 + 0.001);
  g.add(panel);
  for (const s of [-1, 1]) {
    const hd = handle(d * 0.55);
    hd.rotation.set(0, Math.PI / 2, s * Math.PI / 2);
    hd.position.set(s * (w / 2), 0.01 + h * 0.55, 0);
    g.add(hd);
  }
  const ring = cyl(w * 0.22, w * 0.25, 0.018, trim());
  ring.position.y = 0.01 + h + 0.009;
  g.add(ring);
  return g;
}

/** Yoke: two arms with covers + bridge. Bridge bottom at y = 0, arms up to armH. */
export function yokeArms(span, armH, depth) {
  const g = new THREE.Group();
  const bridge = rbox(span + 0.05, 0.03, depth, 0.012);
  bridge.position.y = 0.015;
  g.add(bridge);
  for (const s of [-1, 1]) {
    const arm = rbox(0.028, armH, depth, 0.012);
    arm.position.set(s * (span / 2 + 0.01), armH / 2 + 0.01, 0);
    const cover = rbox(0.008, armH * 0.86, depth * 0.88, 0.004, trim());
    cover.position.set(s * (span / 2 + 0.028), armH / 2 + 0.01, 0);
    const motor = cyl(depth * 0.36, depth * 0.36, 0.012, trim());
    motor.rotation.z = Math.PI / 2;
    motor.position.set(s * (span / 2 + 0.033), armH - depth * 0.42, 0);
    g.add(arm, cover, motor);
  }
  return g;
}

/** Round head from a lathe profile, emitting along +Y. Returns { group, lensMat, front }. */
export function roundHead(radius, length, lensR, pattern) {
  const g = new THREE.Group();
  const pts = [
    [0.001, -length / 2], [radius * 0.55, -length / 2], [radius * 0.85, -length / 2 + radius * 0.08],
    [radius, -length / 2 + radius * 0.3], [radius, length / 2 - radius * 0.25], [radius * 0.96, length / 2 - radius * 0.06],
    [lensR + 0.008, length / 2], [lensR, length / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), housing());
  g.add(shell);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(lensR + 0.004, 0.005, 10, 40), trim());
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = length / 2;
  g.add(bezel);
  const lensMat = lens(pattern);
  let front;
  if (pattern === 'fresnel') {
    // Domed front lens, like the big lens on a beam.
    const R = lensR * 1.9;
    const theta = Math.asin(lensR / R);
    front = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 12, 0, Math.PI * 2, 0, theta), lensMat);
    front.position.y = length / 2 - R * Math.cos(theta);
  } else {
    front = new THREE.Mesh(new THREE.CircleGeometry(lensR, 40), lensMat);
    front.rotation.x = -Math.PI / 2;
    front.position.y = length / 2 + 0.001;
  }
  g.add(front);
  const vents = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.002, radius * 1.002, length * 0.35, 40, 1, true, -0.6, 1.2), grille());
  vents.position.y = -length * 0.12;
  g.add(vents, vents.clone().rotateY(Math.PI));
  return { group: g, lensMat, frontY: length / 2 + (pattern === 'fresnel' ? lensR * 0.3 : 0.002) };
}

/** Boxy spot head (rounded body + tapered nose), emitting along +Y. */
export function spotHead(w, length, d, lensR) {
  const g = new THREE.Group();
  const body = rbox(w, length * 0.78, d, 0.03);
  body.position.y = -length * 0.11;
  g.add(body);
  const nose = cyl(lensR + 0.02, Math.min(w, d) * 0.46, length * 0.22, housing(), 36);
  nose.position.y = length * 0.39;
  g.add(nose);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(lensR + 0.006, 0.007, 10, 40), trim());
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = length / 2;
  g.add(bezel);
  const lensMat = lens('fresnel');
  const front = new THREE.Mesh(new THREE.CircleGeometry(lensR, 40), lensMat);
  front.rotation.x = -Math.PI / 2;
  front.position.y = length / 2 + 0.001;
  g.add(front);
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(length * 0.45, d * 0.6), grille());
    v.rotation.y = s * Math.PI / 2;
    v.rotation.z = Math.PI / 2;
    v.position.set(s * (w / 2 + 0.001), -length * 0.12, 0);
    g.add(v);
  }
  const cap = rbox(w * 0.8, 0.02, d * 0.8, 0.008, trim());
  cap.position.y = -length * 0.5 + 0.006;
  g.add(cap);
  return { group: g, lensMat, frontY: length / 2 + 0.002 };
}

/** U bracket for pars / pinspots: bottom strap at y = 0, pivots at pivotY. */
export function parBracket(span, pivotY, mat = steel()) {
  const g = new THREE.Group();
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(span + 0.02, 0.006, 0.035), mat);
  bottom.position.y = 0.003;
  g.add(bottom);
  for (const s of [-1, 1]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.006, pivotY, 0.035), mat);
    up.position.set(s * (span / 2 + 0.007), pivotY / 2, 0);
    const knob = cyl(0.018, 0.018, 0.012, rubber(), 16);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(s * (span / 2 + 0.016), pivotY, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.012), rubber());
    wing.position.set(s * (span / 2 + 0.024), pivotY, 0);
    g.add(up, knob, wing);
  }
  const hole = cyl(0.008, 0.008, 0.008, alu(), 12);
  hole.position.y = 0.004;
  g.add(hole);
  return g;
}

/** Hexagonal prism with bevelled edges (retro housings), axis along Y, front face at y = 0. */
export function hexBody(radius, depth, mat = housing()) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * radius; const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
  geo.rotateX(Math.PI / 2); // extrusion along -Y
  const m = new THREE.Mesh(geo, mat);
  return m;
}

/** Parabolic reflector cup (open towards +Y), mouth at y = 0. */
export function reflector(mouthR, depth, mat) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(mouthR * (0.3 + 0.7 * t), -depth * (1 - t * t)));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat);
}

// ------------------------------------------------------------------ real fixtures (DJ Matei's rig)
const textCache = new Map();
/** Small printed label / logo (white or grey text on the housing colour). */
export function labelTexture(text, { w = 256, h = 48, fg = '#c9ccd2', bg = '#1c1d20', font = 'bold 30px Arial, sans-serif', spacing = 0 } = {}) {
  const key = `${text}|${w}|${h}|${fg}|${bg}|${font}`;
  if (textCache.has(key)) return textCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (spacing) g.letterSpacing = `${spacing}px`;
  g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textCache.set(key, t);
  return t;
}
function labelMat(text, opts) {
  const key = `mat|${text}|${JSON.stringify(opts || {})}`;
  if (!cache[key]) cache[key] = keep(new THREE.MeshStandardMaterial({ map: labelTexture(text, opts), roughness: 0.55, metalness: 0.1 }));
  return cache[key];
}
/** Plane with a label, facing +Z. */
export function label(text, w, h, opts) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat(text, opts));
}

/** Red 7-segment display with buttons (Chauvet / ADJ bases). Faces +Z, centred. */
export function ledDisplayPanel(w, text, { buttons = 4, buttonColor = rubber() } = {}) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3), trim());
  g.add(plate);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.34, w * 0.13), new THREE.MeshBasicMaterial({
    map: labelTexture(text, { w: 128, h: 48, fg: '#ff3a24', bg: '#140405', font: 'bold 34px monospace' }), toneMapped: false,
  }));
  disp.position.set(-w * 0.26, 0, 0.001);
  g.add(disp);
  for (let i = 0; i < buttons; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.032, w * 0.032, 0.006, 14), buttonColor);
    b.rotation.x = Math.PI / 2;
    b.position.set(w * 0.06 + i * w * 0.1, -w * 0.01, 0.003);
    g.add(b);
  }
  return g;
}

/**
 * Chauvet Intimidator Spot LED 250 (236 L × 205 W × 287 H mm): rounded base with LED
 * display and buttons, plastic yoke arms with the logo recess, rounded spot head with
 * a front lens, metal ring and vent slots. Returns the parts and where they hang.
 */
export function intimidator250(address) {
  const W = 0.236; const D = 0.205; const H = 0.287;
  const baseH = 0.088; const armT = 0.034; const headW = 0.152; const headD = 0.136;
  const gap = (W - headW - 2 * armT) / 2;
  // Base: lower body + slightly smaller top, feet, front panel, side grips.
  const base = new THREE.Group();
  const low = rbox(0.21, baseH * 0.72, D, 0.024);
  low.position.y = 0.006 + baseH * 0.36;
  const top = rbox(0.19, baseH * 0.4, D * 0.86, 0.03);
  top.position.y = 0.006 + baseH * 0.78;
  base.add(low, top, feet(0.21, D));
  const panel = ledDisplayPanel(0.15, `d${String(address || 1).padStart(3, '0')}`);
  panel.position.set(0, 0.006 + baseH * 0.38, D / 2 + 0.0015);
  base.add(panel);
  const logo = label('CHAUVET', 0.075, 0.014, { fg: '#d8dade', bg: '#2c2d31', font: 'bold 34px Arial, sans-serif', spacing: 4 });
  logo.position.set(0, 0.006 + baseH * 0.62, D * 0.43 + 0.0015);
  logo.rotation.x = -0.5;
  base.add(logo);
  for (const s of [-1, 1]) {
    const grip = rbox(0.006, baseH * 0.3, D * 0.5, 0.003, rubber());
    grip.position.set(s * 0.105, 0.006 + baseH * 0.38, 0);
    base.add(grip);
  }
  const bearing = cyl(0.055, 0.062, 0.012, trim(), 32);
  bearing.position.y = baseH + 0.006;
  base.add(bearing);
  // Yoke: bridge + two thick arms with rounded tops and the logo recess outside.
  const yoke = new THREE.Group();
  const bridge = rbox(W - 0.004, 0.022, 0.11, 0.01);
  bridge.position.y = 0.011;
  yoke.add(bridge);
  const armH = 0.168;
  const pivotY = 0.112; // from the bridge bottom
  for (const s of [-1, 1]) {
    const x = s * (headW / 2 + gap + armT / 2);
    const arm = rbox(armT, armH, 0.11, 0.016);
    arm.position.set(x, armH / 2, 0);
    const recess = rbox(0.004, armH * 0.62, 0.07, 0.002, trim());
    recess.position.set(x + s * (armT / 2), armH * 0.46, 0);
    const name = label('INTIMIDATOR', 0.09, 0.016, { w: 384, h: 64, fg: '#b9bcc2', bg: '#232427', font: 'bold 40px Arial, sans-serif', spacing: 3 });
    name.rotation.set(0, s * Math.PI / 2, s * Math.PI / 2);
    name.position.set(x + s * (armT / 2 + 0.0025), armH * 0.46, 0);
    const knob = cyl(0.022, 0.022, 0.008, trim(), 24);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(x + s * (armT / 2 + 0.002), pivotY, 0);
    yoke.add(arm, recess, name, knob);
  }
  // Head (emits along +Y; pivot at its origin).
  const head = new THREE.Group();
  const yokeY = baseH + 0.012;
  const back = 0.066; const front = H - yokeY - pivotY - 0.005; // lens plane above the pivot (ring on top)
  const body = rbox(headW, back + front * 0.72, headD, 0.04);
  body.position.y = (front * 0.72 - back) / 2;
  head.add(body);
  // Tapered nose with the lens, a bright ring around it and the dark bezel.
  const noseH = front * 0.3;
  const lensR = 0.031;
  const nose = cyl(lensR + 0.016, headW * 0.42, noseH, housing(), 40);
  nose.position.y = front - noseH / 2;
  head.add(nose);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(lensR + 0.007, 0.004, 10, 40), alu());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = front;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(lensR + 0.013, 0.004, 10, 40), trim());
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = front - 0.001;
  head.add(ring, bezel);
  const lensMat = lens('fresnel');
  const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(lensR, 40), lensMat);
  lensMesh.rotation.x = -Math.PI / 2;
  lensMesh.position.y = front + 0.0008; // just in front of the nose cap
  head.add(lensMesh);
  // Vent slots on both sides and the back cover.
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(headD * 0.62, (back + front * 0.72) * 0.55), grille());
    v.rotation.y = s * Math.PI / 2;
    v.position.set(s * (headW / 2 + 0.0008), -back * 0.25, 0);
    head.add(v);
    const vz = new THREE.Mesh(new THREE.PlaneGeometry(headW * 0.55, (back + front * 0.72) * 0.4), grille());
    vz.rotation.y = s > 0 ? 0 : Math.PI;
    vz.position.set(0, -back * 0.35, s * (headD / 2 + 0.0008));
    head.add(vz);
    const hub = cyl(0.026, 0.026, 0.006, trim(), 24);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = s * (headW / 2 + 0.003);
    head.add(hub);
  }
  const cap = rbox(headW * 0.7, 0.012, headD * 0.7, 0.005, trim());
  cap.position.y = -back + 0.004;
  head.add(cap);
  return { base, yoke, yokeY, head, pivotY, lensMat, frontY: front };
}

/**
 * Flat 6×6 RGB par (UKing ZQ01104, 212 × 212 × 136 mm with the bracket): 12 red,
 * 12 green and 12 blue LEDs behind a clear cover; each colour lights only with its channel.
 * Returns { group, ledMats: [r, g, b], faceY } – body centred at y = 0, face up.
 */
export function flat36Body(address) {
  const g = new THREE.Group();
  const size = 0.18; const thick = 0.112;
  const shell = rbox(size, thick, size, 0.028);
  g.add(shell);
  const bezel = rbox(size * 0.96, 0.006, size * 0.96, 0.024, trim());
  bezel.position.y = thick / 2;
  g.add(bezel);
  const pcb = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.84, size * 0.84), new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.2 }));
  pcb.rotation.x = -Math.PI / 2;
  pcb.position.y = thick / 2 + 0.0035;
  g.add(pcb);
  const ledMats = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.12, metalness: 0.05, emissive: 0x000000 }));
  const tint = [[0.3, 0.2, 0.18], [0.19, 0.27, 0.2], [0.18, 0.2, 0.3]]; // clear lenses, faint die colour when off
  ledMats.forEach((m, i) => m.color.setRGB(...tint[i]));
  const ledGeo = new THREE.SphereGeometry(0.0085, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const cupGeo = new THREE.CylinderGeometry(0.011, 0.009, 0.004, 16, 1, true);
  const pitch = 0.0265;
  const meshes = ledMats.map((m) => new THREE.InstancedMesh(ledGeo, m, 12));
  const cups = new THREE.InstancedMesh(cupGeo, alu(), 36);
  const count = [0, 0, 0];
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const c = (i + j) % 3; // diagonal R / G / B stripes, 12 of each
      const x = (i - 2.5) * pitch; const z = (j - 2.5) * pitch;
      mtx.makeTranslation(x, thick / 2 + 0.004, z);
      meshes[c].setMatrixAt(count[c]++, mtx);
      mtx.makeTranslation(x, thick / 2 + 0.0055, z);
      cups.setMatrixAt(i * 6 + j, mtx);
    }
  }
  g.add(cups, ...meshes);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.9, size * 0.9), glass());
  cover.rotation.x = -Math.PI / 2;
  cover.position.y = thick / 2 + 0.0135;
  g.add(cover);
  const coverRim = rbox(size * 0.94, 0.008, size * 0.94, 0.022, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 0.6, transparent: true, opacity: 0.35, depthWrite: false }));
  coverRim.position.y = thick / 2 + 0.01;
  g.add(coverRim);
  // Back: cooling slots, small LCD + 4 buttons, power switch and charging socket.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.6, size * 0.34), grille());
  back.rotation.x = Math.PI / 2;
  back.position.set(0, -thick / 2 - 0.001, -size * 0.18);
  g.add(back);
  const panel = controlPanel(size * 0.8, address);
  panel.rotation.x = Math.PI / 2;
  panel.position.set(0, -thick / 2 - 0.0015, size * 0.2);
  g.add(panel);
  const sw = rbox(0.014, 0.008, 0.02, 0.002, rubber());
  sw.position.set(size * 0.36, -thick / 2 - 0.003, size * 0.2);
  const plug = cyl(0.006, 0.006, 0.006, alu(), 12);
  plug.position.set(-size * 0.36, -thick / 2 - 0.003, size * 0.2);
  g.add(sw, plug);
  const brand = label('UKING', 0.05, 0.012, { fg: '#c8cbd0', bg: '#2a2b2f', font: 'bold 32px Arial, sans-serif', spacing: 3 });
  brand.position.set(0, -thick * 0.05, size / 2 + 0.0008);
  g.add(brand);
  return { group: g, ledMats, faceY: thick / 2 + 0.014, size, thick };
}

/** Slim U bracket with round knobs right at the body sides (battery pars). Strap at y = 0. */
export function slimBracket(bodyW, pivotY, mat = steel()) {
  const g = new THREE.Group();
  const strap = rbox(bodyW + 0.012, 0.005, 0.032, 0.002, mat);
  strap.position.y = 0.0025;
  g.add(strap);
  for (const s of [-1, 1]) {
    const arm = rbox(0.005, pivotY + 0.018, 0.032, 0.002, mat);
    arm.position.set(s * (bodyW / 2 + 0.004), (pivotY + 0.018) / 2, 0);
    const knob = cyl(0.016, 0.016, 0.01, rubber(), 20);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(s * (bodyW / 2 + 0.0115), pivotY, 0);
    const cap = cyl(0.006, 0.006, 0.002, alu(), 12);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(s * (bodyW / 2 + 0.017), pivotY, 0);
    g.add(arm, knob, cap);
  }
  return g;
}

/**
 * ADJ Entour Faze hazer (414 L × 202 W × 303 H mm): black metal box on two U brackets
 * that work as floor stand, nozzle + fan at the front (+Z), display, buttons, faze
 * switch and sockets at the back. Returns { group, nozzle: Vector3 }.
 */
export function entourFaze(address) {
  const g = new THREE.Group();
  const L = 0.414; const W = 0.202; const H = 0.303;
  const boxW = 0.17; const boxH = 0.242; const boxL = 0.394; const lift = H - boxH;
  const paint = cache.entourPaint || (cache.entourPaint = keep(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0.55, map: plasticTexture() })));
  const box = rbox(boxW, boxH, boxL, 0.012, paint);
  box.position.y = lift + boxH / 2;
  g.add(box);
  // Two U brackets: strap on the floor, arms up the sides to the knobs.
  const knobY = lift + boxH * 0.42;
  for (const z of [-boxL * 0.32, boxL * 0.32]) {
    const strap = rbox(W - 0.03, 0.006, 0.04, 0.002, steel());
    strap.position.set(0, 0.003, z);
    g.add(strap);
    for (const s of [-1, 1]) {
      const arm = rbox(0.005, knobY + 0.02, 0.04, 0.002, steel());
      arm.position.set(s * (boxW / 2 + 0.004), (knobY + 0.02) / 2, z);
      const bend = rbox(0.018, 0.006, 0.04, 0.002, steel());
      bend.position.set(s * (boxW / 2 - 0.004), 0.003, z);
      const knob = cyl(0.017, 0.017, 0.012, rubber(), 16);
      knob.rotation.z = Math.PI / 2;
      knob.position.set(s * (boxW / 2 + 0.013), knobY, z);
      const wing = rbox(0.008, 0.042, 0.011, 0.003, rubber());
      wing.position.set(s * (boxW / 2 + 0.021), knobY, z);
      g.add(arm, bend, knob, wing);
    }
    for (const s of [-1, 1]) {
      const foot = cyl(0.011, 0.013, 0.006, rubber(), 12);
      foot.position.set(s * (W / 2 - 0.03), -0.0, z);
      g.add(foot);
    }
  }
  // Front: round fan grille with the haze nozzle in the middle.
  const front = boxL / 2 + 0.001;
  const fanY = lift + boxH * 0.5;
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.005, 10, 36), trim());
  fanRing.position.set(0, fanY, front);
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.055, 36), grille());
  fan.position.set(0, fanY, front);
  const nozzle = cyl(0.012, 0.018, 0.026, steel(), 20);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, fanY, front + 0.013);
  const tip = cyl(0.006, 0.006, 0.004, rubber(), 12);
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0, fanY, front + 0.027);
  const logo = label('ADJ  ENTOUR FAZE', 0.13, 0.016, { w: 512, h: 64, fg: '#c9ccd2', bg: '#1b1c1f', font: 'bold 40px Arial, sans-serif', spacing: 3 });
  logo.position.set(0, lift + boxH * 0.86, front);
  g.add(fanRing, fan, nozzle, tip, logo);
  // Back: display + buttons, faze switch, power and DMX sockets, fluid level window on the side.
  const rear = -boxL / 2 - 0.001;
  const panel = ledDisplayPanel(0.13, `${String(address || 1).padStart(3, '0')}`);
  panel.rotation.y = Math.PI;
  panel.position.set(0, lift + boxH * 0.72, rear);
  g.add(panel);
  const faze = rbox(0.014, 0.026, 0.01, 0.003, new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.4 }));
  faze.position.set(0.045, lift + boxH * 0.42, rear - 0.004);
  const fazeLabel = label('FAZE', 0.03, 0.009, { fg: '#e0e2e6', bg: '#1b1c1f', font: 'bold 30px Arial, sans-serif' });
  fazeLabel.rotation.y = Math.PI;
  fazeLabel.position.set(0.045, lift + boxH * 0.5, rear);
  g.add(faze, fazeLabel);
  for (const [x, r] of [[-0.05, 0.011], [-0.02, 0.011], [0.0, 0.009]]) {
    const xlr = cyl(r, r, 0.012, alu(), 16);
    xlr.rotation.x = Math.PI / 2;
    xlr.position.set(x, lift + boxH * 0.3, rear - 0.004);
    g.add(xlr);
  }
  const iec = rbox(0.03, 0.022, 0.01, 0.002, rubber());
  iec.position.set(0.0, lift + boxH * 0.14, rear - 0.004);
  g.add(iec);
  const windowMat = cache.fluidWin || (cache.fluidWin = keep(new THREE.MeshStandardMaterial({ color: 0x7fb8d8, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 })));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.08), windowMat);
  win.rotation.y = Math.PI / 2;
  win.position.set(boxW / 2 + 0.001, lift + boxH * 0.3, -boxL * 0.12);
  g.add(win);
  // Top: carry handle recess.
  const grip = rbox(0.05, 0.01, 0.13, 0.004, rubber());
  grip.position.set(0, lift + boxH + 0.004, 0);
  g.add(grip);
  return { group: g, nozzle: new THREE.Vector3(0, fanY, front + 0.03) };
}
