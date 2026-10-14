// Orientation helpers. Fixtures emit along local +Y and use Euler order YXZ.

/**
 * Rotation (degrees) that points a fixture's +Y axis from `from` towards `to`:
 * y = heading around the vertical axis, x = tilt away from straight up, z = 0.
 */
export function aimRotation(from, to) {
  const dx = to.x - from.x; const dy = to.y - from.y; const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const tilt = Math.acos(Math.max(-1, Math.min(1, dy / len)));
  const heading = Math.hypot(dx, dz) < 1e-6 ? 0 : Math.atan2(dx, dz);
  const deg = (r) => Math.round((r * 180) / Math.PI * 10) / 10;
  return { x: deg(tilt), y: deg(heading), z: 0 };
}

/** Direction (unit vector) of +Y after a YXZ rotation given in degrees. */
export function beamDirection(rot) {
  const t = (rot.x * Math.PI) / 180; const h = (rot.y * Math.PI) / 180; const r = (rot.z * Math.PI) / 180;
  // Rz first, then Rx, then Ry (YXZ intrinsic = Ry * Rx * Rz applied to the vector).
  let x = -Math.sin(r); let y = Math.cos(r); let z = 0;
  [y, z] = [y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
  [x, z] = [x * Math.cos(h) + z * Math.sin(h), -x * Math.sin(h) + z * Math.cos(h)];
  return { x, y, z };
}
