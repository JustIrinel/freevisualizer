import test from 'node:test';
import assert from 'node:assert';
import { crowdLayout, CROWD_MIN_SPACING, CROWD_SPACING, tripodMount, TRIPOD_BAR_R, barSlots, caseTop, caseMount, spreadOver } from '../public/js/prop-layout.js';
import { placementFor } from '../public/js/assistant.js';
import { weddingProject } from '../public/js/project.js';

const minDist = (pts) => {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
  return m;
};

test('crowd: no overlaps, inside the area, realistic heights, same seed = same crowd', () => {
  const params = { width: 6.5, depth: 5.5, count: 24, density: 2, size: 1 };
  const a = crowdLayout(params, 7);
  assert.strictEqual(a.length, 24);
  assert.ok(minDist(a) >= CROWD_SPACING[2] - 1e-9, 'normal density keeps the preset spacing when the count fits');
  assert.ok(a.every((g) => Math.abs(g.x) <= 3.25 && Math.abs(g.z) <= 2.75));
  assert.ok(a.every((g) => g.height >= 1.55 && g.height <= 1.85));
  assert.deepStrictEqual(crowdLayout(params, 7), a);
  assert.notDeepStrictEqual(crowdLayout(params, 8), a);
  const kids = crowdLayout({ ...params, size: 0.8 }, 7);
  assert.ok(kids.every((g) => g.height <= 1.85 * 0.8 + 1e-9));
});

test('crowd: density packs the same guests into a smaller group', () => {
  const extent = (pts) => Math.max(...pts.map((g) => Math.abs(g.x))) + Math.max(...pts.map((g) => Math.abs(g.z)));
  const params = { width: 12, depth: 8, count: 40, size: 1 };
  const few = crowdLayout({ ...params, density: 1 }, 5);
  const many = crowdLayout({ ...params, density: 3 }, 5);
  assert.strictEqual(few.length, 40);
  assert.strictEqual(many.length, 40);
  assert.ok(extent(many) < extent(few) * 0.7);
  assert.ok(minDist(many) >= CROWD_MIN_SPACING - 1e-9);
});

test('crowd: too many people relax the spacing, then the crowd is capped', () => {
  const packed = crowdLayout({ width: 6, depth: 6, count: 60, density: 1, size: 1 }, 3);
  assert.strictEqual(packed.length, 60);
  assert.ok(minDist(packed) >= CROWD_MIN_SPACING - 1e-9);
  const capped = crowdLayout({ width: 2, depth: 2, count: 600, density: 3, size: 1 }, 3);
  assert.ok(capped.length < 60 && capped.length > 5);
  assert.ok(minDist(capped) >= CROWD_MIN_SPACING - 1e-9);
});

test('tripod: fixtures stand on the T-bar or hang under it, following the stand rotation', () => {
  const stand = { position: { x: 2, y: 0, z: -1 }, rotation: { x: 0, y: 90, z: 0 }, params: { height: 2.5, bar: 1.2, legs: 1.2 } };
  const top = tripodMount(stand, 0.4);
  assert.deepStrictEqual(top.position, { x: 2, y: 2.5, z: -1.4 });
  assert.deepStrictEqual(top.rotation, { x: 0, y: 90, z: 0 });
  const hang = tripodMount(stand, 0.4, true);
  assert.strictEqual(hang.position.y, Math.round((2.5 - 2 * TRIPOD_BAR_R) * 100) / 100);
  assert.strictEqual(hang.rotation.x, 180);
  assert.strictEqual(tripodMount(stand, 5).position.z, -1.54, 'offset clamped to the bar');
  const plate = tripodMount({ ...stand, params: { height: 1.8, bar: 0 } }, 0.5, true);
  assert.deepStrictEqual(plate.position, { x: 2, y: 1.8, z: -1 });
  assert.strictEqual(plate.rotation.x, 0);
  assert.strictEqual(tripodMount({ ...stand, params: { height: 9, bar: 1 } }).position.y, 4, 'height clamped to 4 m');
  assert.deepStrictEqual(barSlots(1.2, 2).map((x) => Math.round(x * 100) / 100), [-0.4, 0.4]);
  assert.deepStrictEqual(barSlots(0, 2), [0, 0]);
});

test('case: lid height for stacked cases and spread over several targets', () => {
  const low = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, params: { width: 1.2, height: 0.75, depth: 0.6 } };
  const high = { ...low, position: { x: 0, y: 0.75, z: 0 }, params: { ...low.params, height: 0.5 } };
  assert.strictEqual(caseTop(low), 0.75);
  assert.strictEqual(caseTop(high), 1.25);
  assert.deepStrictEqual(caseMount(high, 0.2).position, { x: 0.2, y: 1.25, z: 0 });
  const a = { position: { x: 3 } }; const b = { position: { x: -3 } };
  assert.deepStrictEqual(spreadOver([a, b], 3, () => 1.2).map((s) => [s.target.position.x, Math.round(s.offset * 100) / 100]), [[-3, -0.4], [-3, 0.4], [3, 0]]);
  assert.deepStrictEqual(spreadOver([a, b], 1, () => 1.2).map((s) => s.target.position.x), [-3]);
  assert.deepStrictEqual(spreadOver([], 2, () => 1), []);
});

test('assistant placement: "stand" spreads over the tripods, "case" goes on the lids', () => {
  const project = weddingProject();
  const app = { project };
  const stands = project.props.filter((o) => o.type === 'tripod');
  assert.strictEqual(stands.length, 2);
  const spots = placementFor(app, 4, { surface: 'stand', truss_id: null, position: null, spacing: null });
  assert.strictEqual(spots.length, 4);
  assert.ok(spots.every((s) => s.position.y === 2.6 && s.rotation.x === 0));
  assert.ok(spots[0].position.x < 0 && spots[3].position.x > 0);
  const one = placementFor(app, 2, { surface: 'stand', truss_id: stands[1].id, position: null, spacing: null });
  assert.ok(one.every((s) => s.position.x > 5));
  assert.throws(() => placementFor(app, 1, { surface: 'case', truss_id: null, position: null, spacing: null }));
  project.props.push({ id: 'c1', type: 'case', name: 'Case', position: { x: 1, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, params: { width: 1.2, height: 0.75, depth: 0.6, wheels: 1 } });
  const onCase = placementFor(app, 2, { surface: 'case', truss_id: null, position: null, spacing: null });
  assert.deepStrictEqual(onCase.map((s) => s.position), [{ x: 0.75, y: 0.75, z: 2 }, { x: 1.25, y: 0.75, z: 2 }]);
});

test('light totem: fixtures stand on the top plate, cover / sizes clamped', async () => {
  const { totemParams, totemTop, totemMount } = await import('../public/js/prop-layout.js');
  const totem = { position: { x: 2, y: 0, z: -3 }, rotation: { x: 0, y: 90, z: 0 }, params: { height: 2.2, plate: 0.5 } };
  assert.equal(totemTop(totem), 2.2);
  const at = totemMount(totem, 0);
  assert.deepEqual(at.position, { x: 2, y: 2.2, z: -3 });
  assert.equal(at.rotation.y, 90);
  // Offsets stay on the plate (±0.13 m for a 0.5 m plate).
  const edge = totemMount({ ...totem, rotation: { x: 0, y: 0, z: 0 } }, 5);
  assert.equal(edge.position.x, 2.13);
  assert.deepEqual(totemParams({ height: 9, plate: 0.1, cover: 7 }), { height: 3.5, plate: 0.3, cover: 2 });
  assert.equal(totemParams({ cover: 0 }).cover, 0);
});

test('speaker stand: pole height, speaker on / off and size', async () => {
  const { speakerStandParams, speakerStandTop } = await import('../public/js/prop-layout.js');
  const p = speakerStandParams({ height: 1.9, speaker: 1, size: 15 });
  assert.equal(p.height, 1.9);
  assert.equal(p.box.height, 0.72);
  assert.equal(speakerStandParams({ size: 99 }).size, 12);
  assert.equal(speakerStandParams({ speaker: 0 }).speaker, 0);
  assert.equal(speakerStandParams({ height: 5 }).height, 2.4);
  assert.equal(speakerStandTop({ position: { x: 0, y: 0.2, z: 0 }, params: { height: 1.5 } }), 1.7);
});
