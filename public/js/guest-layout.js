// Pure logic for the animated guests (no Three.js, testable in Node): what each guest
// wears, which animation clip they play and where in the loop they are on the beat.
import { seeded } from './prop-layout.js';

// Clothing regions painted on the baked mannequins (tools/bake-guests.mjs). Each guest has
// one colour per region; a negative roughness hides that part (alternative hair, skirt length).
export const GUEST_REGIONS = { skin: 0, top: 1, bottom: 2, shoes: 3, shirt: 4, hair: 5, tie: 6, arms: 7, hairLong: 8, bun: 9, skirtShort: 10, hem: 11 };
export const REGION_COUNT = 12;
export const HIDDEN = -1;

const SUITS = [0x15161a, 0x15161a, 0x1d2233, 0x26282e, 0x2f3238, 0x1b2438, 0x3a3d44, 0x4a4239, 0x8a8d93];
const SHIRTS = [0xf4f3ef, 0xf4f3ef, 0xf4f3ef, 0xdfe7f1, 0xe9e2d6, 0x1a1b20];
const TIES = [0x5a1622, 0x1c2a4a, 0x111114, 0x8d8f96, 0x6b1a2b, 0x2f4a3a, 0xb9a06a];
const DRESSES = [0x6b1a2b, 0x1b2a4e, 0x121214, 0x121214, 0x1f4d3d, 0xd9c7a3, 0xc98f9a, 0x9e1b26, 0x2a4fa0, 0x6a5687, 0x8f9298, 0xb8913f, 0x1d5c63, 0xd8918a, 0x44233f, 0x7a1f3d, 0x283d2c];
const SKINS = [0xf0cfb4, 0xe8bf9f, 0xdcae8b, 0xc99574, 0xa8714f, 0xf3d6c1, 0xe2b896, 0x8d5a3c];
const HAIRS = [0x1b1410, 0x2a1d14, 0x3b2a1c, 0x5a3e26, 0x7a5a36, 0xb08a58, 0xd6b98a, 0x8c8780, 0x15110e];
const BRIDE = 0xf6f3ec;

/** Dancing clips: picks with weights, per body. */
export const DANCE_CLIPS = {
  male: [['dance', 0.4], ['dancePump', 0.25], ['danceUp', 0.2], ['sway', 0.15]],
  female: [['dance', 0.35], ['sway', 0.35], ['danceUp', 0.2], ['dancePump', 0.1]],
};
export const REST_CLIPS = [['talk', 0.45], ['idle', 0.2], ['fold', 0.2], ['phone', 0.15]];
/** Share of the guests that dance while the show runs, per crowd activity (param 1 / 2 / 3). */
export const ACTIVITY_DANCERS = { dance: 0.85, mix: 0.5, stand: 0 };
export const ACTIVITIES = { 1: 'dance', 2: 'mix', 3: 'stand' };
// Bigger crowds keep the simple silhouettes (a few hundred animated guests is a lot of triangles).
export const MAX_ANIMATED_GUESTS = 300;

function pick(list, rnd) {
  let r = rnd() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) { r -= w; if (r <= 0) return v; }
  return list[list.length - 1][0];
}
const any = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

/** Region colour table [hex, roughness] for one guest. */
export function outfit(body, rnd, role = null) {
  const R = GUEST_REGIONS;
  const p = new Array(REGION_COUNT).fill(null).map(() => [0x808080, HIDDEN]);
  const skin = any(SKINS, rnd);
  const hair = rnd() < 0.08 && body === 'male' ? any([0x8c8780, 0xb7b3ab], rnd) : any(HAIRS, rnd);
  p[R.skin] = [skin, 0.62];
  p[R.hair] = [hair, 0.55];
  p[R.shoes] = [0x0b0b0d, 0.32];
  if (body === 'male') {
    const suit = role === 'groom' ? 0x101114 : any(SUITS, rnd);
    const shirt = role === 'groom' ? 0xf7f6f2 : any(SHIRTS, rnd);
    const jacket = role === 'groom' || rnd() > 0.1; // some took the jacket off
    const tie = role === 'groom' ? 0x0c0c0e : (shirt === 0x1a1b20 ? 0x8d8f96 : any(TIES, rnd));
    p[R.top] = [jacket ? suit : shirt, jacket ? 0.72 : 0.85];
    p[R.arms] = [jacket ? suit : shirt, jacket ? 0.72 : 0.85];
    p[R.hem] = [suit, jacket ? 0.72 : HIDDEN]; // jacket skirt over the hips; shirts are tucked in
    p[R.bottom] = [suit, 0.74];
    p[R.shirt] = [shirt, 0.85];
    p[R.tie] = rnd() < 0.12 && role !== 'groom' ? [shirt, 0.85] : [tie, 0.5];
  } else {
    const dress = role === 'bride' ? BRIDE : any(DRESSES, rnd);
    const satin = role === 'bride' ? 0.5 : 0.35 + rnd() * 0.4;
    const long = role === 'bride' || rnd() < 0.55;
    const sleeves = role !== 'bride' && rnd() < 0.3;
    p[R.top] = [dress, satin];
    p[R.bottom] = [dress, satin];
    p[R.arms] = sleeves ? [dress, satin] : [skin, 0.62];
    p[R.skirtShort] = long ? [dress, HIDDEN] : [dress, satin];
    if (long) p[R.bottom] = [dress, satin];
    else p[R.bottom] = [dress, HIDDEN];
    p[R.shoes] = [role === 'bride' ? 0xe9e4da : any([0x0b0b0d, 0x0b0b0d, 0xb8913f, 0x6b1a2b, 0xd9c7a3], rnd), 0.3];
    const style = role === 'bride' ? 'bun' : pick([['bun', 0.4], ['long', 0.45], ['short', 0.15]], rnd);
    p[R.bun] = [hair, style === 'bun' ? 0.55 : HIDDEN];
    p[R.hairLong] = [hair, style === 'long' ? 0.55 : HIDDEN];
    // Pelvis under a short dress, shirt / tie regions are not on the female body.
    p[R.shirt] = [dress, satin];
    p[R.tie] = [dress, satin];
  }
  return p;
}

/**
 * Dress a crowd laid out by crowdLayout(): body, outfit, clips and loop offsets.
 * `couple`: the two guests nearest the middle become the bride and the groom (slow dance, facing).
 */
export function dressCrowd(people, { seed = 7, activity = 'dance', couple = false } = {}) {
  const rnd = seeded(seed * 97 + 13);
  const dancers = ACTIVITY_DANCERS[ACTIVITIES[activity] || activity] ?? ACTIVITY_DANCERS.dance;
  const roles = new Array(people.length).fill(null);
  if (couple && people.length >= 2) {
    const order = people.map((g, i) => [g.x * g.x + g.z * g.z, i]).sort((a, b) => a[0] - b[0]);
    roles[order[0][1]] = 'bride';
    roles[order[1][1]] = 'groom';
  }
  return people.map((g, i) => {
    const role = roles[i];
    const body = role === 'bride' ? 'female' : role === 'groom' ? 'male' : (g.dress ? 'female' : 'male');
    const dances = role ? true : rnd() < dancers;
    const clip = role ? 'sway' : (dances ? pick(DANCE_CLIPS[body], rnd) : pick(REST_CLIPS, rnd));
    const rest = role ? 'talk' : (dances ? pick(REST_CLIPS, rnd) : clip);
    return {
      body,
      role,
      clip,
      rest,
      // Whole beats for beat-locked clips (dancers bounce together, some sway the other way);
      // a random fraction for talking / idle loops.
      beatOffset: Math.floor(rnd() * 4),
      phase: rnd(),
      palette: outfit(body, rnd, role),
      height: role === 'bride' ? 1.66 : g.height * (body === 'female' ? 0.97 : 1.01),
      turn: (rnd() - 0.5) * 2, // slow turning while dancing (rad amplitude factor)
    };
  });
}

/**
 * Loop position (0..1) of a clip. Beat-locked clips (`beats` > 0) put the beat on `hit`
 * at every whole beat; free clips run on seconds.
 */
export function loopPosition(clip, { beat = 0, time = 0, beatOffset = 0, phase = 0 } = {}) {
  const u = clip.beats > 0 ? clip.hit + (beat + beatOffset) / clip.beats : phase + time / clip.seconds;
  return u - Math.floor(u);
}

/** Offset (instance attribute z) so the shader's fract(z + beat / beats) equals loopPosition(). */
export function loopOffset(clip, beatOffset = 0, phase = 0) {
  const u = clip.beats > 0 ? clip.hit + beatOffset / clip.beats : phase;
  return u - Math.floor(u);
}

/** Show running? Hysteresis on the show level so guests do not flip on every blackout beat. */
export function showState(prev, level, dt) {
  const s = prev || { on: false, t: 0 };
  const want = level > 0.04;
  if (want === s.on) return { on: s.on, t: 0 };
  const t = s.t + dt;
  return t > (want ? 0.6 : 4) ? { on: want, t: 0 } : { on: s.on, t };
}

// ------------------------------------------------------------------ seated guests
// Chairs around a round table (props3d.js draws them with the same numbers).
export const CHAIR_SPACING = 0.6; // m of table edge per chair
export const CHAIR_OFFSET = 0.38; // seat centre beyond the table edge
// In the sitting clips the pelvis is this far behind the guest's origin (feet under the knees).
export const SIT_BACK = 0.31;

export function chairCount(diameter) {
  return Math.max(4, Math.round((Math.PI * diameter) / CHAIR_SPACING));
}

/**
 * Guests sitting at a round table: `guests` of the chairs, spread round the table
 * (seeded, so the same chairs every rebuild). Returns [{ x, z, heading, chair }]:
 * the guest faces the table centre, pelvis over the seat.
 */
export function seatLayout(diameter, guests, seed = 1) {
  const chairs = chairCount(diameter);
  const n = Math.max(0, Math.min(chairs, Math.round(Number(guests) || 0)));
  const rnd = seeded(seed * 131 + 7);
  const order = [...Array(chairs).keys()];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const rr = diameter / 2 + CHAIR_OFFSET;
  return order.slice(0, n).sort((a, b) => a - b).map((i) => {
    const a = (i / chairs) * Math.PI * 2;
    const c = Math.cos(a); const s = Math.sin(a);
    return { x: c * (rr - SIT_BACK), z: s * (rr - SIT_BACK), heading: Math.atan2(-c, -s), chair: i };
  });
}

/** Outfits and clips for seated guests (sitting / talking at the table, short skirts). */
export function dressSeated(seats, seed = 1) {
  const rnd = seeded(seed * 53 + 3);
  return seats.map(() => {
    const body = rnd() < 0.5 ? 'female' : 'male';
    const palette = outfit(body, rnd);
    if (body === 'female') {
      // A long skirt would go through the chair: the seated pose shows the short one.
      const dress = palette[GUEST_REGIONS.top];
      palette[GUEST_REGIONS.bottom] = [dress[0], HIDDEN];
      palette[GUEST_REGIONS.skirtShort] = [dress[0], dress[1]];
    }
    const clip = rnd() < 0.6 ? 'sitTalk' : 'sit';
    return { body, role: null, clip, rest: clip, beatOffset: 0, phase: rnd(), palette, height: (body === 'female' ? 1.62 : 1.72) + rnd() * 0.14, turn: 0 };
  });
}

/** Seed from a prop id (stable across rebuilds). */
export function idSeed(id = '') {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 100000;
}
