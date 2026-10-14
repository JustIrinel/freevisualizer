// Built-in demo show: writes DMX for every patched fixture so the rig can be
// checked without SoundSwitch. It speaks each profile's own channel layout.

import { hexToRgb } from './fixture-state.js';

const BPM = 126;

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

function goboValue(channel, idx) {
  const list = (channel.ranges || []).filter((r) => r.gobo != null && !r.shake && !r.rotate);
  if (!list.length) return 0;
  const r = list[idx % list.length];
  return Math.round((r.from + r.to) / 2);
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
export function renderDemo(fixtures, store, time) {
  const beat = (time * BPM) / 60;
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
        break;
      case 2: // warm ballad
        rgb = [1, 0.55 + 0.1 * Math.sin(time + index), 0.15];
        dim = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(time * 0.7 + index * 0.9));
        panT = 0.5 + 0.1 * Math.sin(time * 0.3 + moverIdx);
        tiltT = 0.66 + 0.04 * Math.cos(time * 0.4 + moverIdx);
        gobo = 1;
        break;
      default: { // drop: white strobes + fast chase
        const drop = (bar % 4) === 3;
        rgb = drop ? [1, 1, 1] : hsv(0.55 + 0.1 * Math.sin(time), 0.9, 1);
        const chase = Math.floor(beat * 2) % n === index;
        dim = drop ? 1 : chase ? 1 : 0.15 + 0.5 * pulse;
        strobe = drop ? 0.85 : 0;
        panT = 0.5 + 0.22 * Math.sin(time * 2.2 + moverIdx * 1.3);
        tiltT = 0.6 + 0.1 * Math.cos(time * 2.2 + moverIdx * 1.3);
        gobo = 0;
      }
    }

    const fog = (bar % 16 === 0) && beat % 4 < 3 ? 1 : 0;

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
        case 'white': case 'coldWhite': v = (scene === 3 && strobe ? 255 : 0); break;
        case 'warmWhite': case 'amber': v = scene === 2 ? 180 : 0; break;
        case 'uv': v = scene === 1 ? 120 : 0; break;
        case 'cyan': v = (1 - col[0]) * 255; break;
        case 'magenta': v = (1 - col[1]) * 255; break;
        case 'yellow': v = (1 - col[2]) * 255; break;
        case 'strobe': v = strobe ? strobeValue(c, strobe) : (profile.kind === 'strobe' ? openValue(c) : openValue(c)); break;
        case 'colorWheel': v = nearestWheel(c, rgb); break;
        case 'gobo': v = goboValue(c, gobo); break;
        case 'pan': v = Math.floor(panT * 65535) >> 8; break;
        case 'panFine': v = Math.floor(panT * 65535) & 255; break;
        case 'tilt': v = Math.floor(tiltT * 65535) >> 8; break;
        case 'tiltFine': v = Math.floor(tiltT * 65535) & 255; break;
        case 'zoom': v = scene === 2 ? 220 : 60; break;
        case 'prism': v = 0; break;
        case 'fog': v = fog * 255; break;
        default: v = 0;
      }
      // Dedicated strobes only fire during the drop.
      if (profile.kind === 'strobe' && c.type === 'dimmer') v = scene === 3 && (bar % 4) === 3 ? 255 : 0;
      buf[addr] = Math.max(0, Math.min(255, Math.round(v)));
    });
  }
}
