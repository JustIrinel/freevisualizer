// Pure gobo / prism geometry (no Three.js): which gobo design a wheel slot
// shows and where the prism puts the copies of the beam.
// Offsets are in "tan space": the tangent of the angle from the beam axis,
// x along the head's local X and y along its local Z.

/** Procedural gobo designs drawn by gobos.js, in atlas order. */
export const GOBO_DESIGNS = [
  'dots', 'star', 'flower', 'breakup', 'rings', 'triangles', 'spiral', 'brokenCircle',
  'bars', 'cross', 'petals', 'sun', 'cells', 'waves', 'snowflake', 'squares',
];

export const MAX_COPIES = 24;

const D2R = Math.PI / 180;

/** Design index for a slot of wheel 0 or 1 (slot 0 = open → -1). Wheel 2 starts further on. */
export function designIndex(wheel, slot) {
  if (!slot || slot < 1) return -1;
  return (slot - 1 + (wheel ? 8 : 0)) % GOBO_DESIGNS.length;
}

/** Custom image of a slot from profile.gobos = [[null, 'file.png', …], […]] (indexed like range.gobo). */
export function goboImage(profile, wheel, slot) {
  const list = profile && Array.isArray(profile.gobos) ? profile.gobos[wheel] : null;
  return Array.isArray(list) && slot > 0 && typeof list[slot] === 'string' && list[slot] ? list[slot] : null;
}

/** Copies made by one prism (unit offsets, before scaling by the spread). */
export function prismPattern(facets, shape = 'circular', angle = 0) {
  const n = Math.max(0, Math.floor(facets || 0));
  if (n < 2) return [{ x: 0, y: 0 }];
  const out = [];
  const c = Math.cos(angle); const s = Math.sin(angle);
  for (let i = 0; i < n; i++) {
    let x; let y;
    if (shape === 'linear') { x = i - (n - 1) / 2; y = 0; } else {
      const a = (i / n) * Math.PI * 2;
      x = Math.cos(a); y = Math.sin(a);
    }
    out.push({ x: x * c - y * s, y: x * s + y * c });
  }
  return out;
}

/** Spread of the copies (tan of the deflection) for a given beam angle. */
export function prismSpread(beamAngleDeg, shape = 'circular', facets = 3) {
  const beam = Math.max(1, beamAngleDeg);
  if (shape === 'linear') return Math.tan(Math.max(4, beam * 1.05) * D2R);
  // More facets → the copies sit on a larger ring so they do not merge
  // (a narrow beam fixture still fans out its prism beams).
  const many = facets >= 6;
  return Math.tan(Math.max(many ? 8 : 5, beam * (many ? 1.25 : 1)) * D2R);
}

/**
 * Where every copy of the beam lands: [{ x, y, w }] (tan space, w = share of light).
 * The second prism multiplies the copies of the first one.
 */
export function prismCopies(prisms, beamAngleDeg) {
  let copies = [{ x: 0, y: 0 }];
  for (const p of prisms || []) {
    if (!p || !(p.facets >= 2)) continue;
    // A prism behind another one deflects a little less (it is further from the lens).
    const spread = prismSpread(beamAngleDeg, p.shape, p.facets) * (copies.length > 1 ? 0.55 : 1);
    const pattern = prismPattern(p.facets, p.shape, p.angle || 0);
    const next = [];
    for (const a of copies) for (const b of pattern) next.push({ x: a.x + b.x * spread, y: a.y + b.y * spread });
    copies = next;
  }
  if (copies.length > MAX_COPIES) {
    const step = copies.length / MAX_COPIES;
    copies = Array.from({ length: MAX_COPIES }, (_, i) => copies[Math.floor(i * step)]);
  }
  // Each copy carries about 1/n of the light (a bit more, so 8–12 copies stay visible).
  const w = copies.length > 1 ? Math.min(1, 2 / Math.pow(copies.length, 0.9)) : 1;
  return copies.map((c) => ({ ...c, w }));
}

/**
 * Everything needed to draw the projection of a fixture:
 * { active, beamTan, fieldTan, copies, wheels: [{ design, image, angle }], frost, key }.
 * `active` is false for an open beam without prism or frost (plain spot).
 */
export function projectionLayout(state, profile, beamAngleDeg = state.beamAngle) {
  const frost = Math.max(0, Math.min(1, state.frost || 0));
  const beamTan = Math.tan(Math.max(0.5, Math.min(160, beamAngleDeg * (1 + frost * 0.35))) / 2 * D2R);
  const wheels = (state.gobos || []).map((g, w) => ({
    slot: g.slot || 0,
    design: designIndex(w, g.slot),
    image: goboImage(profile, w, g.slot),
    angle: g.angle || 0,
  })).filter((g) => g.slot > 0);
  const copies = prismCopies(state.prisms, beamAngleDeg);
  let reach = 0;
  for (const c of copies) reach = Math.max(reach, Math.hypot(c.x, c.y));
  const fieldTan = (reach + beamTan) * 1.06;
  const active = wheels.length > 0 || copies.length > 1 || frost > 0.02;
  const r = (v, k = 1000) => Math.round(v * k);
  const key = active ? [
    r(beamTan, 10000), r(frost, 100), copies.length,
    ...wheels.map((g) => `${g.design}:${g.image || ''}:${r(g.angle)}`),
    ...copies.slice(0, 2).map((c) => `${r(c.x, 10000)},${r(c.y, 10000)}`),
  ].join('|') : '';
  return { active, beamTan, fieldTan, copies, wheels, frost, key };
}
