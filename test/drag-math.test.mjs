import test from 'node:test';
import assert from 'node:assert/strict';
import { viewAxes, chooseLockAxis, dragDelta, wheelTurn } from '../public/js/drag-math.js';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('view axes: right on screen and towards the viewer for any camera heading', () => {
  // Looking towards −z (default front view): right = +x, towards me = +z.
  let { right, toward } = viewAxes(0);
  near(right.x, 1); near(right.z, 0); near(toward.x, 0); near(toward.z, 1);
  // Camera turned 45°: right is diagonal, still perpendicular to towards-me.
  ({ right, toward } = viewAxes(Math.PI / 4));
  near(right.x * toward.x + right.z * toward.z, 0);
  near(Math.hypot(right.x, right.z), 1);
});

test('drag: a free move follows the mouse on the floor, with 5 cm snap', () => {
  const d = dragDelta({ x: 0.53, y: 0, z: -0.12 }, { axes: viewAxes(0), snap: 0.05 });
  assert.deepEqual(d, { x: 0.55, y: 0, z: -0.1 });
});

test('drag: Shift locks the move to the screen direction it started in (no sliding back)', () => {
  const axes = viewAxes(Math.PI / 4); // camera at 45°: world X looks diagonal on screen
  // Mouse moved mostly to the right on screen, with a little wobble towards the camera.
  const raw = { x: axes.right.x * 1 + axes.toward.x * 0.15, y: 0, z: axes.right.z * 1 + axes.toward.z * 0.15 };
  const lock = chooseLockAxis(raw, axes);
  assert.equal(lock, 'right');
  const d = dragDelta(raw, { axes, lock, snap: 0.05 });
  // Only along "right": nothing towards / away from the viewer.
  near(d.x * axes.toward.x + d.z * axes.toward.z, 0);
  near(d.x * axes.right.x + d.z * axes.right.z, 1);
  assert.equal(chooseLockAxis({ x: 0.01, y: 0, z: 0.01 }, axes), null);
});

test('drag: Alt moves only up / down', () => {
  assert.deepEqual(dragDelta({ x: 3, y: 0.42, z: 2 }, { vertical: true, snap: 0.05 }), { x: 0, y: 0.4, z: 0 });
});

test('Alt + wheel: one notch = 15°, Shift = 5°, small trackpad steps add up', () => {
  assert.deepEqual(wheelTurn(0, 100), { deg: 15, acc: 0 });
  assert.deepEqual(wheelTurn(0, -100, true), { deg: -5, acc: 0 });
  let acc = 0; let deg = 0;
  for (let i = 0; i < 10; i++) { const r = wheelTurn(acc, 12); acc = r.acc; deg += r.deg; }
  assert.equal(deg, 15);
  near(acc, 20);
});
