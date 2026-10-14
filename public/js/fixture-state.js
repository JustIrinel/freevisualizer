// Turns raw DMX values into a visual state (color, intensity, pan/tilt, ...).
// Pure module (no Three.js) so it can be unit-tested in Node.

const ADDITIVE = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], white: [1, 1, 1],
  warmWhite: [1, 0.78, 0.5], coldWhite: [0.85, 0.92, 1], amber: [1, 0.6, 0], uv: [0.35, 0, 1], lime: [0.6, 1, 0],
};
const SUBTRACTIVE = { cyan: 0, magenta: 1, yellow: 2 };
const COLOR_TYPES = new Set([...Object.keys(ADDITIVE), ...Object.keys(SUBTRACTIVE)]);

export const LASER_PATTERNS = 5; // fan, liquid sky, cone, tunnel, single beam

export function hexToRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, 'f'), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Pre-computes channel offsets of a profile. Cached on the profile object. */
export function compileProfile(profile) {
  if (profile.__compiled && profile.__compiledFor === profile.channels) return profile.__compiled;
  const master = { colors: {} };
  const pixels = [];
  for (let p = 0; p < (profile.pixels || 1); p++) pixels.push({ colors: {} });
  profile.channels.forEach((c, i) => {
    const target = c.pixel != null ? (pixels[c.pixel] || (pixels[c.pixel] = { colors: {} })) : master;
    if (COLOR_TYPES.has(c.type)) target.colors[c.type] = i;
    else if (c.type !== 'none' && target[c.type] == null) target[c.type] = i;
  });
  const compiled = {
    master,
    pixels,
    hasPixelColor: pixels.some((p) => Object.keys(p.colors).length > 0),
    hasPixelDimmer: pixels.some((p) => p.dimmer != null),
    defaultColor: hexToRgb(profile.defaultColor || '#ffffff'),
    channels: profile.channels,
  };
  Object.defineProperty(profile, '__compiled', { value: compiled, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(profile, '__compiledFor', { value: profile.channels, writable: true, configurable: true, enumerable: false });
  return compiled;
}

export function createRuntime() {
  return { phase: 0, wheelPos: 0, goboRot: 0, flashUntil: 0, nextFlash: 0, shake: 0 };
}

function findRange(ranges, v) {
  if (!ranges) return null;
  for (const r of ranges) if (v >= r.from && v <= r.to) return r;
  return null;
}

function lerpRange(r, v, a, b) {
  const span = Math.max(1, r.to - r.from);
  return a + ((v - r.from) / span) * (b - a);
}

function mixColor(group, read, fallback, wheel) {
  let r = 0; let g = 0; let b = 0;
  let additive = false;
  for (const [type, idx] of Object.entries(group.colors)) {
    const mul = ADDITIVE[type];
    if (!mul) continue;
    additive = true;
    const v = read(idx) / 255;
    r += v * mul[0]; g += v * mul[1]; b += v * mul[2];
  }
  let hasSub = false;
  const sub = [0, 0, 0];
  for (const [type, k] of Object.entries(SUBTRACTIVE)) {
    if (group.colors[type] != null) { hasSub = true; sub[k] = read(group.colors[type]) / 255; }
  }
  if (!additive) {
    [r, g, b] = fallback;
    if (hasSub) { r *= 1 - sub[0]; g *= 1 - sub[1]; b *= 1 - sub[2]; }
  } else if (hasSub) {
    r *= 1 - sub[0]; g *= 1 - sub[1]; b *= 1 - sub[2];
  }
  if (wheel) { r *= wheel[0]; g *= wheel[1]; b *= wheel[2]; }
  return { rgb: [r, g, b], additive };
}

function normalize(rgb) {
  const m = Math.max(rgb[0], rgb[1], rgb[2]);
  if (m <= 0.0001) return { color: [0, 0, 0], level: 0 };
  return { color: [rgb[0] / m, rgb[1] / m, rgb[2] / m], level: Math.min(1, m) };
}

function shutterFactor(channel, v, rt, dt, time) {
  if (!channel) return 1;
  const r = findRange(channel.ranges, v);
  if (!r || r.mode === 'open') return 1;
  if (r.mode === 'closed') return 0;
  const hz = Math.max(0.1, lerpRange(r, v, r.hzFrom ?? 1, r.hzTo ?? 20));
  if (r.mode === 'random') {
    if (time >= rt.nextFlash) {
      rt.flashUntil = time + 0.035;
      rt.nextFlash = time + (0.4 + Math.random() * 1.2) / hz;
    }
    return time < rt.flashUntil ? 1 : 0;
  }
  rt.phase = (rt.phase + dt * hz) % 1;
  if (r.mode === 'pulse') return 1 - rt.phase;
  // A flash lasts ~30 ms or ~35% of the period for slow rates.
  const duty = Math.min(0.5, Math.max(0.12, 0.03 * hz));
  return rt.phase < duty ? 1 : 0;
}

function wheelColor(channel, v, rt, dt) {
  const r = findRange(channel.ranges, v);
  if (!r) return null;
  if (r.color) {
    if (r.split) {
      const a = hexToRgb(r.color); const b = hexToRgb(r.split);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    return hexToRgb(r.color);
  }
  if (r.mode === 'rotate') {
    const colors = channel.ranges.filter((x) => x.color && x.color !== '#000000');
    if (!colors.length) return null;
    const speed = lerpRange(r, v, 0.3, 4);
    rt.wheelPos = (rt.wheelPos + dt * speed) % colors.length;
    return hexToRgb(colors[Math.floor(rt.wheelPos)].color);
  }
  return null;
}

/**
 * @param profile   normalized profile
 * @param dmx       Uint8Array(512) of the fixture's universe
 * @param address   1-based start address
 * @param opts      { invertPan, invertTilt }
 */
export function computeState(profile, dmx, address, rt, dt, time, opts = {}) {
  const c = compileProfile(profile);
  const base = address - 1;
  const read = (idx) => (dmx && base + idx < 512 ? dmx[base + idx] : 0);
  const ch = (idx) => c.channels[idx];
  const m = c.master;

  const shutter = m.strobe != null ? shutterFactor(ch(m.strobe), read(m.strobe), rt, dt, time) : 1;
  const wheel = m.colorWheel != null ? wheelColor(ch(m.colorWheel), read(m.colorWheel), rt, dt) : null;
  let masterDim = 1;
  if (m.dimmer != null) masterDim = m.dimmerFine != null ? (read(m.dimmer) * 256 + read(m.dimmerFine)) / 65535 : read(m.dimmer) / 255;

  const master = mixColor(m, read, c.defaultColor, wheel);
  const mn = normalize(master.rgb);
  // Without a dimmer channel, the color level itself acts as the dimmer.
  // Without a dimmer channel the color level acts as the dimmer; a fixture with
  // no color mixing at all (wheel-only, white strobe) is considered "lamp on".
  const level = master.additive ? mn.level : 1;
  const intensity = (m.dimmer != null ? masterDim : 1) * level * shutter;
  const state = {
    color: mn.level > 0 ? mn.color : master.additive ? [0, 0, 0] : c.defaultColor,
    intensity: Math.max(0, Math.min(1, intensity)),
    shutter,
    pan: 0,
    tilt: 0,
    beamAngle: profile.beamAngle ? profile.beamAngle[0] : 25,
    gobo: 0,
    goboRotation: 0,
    prism: 0,
    fog: 0,
    spark: 0,
    laserPattern: 0,
    laserSpin: 0,
    pixels: null,
  };

  // Pixels (bars, blinders, multi-cell fixtures)
  if ((profile.pixels || 1) > 1 || c.hasPixelColor || c.hasPixelDimmer) {
    state.pixels = c.pixels.map((p) => {
      const hasColor = Object.keys(p.colors).length > 0;
      const mix = hasColor ? mixColor(p, read, c.defaultColor, wheel) : master;
      const pn = normalize(mix.rgb);
      const pDim = p.dimmer != null ? read(p.dimmer) / 255 : 1;
      let level = mix.additive ? pn.level : 1;
      if (!mix.additive && p.dimmer == null && m.dimmer == null) level = 0; // nothing drives it
      return {
        color: pn.level > 0 ? pn.color : mix.additive ? [0, 0, 0] : c.defaultColor,
        intensity: Math.max(0, Math.min(1, level * pDim * masterDim * shutter)),
      };
    });
    const max = state.pixels.reduce((a, p) => Math.max(a, p.intensity), 0);
    state.intensity = max;
    if (max > 0) {
      const avg = [0, 0, 0];
      for (const p of state.pixels) { avg[0] += p.color[0] * p.intensity; avg[1] += p.color[1] * p.intensity; avg[2] += p.color[2] * p.intensity; }
      state.color = normalize(avg).color;
    }
  }

  if (m.pan != null) {
    const v = (read(m.pan) * 256 + (m.panFine != null ? read(m.panFine) : 0)) / 65535;
    state.pan = (v - 0.5) * (profile.panRange || 540) * (opts.invertPan ? -1 : 1);
  }
  if (m.tilt != null) {
    const v = (read(m.tilt) * 256 + (m.tiltFine != null ? read(m.tiltFine) : 0)) / 65535;
    state.tilt = (v - 0.5) * (profile.tiltRange || 270) * (opts.invertTilt ? -1 : 1);
  }
  if (m.zoom != null && profile.beamAngle) {
    let z = read(m.zoom) / 255;
    if (ch(m.zoom).invert) z = 1 - z;
    state.beamAngle = profile.beamAngle[0] + (profile.beamAngle[1] - profile.beamAngle[0]) * z;
  }
  if (m.gobo != null) {
    const r = findRange(ch(m.gobo).ranges, read(m.gobo));
    if (r) {
      state.gobo = r.gobo || 0;
      if (r.shake) { rt.shake += dt * 18; state.goboRotation = Math.sin(rt.shake) * 0.35; }
      if (r.rotate) { rt.goboRot += dt * 2; state.goboRotation = rt.goboRot; }
    }
  }
  if (m.prism != null) {
    const r = findRange(ch(m.prism).ranges, read(m.prism));
    state.prism = r ? r.prism || 0 : read(m.prism) > 127 ? 3 : 0;
  }
  if (m.fog != null) state.fog = read(m.fog) / 255;

  // Cold spark machine: height channel, optionally gated by a "fire" channel.
  if (m.sparkHeight != null || m.sparkFire != null) {
    const height = m.sparkHeight != null ? read(m.sparkHeight) / 255 : 1;
    const fire = m.sparkFire != null ? read(m.sparkFire) > 127 : true;
    state.spark = fire ? height : 0;
  }

  // Laser: pattern picks one of the built-in looks, rotate = signed speed.
  if (m.laserPattern != null) state.laserPattern = Math.min(LASER_PATTERNS - 1, Math.floor((read(m.laserPattern) / 256) * LASER_PATTERNS));
  if (m.laserRotate != null) {
    const v = read(m.laserRotate);
    state.laserSpin = v < 10 ? 0 : v < 128 ? ((v - 10) / 117) * 4 : -((v - 128) / 127) * 4;
  }
  return state;
}
