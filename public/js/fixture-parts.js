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
