// Pure layout math for stage props (no Three.js, testable in Node):
// where the guests of a crowd stand, and where fixtures mount on tripods and cases.

/** Small seeded RNG (LCG) so a crowd looks the same every time it is rebuilt. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Per density preset (1 = few, 2 = normal, 3 = packed): centre-to-centre distance between
// guests and people per m². The crowd fills only the part of the area it needs, in the middle.
export const CROWD_SPACING = { 1: 1.05, 2: 0.72, 3: 0.52 };
export const CROWD_DENSITY = { 1: 0.45, 2: 1.0, 3: 2.2 };
// Never closer than this (shoulders are ~0.34 m wide), even when the count does not fit.
export const CROWD_MIN_SPACING = 0.44;
export const PERSON_HEIGHT = 1.72; // height of the person model at scale 1

/**
 * Guests on a width × depth area (centred on 0,0): no overlaps, Poisson-like rejection
 * sampling with the seeded RNG. The density preset sets how much of the area they use
 * (packed = a tight group in the middle). When `count` does not fit, the spacing is
 * relaxed down to CROWD_MIN_SPACING and the group grows to the whole area; beyond that
 * the crowd is capped.
 * Returns [{ x, z, heading, height, girth, dress }] (heading in radians, height in metres).
 */
export function crowdLayout(params, seed = 7) {
  let width = Math.max(0.5, Number(params.width) || 0);
  let depth = Math.max(0.5, Number(params.depth) || 0);
  const count = clamp(Math.round(Number(params.count) || 0), 1, 600);
  const size = clamp(Number(params.size) || 1, 0.8, 1.1);
  const level = Math.round(clamp(Number(params.density) || 2, 1, 3));
  const preset = CROWD_SPACING[level];
  // Occupied part of the area: count / (people per m²), same proportions, never bigger than the area.
  const k = Math.min(1, Math.sqrt(count / (CROWD_DENSITY[level] / (size * size)) / (width * depth)));
  const fullW = width; const fullD = depth;
  width = Math.max(Math.min(fullW, 1.2), fullW * k);
  depth = Math.max(Math.min(fullD, 1.2), fullD * k);
  const rnd = seeded(seed);
  const minGap = CROWD_MIN_SPACING * size;
  let gap = Math.max(minGap, preset * size);
  const pts = [];
  // Uniform grid with cell = gap: neighbours are always in the 3×3 block around a cell.
  let cells = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const cellOf = (x, z) => [Math.floor((x + width / 2) / gap), Math.floor((z + depth / 2) / gap)];
  const index = (pt) => {
    const [cx, cz] = cellOf(pt.x, pt.z);
    const k = key(cx, cz);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(pt);
  };
  const free = (x, z) => {
    const [cx, cz] = cellOf(x, z);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const q of cells.get(key(cx + i, cz + j)) || []) {
          if ((q.x - x) ** 2 + (q.z - z) ** 2 < gap * gap) return false;
        }
      }
    }
    return true;
  };
  // Keep guests a little inside the area so nobody stands half off the dance floor.
  const mx = Math.min(width / 2 - 0.01, 0.2 * size);
  const mz = Math.min(depth / 2 - 0.01, 0.2 * size);
  while (pts.length < count) {
    let placed = false;
    for (let tries = 0; tries < 60 && !placed; tries++) {
      const x = (rnd() - 0.5) * (width - 2 * mx);
      const z = (rnd() - 0.5) * (depth - 2 * mz);
      if (!free(x, z)) continue;
      const pt = { x, z };
      pts.push(pt);
      index(pt);
      placed = true;
    }
    if (placed) continue;
    if (gap <= minGap + 1e-9) {
      if (width >= fullW && depth >= fullD) break; // full: cap the crowd
      // Use more of the area before giving up.
      width = Math.min(fullW, width * 1.15); depth = Math.min(fullD, depth * 1.15);
      gap = Math.max(minGap, preset * size);
    } else gap = Math.max(minGap, gap * 0.92);
    cells = new Map();
    pts.forEach(index);
  }
  return pts.map((pt) => {
    // Heights 1.55–1.85 m, most of them around 1.70 (sum of two uniforms).
    const height = (1.55 + 0.3 * ((rnd() + rnd()) / 2)) * size;
    // Most guests face the DJ (towards −z), the others dance in their own direction.
    const heading = rnd() < 0.65 ? Math.PI + (rnd() - 0.5) * 1.6 : rnd() * Math.PI * 2;
    return { x: pt.x, z: pt.z, heading, height, girth: 0.9 + rnd() * 0.22, dress: rnd() < 0.42, armsUp: rnd() < 0.1, phase: rnd() * Math.PI * 2 };
  });
}

// ------------------------------------------------------------------ tripod stands
export const TRIPOD_BAR_R = 0.019; // T-bar tube radius (Ø38 mm)

/** Stand params clamped to sensible ranges. */
export function tripodParams(p = {}) {
  return {
    height: clamp(Number(p.height) || 2.5, 1, 4),
    bar: clamp(Number(p.bar ?? 1.2) || 0, 0, 3),
    legs: clamp(Number(p.legs) || 1.2, 0.5, 2.5),
  };
}

const r2 = (v) => Math.round(v * 100) / 100;

/** Local offset along the stand's T-bar (x) → world point for a prop with rotation y (degrees). */
function local(prop, lx, y) {
  const a = ((prop.rotation && prop.rotation.y) || 0) * Math.PI / 180;
  const p = prop.position || { x: 0, y: 0, z: 0 };
  return { x: r2(p.x + lx * Math.cos(a)), y: r2((p.y || 0) + y), z: r2(p.z - lx * Math.sin(a)) };
}

/**
 * Where a fixture mounts on a tripod: standing on top of the T-bar (light up), or
 * hanging under it (x = 180) when `hang`. `offset` = metres along the bar from its centre.
 * A stand without a T-bar takes the fixture on its top plate.
 */
export function tripodMount(prop, offset = 0, hang = false) {
  const { height, bar } = tripodParams(prop.params);
  const ry = (prop.rotation && prop.rotation.y) || 0;
  if (bar <= 0) return { position: local(prop, 0, height), rotation: { x: 0, y: ry, z: 0 } };
  const half = Math.max(0, bar / 2 - 0.06);
  const lx = clamp(offset, -half, half);
  return hang
    ? { position: local(prop, lx, height - 2 * TRIPOD_BAR_R), rotation: { x: 180, y: ry, z: 0 } }
    : { position: local(prop, lx, height), rotation: { x: 0, y: ry, z: 0 } };
}

/** n evenly spaced offsets along a bar (centre when there is no bar or a single fixture). */
export function barSlots(bar, n) {
  if (n <= 1 || bar <= 0) return Array.from({ length: n }, () => 0);
  const half = Math.max(0, bar / 2 - Math.min(0.2, bar / (2 * n)));
  return Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));
}

// ------------------------------------------------------------------ road cases
export const CASE_DEFAULTS = { width: 1.2, height: 0.75, depth: 0.6, wheels: 1 };

/** Lid height of a case (its top surface, in world y). */
export function caseTop(prop) {
  const h = Number(prop.params && prop.params.height) || CASE_DEFAULTS.height;
  return r2(((prop.position && prop.position.y) || 0) + h);
}

/** A fixture on the lid of a case, `offset` metres along its width from the centre. */
export function caseMount(prop, offset = 0) {
  const w = Number(prop.params && prop.params.width) || CASE_DEFAULTS.width;
  const half = Math.max(0, w / 2 - 0.15);
  const pt = local(prop, clamp(offset, -half, half), 0);
  return { position: { ...pt, y: caseTop(prop) }, rotation: { x: 0, y: (prop.rotation && prop.rotation.y) || 0, z: 0 } };
}

/**
 * Spread n fixtures over several stands/cases: consecutive chunks, left to right.
 * Returns [{ target, offset }] (offset along the bar / lid).
 */
export function spreadOver(targets, n, lengthOf) {
  if (!targets.length) return [];
  const sorted = [...targets].sort((a, b) => a.position.x - b.position.x);
  const k = Math.min(sorted.length, n);
  const out = [];
  let i = 0;
  for (let t = 0; t < k; t++) {
    const m = Math.floor(n / k) + (t < n % k ? 1 : 0);
    const slots = barSlots(lengthOf(sorted[t]), m);
    for (let j = 0; j < m; j++, i++) out.push({ target: sorted[t], offset: slots[j] });
  }
  return out;
}

// ------------------------------------------------------------------ light totems
// Square truss column on a base plate with a top plate for fixtures, optional lycra cover.
export const TOTEM_DEFAULTS = { height: 2, plate: 0.5, cover: 1 };

export function totemParams(p = {}) {
  return {
    height: clamp(Number(p.height) || TOTEM_DEFAULTS.height, 1, 3.5),
    plate: clamp(Number(p.plate) || TOTEM_DEFAULTS.plate, 0.3, 0.8),
    cover: clamp(Math.round(Number(p.cover ?? TOTEM_DEFAULTS.cover)), 0, 2),
  };
}

/** Height of the top plate's surface (world y). */
export function totemTop(prop) {
  return r2(((prop.position && prop.position.y) || 0) + totemParams(prop.params).height);
}

/** A fixture standing on the top plate, `offset` metres across it (x) from the centre. */
export function totemMount(prop, offset = 0) {
  const half = Math.max(0, totemParams(prop.params).plate / 2 - 0.12);
  const pt = local(prop, clamp(offset, -half, half), 0);
  return { position: { ...pt, y: totemTop(prop) }, rotation: { x: 0, y: (prop.rotation && prop.rotation.y) || 0, z: 0 } };
}

// ------------------------------------------------------------------ speaker stands
// Pole stand (Ø35 mm top hat) with the speaker sitting on it; `height` = speaker bottom.
export const SPEAKER_SIZES = {
  10: { width: 0.3, height: 0.5, depth: 0.28 },
  12: { width: 0.36, height: 0.6, depth: 0.34 },
  15: { width: 0.44, height: 0.72, depth: 0.4 },
};

export function speakerStandParams(p = {}) {
  const size = SPEAKER_SIZES[Number(p.size)] ? Number(p.size) : 12;
  return {
    height: clamp(Number(p.height) || 1.8, 1, 2.4),
    speaker: Number(p.speaker ?? 1) > 0 ? 1 : 0,
    size,
    box: SPEAKER_SIZES[size],
  };
}

/** Top of the pole (where the speaker sits), world y. */
export function speakerStandTop(prop) {
  return r2(((prop.position && prop.position.y) || 0) + speakerStandParams(prop.params).height);
}
