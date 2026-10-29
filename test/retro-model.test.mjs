// The 7 retro bulbs must be visible from the front: nothing opaque may sit
// between the viewer and a bulb (regression: v1.5–1.7 hid them behind the housing).
import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM for labels and canvas textures.
const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
globalThis.document ??= {
  documentElement: {},
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, style: {}, getContext: () => any() }
    : { style: {}, className: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, textContent: '' }),
};

const THREE = await import('three');
const { createFixtureModel, RETRO_BULB_Y, RETRO_HOUSING_FRONT } = await import('../public/js/fixtures3d.js');
const { BUILTIN_PROFILES, normalizeProfile } = await import('../public/js/profiles.js');

test('retro bulbs are in front of the housing and not covered', () => {
  assert.ok(RETRO_HOUSING_FRONT < RETRO_BULB_Y, 'housing face behind the bulbs');
  const profile = normalizeProfile(BUILTIN_PROFILES.find((p) => p.kind === 'retro'));
  const fixture = { id: 'fx1', name: 'Retro 1', profileId: profile.id, universe: 1, address: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  const model = createFixtureModel(fixture, profile, { allocateLight: () => true, roomUniforms: {}, goboLights: null, particles: null });
  model.root.updateMatrixWorld(true);
  assert.equal(model.cells.length, 7);
  const glowMeshes = [];
  model.root.traverse((o) => { if (o.userData.glow) glowMeshes.push(o); });
  assert.equal(glowMeshes.length, 14, 'filament + glow per head');
  const opaque = [];
  model.root.traverse((o) => {
    if (!o.isMesh || o.userData.glow || o.material?.isShaderMaterial) return;
    if (o.material?.transparent && o.material.opacity < 0.9) return; // bulb glass
    opaque.push(o);
  });
  const ray = new THREE.Raycaster();
  for (const g of glowMeshes.filter((m) => m.geometry.type === 'SphereGeometry')) {
    const p = g.getWorldPosition(new THREE.Vector3());
    ray.set(new THREE.Vector3(p.x, 1, p.z), new THREE.Vector3(0, -1, 0));
    const blocking = ray.intersectObjects(opaque, false).filter((h) => h.point.y > p.y + 0.001);
    assert.deepEqual(blocking.map((h) => h.object.geometry.type), [], `bulb at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is covered`);
  }
});
