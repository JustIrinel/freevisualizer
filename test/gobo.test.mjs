import test from 'node:test';
import assert from 'node:assert';
import { computeState, createRuntime, rotationFromRange, ROT_SLOW, ROT_FAST } from '../public/js/fixture-state.js';
import { BUILTIN_PROFILES, normalizeProfile, rotationRanges, prismRanges, goboRanges } from '../public/js/profiles.js';
import { prismCopies, prismPattern, projectionLayout, designIndex, goboImage, MAX_COPIES } from '../public/js/gobo-layout.js';

const builtin = (id) => normalizeProfile(BUILTIN_PROFILES.find((p) => p.id === id));
const dmxOf = (profile, values) => {
  const b = new Uint8Array(512);
  profile.channels.forEach((c, i) => { if (values[c.type] != null) b[i] = values[c.type]; });
  return b;
};
const custom = (channels) => normalizeProfile({ id: 't', name: 't', kind: 'moving', beamAngle: [14, 14], channels });
const run = (p, values, frames = 1, dt = 0.1, rt = createRuntime()) => {
  let s;
  for (let i = 0; i < frames; i++) s = computeState(p, dmxOf(p, values), 1, rt, dt, i * dt);
  return s;
};
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('gobo index channel sets the angle across the range', () => {
  const p = custom([{ type: 'gobo', ranges: goboRanges(8) }, { type: 'goboRot', ranges: rotationRanges() }]);
  close(run(p, { gobo: 20, goboRot: 0 }).gobos[0].angle, 0);
  close(run(p, { gobo: 20, goboRot: 127 }).gobos[0].angle, Math.PI * 2);
  const half = run(p, { gobo: 20, goboRot: 64 });
  close(half.gobos[0].angle, (64 / 127) * Math.PI * 2);
  assert.strictEqual(half.gobos[0].slot, 1);
  // Old single-wheel fields follow wheel 1.
  assert.strictEqual(half.gobo, 1);
  close(half.goboRotation, half.gobos[0].angle);
});

test('gobo rotation accumulates with speed and direction, stop holds the angle', () => {
  const p = custom([{ type: 'gobo', ranges: goboRanges(8) }, { type: 'goboRot', ranges: rotationRanges() }]);
  const rt = createRuntime();
  // 194–255: counter-clockwise, slow → fast.
  const slow = run(p, { gobo: 20, goboRot: 194 }, 10, 0.1, rt).gobos[0].angle;
  close(slow, -ROT_SLOW * 1, 1e-3);
  const rt2 = createRuntime();
  const fast = run(p, { gobo: 20, goboRot: 255 }, 10, 0.1, rt2).gobos[0].angle;
  close(fast, -ROT_FAST * 1, 1e-3);
  // 128–189: clockwise, fast → slow.
  const rt3 = createRuntime();
  const cw = run(p, { gobo: 20, goboRot: 128 }, 10, 0.1, rt3).gobos[0].angle;
  close(cw, ROT_FAST, 1e-3);
  const held = run(p, { gobo: 20, goboRot: 191 }, 10, 0.1, rt3).gobos[0].angle;
  close(held, cw, 1e-9);
});

test('rotation ranges: index, rotate ±, stop', () => {
  assert.strictEqual(rotationFromRange({ from: 0, to: 10, stop: true }, 5), null);
  close(rotationFromRange({ from: 0, to: 100, index: true, angleFrom: 0, angleTo: 180 }, 50).index, Math.PI / 2);
  assert.ok(rotationFromRange({ from: 0, to: 100, rotate: -1 }, 0).speed < 0);
  assert.ok(rotationFromRange({ from: 0, to: 100, rotate: 1, fastToSlow: true }, 0).speed > rotationFromRange({ from: 0, to: 100, rotate: 1, fastToSlow: true }, 100).speed);
});

test('two gobo wheels and two prisms, each with its own rotation', () => {
  const p = builtin('gen-mh-spot-2g2p-20');
  assert.strictEqual(p.channels.length, 20);
  const rt = createRuntime();
  const s = run(p, { dimmer: 255, gobo: 40, goboRot: 255, gobo2: 30, gobo2Rot: 130, prism: 200, prismRot: 64, prism2: 200, prism2Rot: 194 }, 5, 0.1, rt);
  assert.strictEqual(s.gobos.length, 2);
  assert.strictEqual(s.gobos[0].slot, 2);
  assert.strictEqual(s.gobos[1].slot, 2);
  assert.ok(s.gobos[0].angle < 0 && s.gobos[1].angle > 0, 'wheels turn in opposite directions');
  assert.deepStrictEqual(s.prisms.map((x) => [x.facets, x.shape]), [[3, 'circular'], [4, 'linear']]);
  close(s.prisms[0].angle, (64 / 127) * Math.PI * 2);
  assert.ok(s.prisms[1].angle < 0);
  assert.strictEqual(s.prism, 3);
  const off = run(p, { dimmer: 255, prism: 0, prism2: 200 });
  assert.strictEqual(off.prism, 4, 'old field reports the active prism');
});

test('a second channel typed "gobo" / "prism" becomes wheel 2 / prism 2', () => {
  const p = custom([{ type: 'gobo', ranges: goboRanges(4) }, { type: 'gobo', ranges: goboRanges(4) }, { type: 'prism', ranges: prismRanges(3) }, { type: 'prism', ranges: prismRanges(6) }]);
  const b = new Uint8Array(512); b[0] = 40; b[1] = 70; b[2] = 200; b[3] = 200;
  const s = computeState(p, b, 1, createRuntime(), 0.016, 0);
  assert.deepStrictEqual(s.gobos.map((g) => g.slot), [1, 2]);
  assert.deepStrictEqual(s.prisms.map((x) => x.facets), [3, 6]);
});

test('frost, legacy gobo shake and wheel spin', () => {
  const beam = builtin('gen-mh-beam-16');
  assert.ok(beam.channels.some((c) => c.type === 'prismRot'));
  assert.strictEqual(run(beam, { frost: 255 }).frost, 1);
  assert.strictEqual(run(beam, { frost: 0 }).frost, 0);
  const prismRotating = run(beam, { prism: 200, prismRot: 255 }, 10, 0.1);
  assert.ok(prismRotating.prisms[0].angle < 0);
  assert.strictEqual(prismRotating.prisms[0].facets, 8);
  // goboRanges: 128–255 = shake of gobo 1.
  const shake = run(beam, { gobo: 200 }, 3);
  assert.strictEqual(shake.gobos[0].shake, true);
  assert.notStrictEqual(shake.gobos[0].angle, 0);
  // Legacy "rotate: true" on the wheel = the wheel scrolls through the gobos.
  const spin = custom([{ type: 'gobo', ranges: [{ from: 0, to: 127, gobo: 0 }, { from: 128, to: 135, gobo: 1 }, { from: 136, to: 143, gobo: 2 }, { from: 200, to: 255, gobo: 1, rotate: true }] }]);
  const rt = createRuntime();
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(computeState(spin, Uint8Array.of(255), 1, rt, 0.1, i).gobos[0].slot);
  assert.ok(seen.size >= 2);
});

test('budget spot: gobo channel upper half rotates the gobo', () => {
  const p = builtin('gen-mh-spot-11');
  assert.strictEqual(p.channels.length, 11);
  const still = run(p, { gobo: 20 }, 5);
  assert.strictEqual(still.gobos[0].angle, 0);
  const s = run(p, { gobo: 140 }, 5);
  assert.strictEqual(s.gobos[0].slot, 1);
  assert.ok(s.gobos[0].angle > 0);
});

test('prism copies: circular, linear, stacked, capped', () => {
  assert.deepStrictEqual(prismPattern(0), [{ x: 0, y: 0 }]);
  const three = prismCopies([{ facets: 3, shape: 'circular', angle: 0 }], 14);
  assert.strictEqual(three.length, 3);
  const r = three.map((c) => Math.hypot(c.x, c.y));
  close(r[0], r[1]); close(r[1], r[2]);
  const lin = prismCopies([{ facets: 4, shape: 'linear', angle: 0 }], 14);
  assert.ok(lin.every((c) => Math.abs(c.y) < 1e-9));
  assert.ok(lin[0].x < lin[1].x && lin[2].x < lin[3].x);
  const turned = prismCopies([{ facets: 4, shape: 'linear', angle: Math.PI / 2 }], 14);
  assert.ok(turned.every((c) => Math.abs(c.x) < 1e-9));
  const both = prismCopies([{ facets: 3 }, { facets: 4, shape: 'linear' }], 14);
  assert.strictEqual(both.length, 12);
  assert.ok(both[0].w < 1 && both[0].w > 0);
  assert.strictEqual(prismCopies([{ facets: 8 }, { facets: 8 }], 14).length, MAX_COPIES);
});

test('projection layout: open beam is inactive, gobo/prism/frost are active', () => {
  const base = { beamAngle: 14, gobos: [{ slot: 0, angle: 0 }], prisms: [{ facets: 0 }], frost: 0 };
  assert.strictEqual(projectionLayout(base, {}).active, false);
  const g = projectionLayout({ ...base, gobos: [{ slot: 3, angle: 1 }] }, {});
  assert.ok(g.active);
  assert.strictEqual(g.wheels[0].design, designIndex(0, 3));
  assert.ok(g.fieldTan > g.beamTan);
  const p = projectionLayout({ ...base, prisms: [{ facets: 3, angle: 0 }] }, {});
  assert.ok(p.active && p.copies.length === 3);
  assert.ok(p.fieldTan > p.beamTan * 2);
  assert.ok(projectionLayout({ ...base, frost: 0.5 }, {}).active);
  // The key changes with the rotation so the texture is redrawn.
  assert.notStrictEqual(projectionLayout({ ...base, gobos: [{ slot: 3, angle: 1.2 }] }, {}).key, g.key);
  // Wheel 2 uses other designs than wheel 1; custom images come from profile.gobos.
  assert.notStrictEqual(designIndex(0, 1), designIndex(1, 1));
  assert.strictEqual(goboImage({ gobos: [[null, 'a.png']] }, 0, 1), 'a.png');
  assert.strictEqual(goboImage({ gobos: [[null, 'a.png']] }, 1, 1), null);
});
