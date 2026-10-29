// DJ Matei's 5 real fixtures look like the real devices: the built-in Panther 60 model
// (glb, meshopt) and the procedural Intimidator / UKing / retro / Entour at real size.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Minimal DOM for labels and canvas textures.
const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
globalThis.document ??= {
  documentElement: {},
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, style: {}, getContext: () => any() }
    : { style: {}, className: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, textContent: '' }),
};
// What GLTFLoader needs for the WebP texture outside a browser.
globalThis.self ??= globalThis;
globalThis.Image ??= class { set src(_) { setTimeout(() => { this.height = 1; this.onload?.(); }); } };
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('/models/')) {
    const file = new URL(`../public${u}`, import.meta.url);
    if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
    return new Response(fs.readFileSync(file));
  }
  return realFetch(url, opts);
};

const THREE = await import('three');
const { createFixtureModel } = await import('../public/js/fixtures3d.js');
const { gltfLoader, assembleModel, applyModel, BUILTIN_MODELS } = await import('../public/js/models3d.js');
const { parseSoundSwitchVenues, ssPlacement } = await import('../public/js/ss-import.js');
const { normalizeProfile } = await import('../public/js/profiles.js');

const bin = fs.readFileSync(new URL('./ss/SoundSwitchVenues.bin', import.meta.url));
const { profiles } = ssPlacement(parseSoundSwitchVenues(bin), { trussY: 3.35, trussZ: -9, trussHalf: 3.4, roomHalfWidth: 13, backZ: -10 });
const prof = (name) => normalizeProfile(JSON.parse(JSON.stringify(profiles.find((p) => p.name.startsWith(name)))));
const ctx = { allocateLight: () => true, releaseLight() {}, roomUniforms: {}, goboLights: null, particles: null, settings: { lightPower: 1 }, puffTexture: null };
const build = (profile) => {
  const fixture = { id: 'fx', name: profile.name, profileId: profile.id, universe: 1, address: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  const model = createFixtureModel(fixture, { ...profile, model: undefined }, ctx);
  model.root.updateMatrixWorld(true);
  return model;
};
/** Size of the housing (no beams, lights, labels or haze sprites). */
function housingSize(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || o.material?.isShaderMaterial || !o.visible) return;
    if (o.isInstancedMesh) { o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); return; }
    box.expandByObject(o, true);
  });
  return box.getSize(new THREE.Vector3());
}
const within = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= expected * tol, `${what}: ${actual.toFixed(3)} m, real ${expected} m`);

test('Panther 60 glb (meshopt + quantized + WebP) loads with Support / Head parts', async () => {
  const buf = fs.readFileSync(new URL('../public/models/panther-60.glb', import.meta.url));
  const gltf = await gltfLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const support = gltf.scene.getObjectByName('Support');
  const head = gltf.scene.getObjectByName('Head');
  assert.ok(support && head, 'Support and Head nodes');
  let p = head.parent; while (p && p !== support) p = p.parent;
  assert.equal(p, support, 'Head moves with Support (pan)');
  assert.ok(BUILTIN_MODELS['panther-60.glb'].credit.includes('CC BY 4.0'));
});

test('Panther 60: real height, pan / tilt pivots, beam from the lens centre', async () => {
  const asm = await assembleModel({ type: 'builtin', file: 'panther-60.glb', height: 0.29 }, 'moving');
  within(asm.size.y, 0.29, 0.01, 'height');
  within(asm.size.x, 0.205, 0.15, 'width');
  within(asm.size.z, 0.19, 0.1, 'depth');
  assert.deepEqual(asm.parts.yoke.map((o) => o.name), ['Support']);
  assert.deepEqual(asm.parts.head.map((o) => o.name), ['Head']);
  assert.ok(Math.hypot(asm.panPivot.x, asm.panPivot.z) < 0.003, 'pan axis through the centre');
  assert.ok(asm.tiltPivot.y > 0.17 && asm.tiltPivot.y < 0.25, `tilt axis at ${asm.tiltPivot.y}`);
  assert.ok(Math.abs(asm.beam.y - 0.29) < 0.005 && Math.hypot(asm.beam.x, asm.beam.z) < 0.003, 'beam leaves the front of the lens, centred');

  // Applied to the moving head: the real parts follow pan / tilt and the lens glows.
  const profile = prof('Panther');
  assert.deepEqual(profile.model, { type: 'builtin', file: 'panther-60.glb', height: 0.29 });
  const model = build(profile);
  await applyModel(model, profile);
  assert.ok(model.modelLoaded);
  const names = (g) => g.children.map((o) => o.name);
  assert.ok(names(model.yoke).includes('Support') && names(model.head).includes('Head'));
  model.root.updateMatrixWorld(true);
  const lens = model.beamOrigin.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(lens.y - 0.29) < 0.005 && Math.hypot(lens.x, lens.z) < 0.003, `beam origin ${lens.toArray()}`);
  const disc = model.beamOrigin.children.find((o) => o.isMesh && o.geometry.type === 'CircleGeometry');
  assert.ok(disc && disc.material === model.lensMat, 'glowing lens disc');
  // Tilt 90°: the lens swings around the tilt axis, the beam origin with it.
  model.head.rotation.x = Math.PI / 2;
  model.root.updateMatrixWorld(true);
  const tilted = model.beamOrigin.getWorldPosition(new THREE.Vector3());
  const pivot = model.head.getWorldPosition(new THREE.Vector3());
  within(tilted.distanceTo(pivot), lens.distanceTo(pivot), 0.01, 'lens radius around the tilt axis');
  assert.ok(Math.abs(tilted.y - pivot.y) < 0.005, 'horizontal beam after 90° tilt');
});

test('Chauvet Intimidator Spot LED 250: 236 × 287 × 205 mm', () => {
  const model = build(prof('Intimidator'));
  const s = housingSize(model.root);
  within(s.x, 0.236, 0.1, 'width');
  within(s.y, 0.287, 0.1, 'height');
  within(s.z, 0.205, 0.1, 'depth');
  // The lens is at the top, centred, and the beam starts there.
  const o = model.beamOrigin.getWorldPosition(new THREE.Vector3());
  assert.ok(o.y > 0.27 && o.y < 0.295 && Math.hypot(o.x, o.z) < 0.001);
});

test('UKing ZQ01104: 212 × 212 × 136 mm, 12 R + 12 G + 12 B LEDs lit by their own channel', () => {
  const model = build(prof('ZQ01104'));
  const s = housingSize(model.root);
  within(s.x, 0.212, 0.1, 'width with the knobs');
  const body = housingSize(model.body);
  within(body.y, 0.136, 0.1, 'depth (front to back)');
  within(model.body.position.y + body.x / 2, 0.212, 0.1, 'height standing on the bracket');
  const leds = [];
  model.root.traverse((o) => { if (o.isInstancedMesh && model.ledMats.includes(o.material)) leds.push(o); });
  assert.deepEqual(leds.map((m) => m.count), [12, 12, 12]);
  const st = (color) => ({ color, intensity: 1, beamAngle: 25 });
  const lit = () => model.ledMats.map((m) => +Math.max(m.emissive.r, m.emissive.g, m.emissive.b).toFixed(2) > 0);
  model.update(st([1, 0, 0]), { haze: 0.5 }, 0.02);
  assert.deepEqual(lit(), [true, false, false], 'red only');
  assert.ok(model.ledMats[0].emissive.r > model.ledMats[0].emissive.g * 5, 'red LEDs glow red');
  model.update(st([0, 1, 1]), { haze: 0.5 }, 0.02);
  assert.deepEqual(lit(), [false, true, true], 'green + blue');
});

test('ADJ Entour Faze: 414 × 202 × 303 mm, haze leaves the front nozzle', () => {
  const model = build(prof('Entour'));
  const s = housingSize(model.root);
  within(s.x, 0.202, 0.1, 'width');
  within(s.y, 0.303, 0.1, 'height');
  within(s.z, 0.414, 0.1, 'length');
  assert.ok(model.nozzle.z > 0.2 && model.nozzle.y > 0.1, 'nozzle at the front');
  model.update({ fog: 1 }, { haze: 0.5 }, 0.05);
  const first = model.puffs.reduce((a, p) => (p.userData.t < a.userData.t ? p : a));
  assert.ok(first.position.distanceTo(model.nozzle) < 0.15, 'youngest puff at the nozzle');
});

test('7 Vintage retro: overall size from the profile (default 475 mm), RGB ring + warm filament', () => {
  const p = prof('7 Vintage');
  assert.equal(p.size, 0.475);
  within(housingSize(build(p).root).x, 0.475, 0.05, 'default width');
  within(housingSize(build({ ...p, size: 0.6 }).root).x, 0.6, 0.05, 'custom width');
  const model = build(p);
  assert.ok(model.ring && model.ring.count === 7 * 12, 'SMD ring per head');
  const px = Array.from({ length: 7 }, (_, i) => ({ color: [1, 0.78, 0.5], intensity: 1, ww: i === 0 ? 1 : 0, rgb: i === 0 ? [0, 0, 0] : [1, 0, 0] }));
  model.update({ color: [1, 1, 1], intensity: 1, beamAngle: 40, pixels: px }, { haze: 0.5 }, 0.02);
  assert.ok(model.cells[0].mat.emissive.r > 1, 'head 1: warm filament on');
  assert.ok(model.cells[1].mat.emissive.r < 0.01, 'head 2: filament off, only RGB');
  const c = new THREE.Color();
  model.ring.getColorAt(12, c);
  assert.ok(c.r > 1 && c.g < 0.5, 'head 2 ring glows red');
});

test('QLC+ files of the same fixtures get the same look (beamZ Panther 60, Intimidator 250, Entour Faze)', async () => {
  const { parseQxf, listQxfModes, qxfToProfile } = await import('../public/js/qxf-import.js');
  const load = (n) => {
    const root = parseQxf(fs.readFileSync(new URL(`./qxf/${n}`, import.meta.url), 'utf8'));
    return qxfToProfile(root, listQxfModes(root).at(-1).index);
  };
  assert.deepEqual(load('beamZ-Panther-60-LED-Beam-RGBW.qxf').model, { type: 'builtin', file: 'panther-60.glb', height: 0.29 });
  assert.equal(load('Chauvet-Intimidator-Spot-LED-250.qxf').style, 'intimidator');
  const hazer = load('American-DJ-Entour-Faze.qxf');
  assert.equal(hazer.style, 'entour');
  // Other fixtures keep the generic look.
  assert.equal(load('Chauvet-Intimidator-Spot-255-IRC.qxf').style, 'spot');
  assert.equal(load('Chauvet-Intimidator-Spot-255-IRC.qxf').model, undefined);
});
