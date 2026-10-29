// Pure math for dragging objects with the mouse (no Three.js, tested in test/drag-math.test.mjs).
// Vectors are plain { x, y, z }; `right` / `toward` are unit vectors on the floor as seen
// from the camera (right on screen, towards the viewer).

const round = (v, step) => Math.round(v / step) * step;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The camera's on-screen right and towards-me directions for a camera heading (radians, see Visualizer.cameraYaw). */
export function viewAxes(yaw) {
  return {
    right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
    toward: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
  };
}

/** Shift-drag: which direction the move started in ('right' or 'toward'), null while still too small. */
export function chooseLockAxis(raw, axes, min = 0.05) {
  const a = raw.x * axes.right.x + raw.z * axes.right.z;
  const b = raw.x * axes.toward.x + raw.z * axes.toward.z;
  if (Math.max(Math.abs(a), Math.abs(b)) < min) return null;
  return Math.abs(a) >= Math.abs(b) ? 'right' : 'toward';
}

/**
 * Move to apply for a raw drag displacement on the floor plane.
 *  - vertical: only the height changes (Alt-drag), `raw.y` is used;
 *  - lock = 'right' | 'toward': only along that screen direction (Shift-drag);
 *  - snap (metres, 0 = off): steps along the locked direction, or on x / z for a free move.
 */
export function dragDelta(raw, { axes, lock = null, vertical = false, snap = 0 } = {}) {
  if (vertical) return { x: 0, y: r3(snap ? round(raw.y, snap) : raw.y), z: 0 };
  if (lock && axes) {
    const dir = axes[lock];
    let d = raw.x * dir.x + raw.z * dir.z;
    if (snap) d = round(d, snap);
    return { x: r3(dir.x * d), y: 0, z: r3(dir.z * d) };
  }
  return { x: r3(snap ? round(raw.x, snap) : raw.x), y: 0, z: r3(snap ? round(raw.z, snap) : raw.z) };
}

/** Alt + mouse wheel → degrees to turn, with the leftover wheel distance (trackpads send many small steps). */
export function wheelTurn(acc, delta, fine = false, notch = 100) {
  const total = acc + delta;
  const steps = Math.trunc(total / notch);
  return { deg: steps * (fine ? 5 : 15), acc: total - steps * notch };
}
