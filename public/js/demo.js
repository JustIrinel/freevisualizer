// Built-in demo show: writes DMX for every patched fixture so the rig can be
// checked without SoundSwitch. It speaks each profile's own channel layout.

import { hexToRgb } from './fixture-state.js';

export const DEFAULT_BPM = 126;

function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6); const f = h * 6 - i;
  const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

function openValue(channel) {
  const r = (channel.ranges || []).find((x) => x.mode === 'open');
  return r ? r.from : 0;
}

function strobeValue(channel, amount) {
  const r = (channel.ranges || []).find((x) => x.mode === 'strobe');
  if (!r) return 255;
  return Math.round(r.from + (r.to - r.from) * amount);
}

function nearestWheel(channel, rgb) {
  let best = null; let bestD = Infinity;
  for (const r of channel.ranges || []) {
    if (!r.color || r.split) continue;
    const c = hexToRgb(r.color);
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? Math.round((best.from + best.to) / 2) : 0;
}

function goboValue(channel, idx, spin = false) {
  // A wheel whose ranges also rotate the gobo (no separate rotation channel).
  const spinning = spin ? (channel.ranges || []).filter((r) => r.gobo > 0 && typeof r.rotate === 'number') : [];
  if (spinning.length) return at(spinning[idx % spinning.length], 0.35);
  const list = (channel.ranges || []).filter((r) => r.gobo != null && !r.shake && !r.rotate);
  if (!list.length) return 0;
  const r = list[idx % list.length];
  return Math.round((r.from + r.to) / 2);
}

const at = (r, k) => Math.round(r.from + (r.to - r.from) * Math.max(0, Math.min(1, k)));

/** Rotation channel: dir ±1 at speed k (0 slow … 1 fast); 0 = stopped (index 0 / stop range). */
function rotationValue(channel, dir, k = 0.3) {
  const ranges = channel.ranges || [];
  if (!ranges.length) return dir ? Math.round(8 + 247 * k) : 0;
  if (!dir) {
    const r = ranges.find((x) => x.index) || ranges.find((x) => x.stop);
    return r ? r.from : 0;
  }
  const r = ranges.find((x) => Math.sign(x.rotate) === dir) || ranges.find((x) => typeof x.rotate === 'number');
  if (!r) return 0;
  return at(r, r.fastToSlow ? 1 - k : k);
}

/** Prism channel: the range closest to `facets` (0 = prism out). */
function prismValue(channel, facets) {
  const ranges = channel.ranges || [];
  if (!ranges.length) return facets ? 255 : 0;
  if (!facets) { const off = ranges.find((r) => !r.prism); return off ? off.from : 0; }
  const list = ranges.filter((r) => r.prism > 0 && !r.rotate);
  if (!list.length) return 0;
  list.sort((a, b) => Math.abs(a.prism - facets) - Math.abs(b.prism - facets));
  return at(list[0], 0.5);
}

/** Retro heads: slow warm waves, a chase on the beat, full glow on the drop. */
function retroLevel(scene, pixel, beat, time, bar) {
  if (scene === 3) return (bar % 4) === 3 ? 1 : (Math.floor(beat * 2) % 7 === pixel ? 1 : 0.08);
  if (scene === 2) return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 1.2 - pixel * 0.9));
  if (scene === 1) return pixel === 3 ? 1 : 0.15 + 0.5 * Math.max(0, Math.sin(time * 2 - pixel));
  return Math.floor(beat) % 7 === pixel ? 1 : 0.25;
}

/**
 * @param fixtures [{ fixture, profile, index }]
 * @param store    DmxStore
 * @param time     seconds
 */
export function renderDemo(fixtures, store, time, bpm = DEFAULT_BPM) {
  const beat = (time * bpm) / 60;
  const bar = Math.floor(beat / 4);
  const scene = Math.floor(bar / 4) % 4; // change look every 4 bars
  const beatFrac = beat % 1;
  const pulse = Math.pow(1 - beatFrac, 2);
  for (const buf of store.demo.values()) buf.fill(0);

  const movers = fixtures.filter((f) => f.profile.kind === 'moving');
  const total = Math.max(1, fixtures.length);

  for (const { fixture, profile, index } of fixtures) {
    const buf = store.demoBuffer(fixture.universe);
    const base = fixture.address - 1;
    const n = total;
    const k = index / n;
    let rgb; let dim; let strobe = 0; let panT; let tiltT; let gobo = 0;
    // Beam shaping: gobo rotation (dir, speed), second wheel, prisms, frost.
    let goboSpin = 0; let goboSpeed = 0.3; let gobo2 = 0; let prism = 0; let prismSpin = 0; let prismSpeed = 0.3; let prism2 = 0; let frost = 0;
    const moverIdx = movers.findIndex((m) => m.fixture === fixture);
    const side = moverIdx % 2 === 0 ? 1 : -1;

    switch (scene) {
      case 0: // rainbow chase
        rgb = hsv(k * 0.6 + time * 0.08, 1, 1);
        dim = 0.35 + 0.65 * Math.max(pulse, ((beat + index) % 4 < 1) ? 1 : 0);
        panT = 0.5 + 0.18 * Math.sin(time * 0.9 + moverIdx * 0.7);
        tiltT = 0.62 + 0.12 * Math.sin(time * 1.8 + moverIdx * 0.7);
        gobo = 0;
        break;
      case 1: // blue/magenta fan with gobos
        rgb = index % 2 ? [0.1, 0.2, 1] : [1, 0, 0.8];
        dim = 0.6 + 0.4 * pulse;
        panT = 0.5 + side * (0.08 + 0.06 * Math.sin(time * 0.6));
        tiltT = 0.58 + 0.15 * Math.sin(time * 0.5 + side);
        gobo = 2 + (bar % 3);
        goboSpin = side; goboSpeed = 0.35;
        gobo2 = bar % 2 ? 0 : 1 + (bar % 3);
        // Every other bar the prism goes in and turns slowly.
        if (bar % 2) { prism = 3; prismSpin = -side; prismSpeed = 0.2; }
        break;
      case 2: // warm ballad
        rgb = [1, 0.55 + 0.1 * Math.sin(time + index), 0.15];
        dim = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(time * 0.7 + index * 0.9));
        panT = 0.5 + 0.1 * Math.sin(time * 0.3 + moverIdx);
        tiltT = 0.66 + 0.04 * Math.cos(time * 0.4 + moverIdx);
        gobo = 1;
        goboSpin = 1; goboSpeed = 0.08;
        frost = profile.style === 'spot' ? 0.35 : 0;
        if ((bar % 8) >= 6) { prism2 = 4; prismSpin = 1; prismSpeed = 0.1; }
        break;
      default: { // drop: white strobes + fast chase
        const drop = (bar % 4) === 3;
        // On the drop movers and strobes go white; uplights keep the room colored.
        rgb = drop && profile.kind !== 'par' ? [1, 1, 1] : hsv(0.55 + 0.1 * Math.sin(time), 0.9, 1);
        const chase = Math.floor(beat * 2) % n === index;
        dim = drop ? 1 : chase ? 1 : 0.15 + 0.5 * pulse;
        strobe = drop ? 0.85 : 0;
        panT = 0.5 + 0.22 * Math.sin(time * 2.2 + moverIdx * 1.3);
        tiltT = 0.6 + 0.1 * Math.cos(time * 2.2 + moverIdx * 1.3);
        gobo = 0;
        // Between the drops the beams fan out through a fast-turning prism.
        if (!drop && profile.style === 'beam') { prism = 8; prismSpin = side; prismSpeed = 0.75; }
      }
    }

    const fog = (bar % 16 === 0) && beat % 4 < 3 ? 1 : 0;
    // Cold sparks on the drop, and at the end of the slow "first dance" scene.
    const sparks = (scene === 3 && (bar % 4) === 3) || (scene === 2 && (bar % 4) === 3 && beat % 4 >= 2);

    profile.channels.forEach((c, i) => {
      const addr = base + i;
      if (addr >= 512) return;
      let v = 0;
      let px = null;
      if (c.pixel != null && profile.pixels > 1) {
        const pk = c.pixel / Math.max(1, profile.pixels - 1);
        if (scene === 0) px = hsv(k * 0.6 + pk * 0.5 + time * 0.15, 1, 1);
        else if (scene === 3) px = Math.floor(beat * 4) % profile.pixels === c.pixel ? [1, 1, 1] : rgb.map((x) => x * 0.25);
        else px = rgb.map((x) => x * (0.5 + 0.5 * Math.sin(time * 3 - pk * 6)));
      }
      const col = px || rgb;
      switch (c.type) {
        case 'dimmer':
          if (c.pixel != null && profile.kind === 'blinder') v = scene === 3 && (bar % 4) === 3 ? 255 : 0;
          else if (c.pixel != null && profile.kind === 'retro') v = retroLevel(scene, c.pixel, beat, time, bar) * 255;
          else v = dim * 255;
          break;
        case 'dimmerFine': v = 0; break;
        case 'red': v = col[0] * 255; break;
        case 'green': v = col[1] * 255; break;
        case 'blue': v = col[2] * 255; break;
        case 'white': case 'coldWhite': v = (scene === 3 && strobe && profile.kind !== 'par' ? 255 : 0); break;
        case 'warmWhite': case 'amber': v = scene === 2 ? 180 : 0; break;
        case 'uv': v = scene === 1 ? 120 : 0; break;
        case 'cyan': v = (1 - col[0]) * 255; break;
        case 'magenta': v = (1 - col[1]) * 255; break;
        case 'yellow': v = (1 - col[2]) * 255; break;
        case 'strobe': v = strobe ? strobeValue(c, strobe) : (profile.kind === 'strobe' ? openValue(c) : openValue(c)); break;
        case 'colorWheel': v = nearestWheel(c, rgb); break;
        case 'gobo': v = goboValue(c, gobo, !!goboSpin && !profile.channels.some((x) => x.type === 'goboRot')); break;
        case 'gobo2': v = goboValue(c, gobo2); break;
        case 'goboRot': v = rotationValue(c, goboSpin, goboSpeed); break;
        case 'gobo2Rot': v = rotationValue(c, -goboSpin, goboSpeed); break;
        case 'prismRot': v = rotationValue(c, prismSpin, prismSpeed); break;
        case 'prism2Rot': v = rotationValue(c, -prismSpin, prismSpeed); break;
        case 'frost': v = frost * 255; break;
        case 'pan': v = Math.floor(panT * 65535) >> 8; break;
        case 'panFine': v = Math.floor(panT * 65535) & 255; break;
        case 'tilt': v = Math.floor(tiltT * 65535) >> 8; break;
        case 'tiltFine': v = Math.floor(tiltT * 65535) & 255; break;
        case 'zoom': v = profile.kind === 'laser' ? 90 + 60 * Math.sin(time * 0.4) : scene === 2 ? 220 : 60; break;
        case 'prism': v = prismValue(c, prism); break;
        case 'prism2': v = prismValue(c, prism2); break;
        case 'fog': v = profile.kind === 'lowfog' ? (scene === 2 ? 255 : 0) : fog * 255; break;
        case 'sparkHeight': case 'sparkFire': v = sparks ? 255 : 0; break;
        case 'laserPattern': v = ((bar >> 1) % 5) * 52 + 10; break;
        case 'laserRotate': v = scene === 3 ? 100 : 40; break;
        default: v = 0;
      }
      // Dedicated strobes only fire during the drop.
      if (profile.kind === 'strobe' && c.type === 'dimmer') v = scene === 3 && (bar % 4) === 3 ? 255 : 0;
      // Lasers rest during the slow dance; pinspots keep the mirror ball turning.
      if (profile.kind === 'laser' && c.type === 'dimmer') v = scene === 2 ? 0 : 255;
      if (profile.kind === 'pinspot' && c.type === 'dimmer') v = scene === 2 || scene === 1 ? 255 : 120;
      buf[addr] = Math.max(0, Math.min(255, Math.round(v)));
    });
  }
}
