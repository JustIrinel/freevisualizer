// Converts an Open Fixture Library (https://open-fixture-library.org) fixture
// definition into a FreeVisualizer profile. Pure module: runs in browser and Node.

import { tr } from './i18n.js';

const COLOR_MAP = {
  red: 'red', green: 'green', blue: 'blue', white: 'white', amber: 'amber', uv: 'uv', lime: 'lime',
  cyan: 'cyan', magenta: 'magenta', yellow: 'yellow', 'warm white': 'warmWhite', 'cold white': 'coldWhite', indigo: 'uv',
};

const NAMED_COLORS = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', 'dark blue': '#0020ff', 'light blue': '#60b0ff', cyan: '#00ffff',
  magenta: '#ff00ff', yellow: '#ffff00', orange: '#ff8000', amber: '#ffb000', pink: '#ff60b0', purple: '#8000ff',
  violet: '#9000ff', uv: '#6000ff', white: '#ffffff', 'warm white': '#ffd8a0', ctb: '#c0d8ff', cto: '#ffc080', lime: '#a0ff00',
  'lime green': '#ccff66', 'light green': '#90ff90', 'dark green': '#00a000', 'light red': '#ff6060', lavender: '#c0a0ff',
};

function parseDeg(v) {
  if (typeof v === 'number') return v;
  const m = /(-?[\d.]+)\s*deg/.exec(String(v || ''));
  return m ? parseFloat(m[1]) : null;
}

function parseHz(v, fallback) {
  if (typeof v === 'number') return v;
  const s = String(v || '').toLowerCase();
  let m = /([\d.]+)\s*hz/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /([\d.]+)\s*bpm/.exec(s);
  if (m) return parseFloat(m[1]) / 60;
  if (s.includes('stop') || s === 'slowest') return 0.5;
  if (s.includes('slow')) return 1;
  if (s.includes('fast')) return 20;
  return fallback;
}

function capsOf(def) {
  if (!def) return [];
  if (Array.isArray(def.capabilities)) return def.capabilities;
  if (def.capability) return [{ dmxRange: [0, 255], ...def.capability }];
  return [];
}

function rangeOf(cap, scale) {
  const r = cap.dmxRange || [0, 255];
  return [Math.round(r[0] / scale), Math.round(r[1] / scale)];
}

function slotColor(slot) {
  if (!slot) return '#ffffff';
  if (slot.type === 'Open') return '#ffffff';
  if (slot.type === 'Closed') return '#000000';
  if (Array.isArray(slot.colors) && slot.colors.length) return slot.colors[0];
  const n = String(slot.name || '').toLowerCase();
  for (const [k, v] of Object.entries(NAMED_COLORS)) if (n === k) return v;
  for (const [k, v] of Object.entries(NAMED_COLORS)) if (n.includes(k)) return v;
  return '#ffffff';
}

function pixelKeyList(matrix) {
  if (!matrix) return [];
  if (Array.isArray(matrix.pixelKeys)) {
    const keys = [];
    for (const layer of matrix.pixelKeys) for (const row of layer) for (const k of row) if (k != null) keys.push(String(k));
    return keys;
  }
  const [x = 1, y = 1, z = 1] = matrix.pixelCount || [];
  const keys = [];
  for (let zi = 1; zi <= z; zi++) {
    for (let yi = 1; yi <= y; yi++) {
      for (let xi = 1; xi <= x; xi++) {
        if (y === 1 && z === 1) keys.push(String(xi));
        else if (z === 1) keys.push(`(${xi}, ${yi})`);
        else keys.push(`(${xi}, ${yi}, ${zi})`);
      }
    }
  }
  return keys;
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Expand a mode's channel list into [{ name, pixel }] (pixel = index or null). */
export function expandModeChannels(fixture, mode) {
  const out = [];
  const pixelKeys = pixelKeyList(fixture.matrix);
  const groupKeys = Object.keys((fixture.matrix && fixture.matrix.pixelGroups) || {});
  const templates = Object.keys(fixture.templateChannels || {});

  for (const entry of mode.channels || []) {
    if (entry == null) { out.push({ name: null, pixel: null }); continue; }
    if (typeof entry === 'string') {
      out.push({ name: entry, pixel: null });
      continue;
    }
    if (entry.insert === 'matrixChannels') {
      let repeat = entry.repeatFor;
      if (repeat === 'eachPixelGroup') repeat = groupKeys;
      else if (repeat === 'eachPixelABC') repeat = [...pixelKeys].sort(naturalSort);
      else if (typeof repeat === 'string') repeat = pixelKeys; // eachPixelXYZ & friends
      const tpl = entry.templateChannels || [];
      if (entry.channelOrder === 'perChannel') {
        for (const t of tpl) repeat.forEach((key, i) => out.push({ name: t ? t.replace(/\$pixelKey/g, key) : null, template: t, pixel: i }));
      } else {
        repeat.forEach((key, i) => { for (const t of tpl) out.push({ name: t ? t.replace(/\$pixelKey/g, key) : null, template: t, pixel: i }); });
      }
    }
  }

  // Channels named after templates but listed explicitly (e.g. "Red 3").
  if (templates.length) {
    const allKeys = [...pixelKeys, ...groupKeys];
    for (const c of out) {
      if (c.name == null || c.template || (fixture.availableChannels || {})[c.name]) continue;
      for (const t of templates) {
        const re = new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '$' ? '\\$' : '\\' + m)).replace('\\$pixelKey', '(.+)') + '$');
        const m = re.exec(c.name);
        if (m) { c.template = t; c.pixel = Math.max(0, allKeys.indexOf(m[1])); break; }
      }
    }
  }
  return out;
}

function resolveDef(fixture, item) {
  const channels = fixture.availableChannels || {};
  if (item.template) return { def: fixture.templateChannels[item.template], fine: false };
  if (channels[item.name]) return { def: channels[item.name], fine: false, baseName: item.name };
  for (const [name, def] of Object.entries(channels)) {
    const aliases = def.fineChannelAliases || [];
    if (aliases[0] === item.name) return { def, fine: true, baseName: name };
    if (aliases.includes(item.name)) return { def: null, fine: true, baseName: name }; // 24-bit+ byte: ignore
  }
  // Fine channels of template channels: "Red 1 fine" etc.
  for (const [tName, def] of Object.entries(fixture.templateChannels || {})) {
    for (const alias of def.fineChannelAliases || []) {
      const re = new RegExp('^' + alias.replace(/\$pixelKey/g, '__PK__').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('__PK__', '.+') + '$');
      if (re.test(item.name || '')) return { def: null, fine: true, baseName: tName };
    }
  }
  return { def: null, fine: false };
}

function wheelFor(fixture, cap, channelName) {
  const wheels = fixture.wheels || {};
  const name = cap.wheel || channelName;
  return { name, wheel: wheels[name] || wheels[Object.keys(wheels).find((w) => channelName && channelName.includes(w))] || null };
}

/** 0 for the first gobo wheel of the fixture, 1 for the second one. */
function goboWheelIndex(fixture, wheelName, channelName) {
  const names = Object.entries(fixture.wheels || {})
    .filter(([, w]) => (w.slots || []).some((s) => s.type === 'Gobo' || s.type === 'Iris'))
    .map(([n]) => n);
  const i = names.indexOf(wheelName);
  if (i >= 0) return Math.min(1, i);
  return /gobo ?(wheel ?)?2|2nd gobo|second gobo|static gobo/i.test(channelName || '') ? 1 : 0;
}

function prismFacets(cap) {
  if (cap.facets >= 2) return cap.facets;
  const m = /(\d+)[- ]?(facet|fold|face|prism)/i.exec(cap.comment || '');
  return m ? Number(m[1]) : 3;
}

/** "slow CW", "fast CCW", "stop", "12rpm", "-5Hz" → { speed (signed number), stop } */
function parseSpeed(v) {
  const str = String(v ?? '').toLowerCase();
  if (!str) return null;
  if (/stop/.test(str)) return { speed: 0 };
  const dir = /ccw/.test(str) ? -1 : 1;
  const num = /(-?[\d.]+)\s*(rpm|hz|%)/.exec(str);
  if (num) return { speed: Math.abs(parseFloat(num[1])) * (parseFloat(num[1]) < 0 ? -1 : dir) };
  if (/fast/.test(str)) return { speed: 10 * dir };
  if (/slow/.test(str)) return { speed: 1 * dir };
  return { speed: 5 * dir };
}

/** OFL rotation capability (WheelSlotRotation, WheelRotation, PrismRotation) → our rotation range. */
function rotationRange(cap, from, to) {
  if (cap.angleStart != null || cap.angle != null) {
    const a = parseDeg(cap.angleStart ?? cap.angle) ?? 0;
    const b = parseDeg(cap.angleEnd ?? cap.angle) ?? a;
    return { from, to, index: true, angleFrom: a, angleTo: b };
  }
  const start = parseSpeed(cap.speedStart ?? cap.speed);
  const end = parseSpeed(cap.speedEnd ?? cap.speed);
  if (!start || !end) return { from, to, rotate: 1 };
  if (start.speed === 0 && end.speed === 0) return { from, to, stop: true };
  const dir = Math.sign(start.speed || end.speed);
  return { from, to, rotate: dir, ...(Math.abs(start.speed) > Math.abs(end.speed) ? { fastToSlow: true } : {}) };
}

/** Convert one channel definition into a FreeVisualizer channel. */
function convertChannel(fixture, item, info) {
  const { def, fine, baseName } = info;
  if (!def) return { type: 'none', label: item.name || '' };
  const caps = capsOf(def);
  const scale = def.fineChannelAliases && def.fineChannelAliases.length && caps.some((c) => c.dmxRange && c.dmxRange[1] > 255) ? 256 : 1;
  const size = (c) => { const r = c.dmxRange || [0, 255]; return r[1] - r[0] + 1; };
  const weight = {};
  for (const c of caps) weight[c.type] = (weight[c.type] || 0) + size(c);
  const has = (t) => weight[t] > 0;
  const main = Object.entries(weight).filter(([t]) => t !== 'NoFunction').sort((a, b) => b[1] - a[1])[0];
  const mainType = main ? main[0] : 'NoFunction';
  const label = baseName || item.name || '';

  if (has('Pan') && (mainType === 'Pan' || mainType === 'PanContinuous')) return { type: fine ? 'panFine' : 'pan', label };
  if (has('Tilt') && (mainType === 'Tilt' || mainType === 'TiltContinuous')) return { type: fine ? 'tiltFine' : 'tilt', label };
  if (mainType === 'Intensity') return { type: fine ? 'dimmerFine' : 'dimmer', label };
  if (fine) return { type: 'none', label };

  if (mainType === 'ColorIntensity') {
    const cap = caps.find((c) => c.type === 'ColorIntensity');
    const t = COLOR_MAP[String(cap.color || '').toLowerCase()];
    return { type: t || 'none', label };
  }

  if (mainType === 'ShutterStrobe' || (has('ShutterStrobe') && /strob|shutter/i.test(label))) {
    const ranges = [];
    for (const c of caps) {
      const [from, to] = rangeOf(c, scale);
      if (c.type !== 'ShutterStrobe') { ranges.push({ from, to, mode: 'open' }); continue; }
      const eff = c.shutterEffect;
      if (eff === 'Open') ranges.push({ from, to, mode: 'open' });
      else if (eff === 'Closed') ranges.push({ from, to, mode: 'closed' });
      else {
        const hzFrom = parseHz(c.speedStart ?? c.speed, 1);
        const hzTo = parseHz(c.speedEnd ?? c.speed, hzFrom === 1 ? 20 : hzFrom);
        const mode = c.randomTiming || eff === 'Lightning' || eff === 'Spikes' ? 'random' : eff === 'Pulse' || eff === 'RampUp' || eff === 'RampDown' || eff === 'RampUpDown' ? 'pulse' : 'strobe';
        ranges.push({ from, to, mode, hzFrom: Math.max(0.2, hzFrom), hzTo: Math.max(0.2, hzTo) });
      }
    }
    return { type: 'strobe', label, ranges };
  }

  if (mainType === 'WheelSlot' || mainType === 'WheelRotation' || mainType === 'WheelShake' || mainType === 'WheelSlotRotation') {
    const firstWheelCap = caps.find((c) => /^Wheel/.test(c.type)) || {};
    const { name: wheelName, wheel } = wheelFor(fixture, firstWheelCap, baseName || item.name);
    const slots = (wheel && wheel.slots) || [];
    const isColor = slots.some((s) => s.type === 'Color') || /colou?r/i.test(baseName || '');
    const isGobo = slots.some((s) => s.type === 'Gobo' || s.type === 'Iris') || /gobo/i.test(baseName || '');
    const second = isGobo && goboWheelIndex(fixture, wheelName, baseName || item.name) === 1;
    // Only rotation capabilities (gobo index / rotation, or the whole wheel spinning): a rotation channel.
    if (!has('WheelSlot') && !has('WheelShake') && (has('WheelSlotRotation') || (isGobo && has('WheelRotation')))) {
      if (!isGobo) return { type: 'none', label };
      const ranges = caps.map((c) => {
        const [from, to] = rangeOf(c, scale);
        return /Rotation$/.test(c.type) ? rotationRange(c, from, to) : { from, to, stop: true };
      });
      return { type: second ? 'gobo2Rot' : 'goboRot', label, ranges };
    }
    if (isColor && !isGobo) {
      const ranges = [];
      for (const c of caps) {
        const [from, to] = rangeOf(c, scale);
        if (c.type === 'WheelSlot') {
          const n = c.slotNumber ?? 1;
          const a = slots[Math.floor(n) - 1];
          const color = Number.isInteger(n) ? slotColor(a) : slotColor(slots[Math.floor(n) - 1]);
          ranges.push({ from, to, color, ...(Number.isInteger(n) ? {} : { split: slotColor(slots[Math.ceil(n) - 1]) }) });
        } else if (c.type === 'WheelRotation' || c.type === 'WheelShake') {
          if (c.speed === 'stop' || (c.speed && /stop/.test(c.speed))) ranges.push({ from, to, color: '#ffffff' });
          else ranges.push({ from, to, mode: 'rotate' });
        } else {
          ranges.push({ from, to, color: '#ffffff' });
        }
      }
      return { type: 'colorWheel', label, ranges };
    }
    if (isGobo) {
      const ranges = [];
      for (const c of caps) {
        const [from, to] = rangeOf(c, scale);
        if (c.type === 'WheelSlot' || c.type === 'WheelShake') {
          const n = Math.floor(c.slotNumber ?? 1);
          const slot = slots[n - 1];
          const open = !slot || slot.type === 'Open';
          ranges.push({ from, to, gobo: open ? 0 : n - 1, ...(c.type === 'WheelShake' ? { shake: true } : {}) });
        } else if (c.type === 'WheelRotation') {
          ranges.push({ from, to, gobo: 1, rotate: true });
        } else if (c.type === 'WheelSlotRotation') {
          // Gobo selection and rotation on one channel.
          const prev = ranges[ranges.length - 1];
          const n = c.slotNumber != null ? Math.floor(c.slotNumber) - 1 : prev && prev.gobo ? prev.gobo : 1;
          ranges.push({ ...rotationRange(c, from, to), gobo: Math.max(1, n) });
        } else {
          ranges.push({ from, to, gobo: 0 });
        }
      }
      return { type: second ? 'gobo2' : 'gobo', label, ranges };
    }
    return { type: 'none', label };
  }

  if (mainType === 'Prism' || (has('Prism') && (/prism/i.test(label) || mainType === 'PrismRotation'))) {
    let last = 3;
    const ranges = caps.map((c) => {
      const [from, to] = rangeOf(c, scale);
      if (c.type === 'Prism') {
        last = prismFacets(c);
        return { from, to, prism: last, ...(/linear/i.test(`${c.comment || ''} ${label}`) ? { shape: 'linear' } : {}) };
      }
      // Prism in and rotating, on the same channel.
      if (c.type === 'PrismRotation') return { ...rotationRange(c, from, to), prism: last };
      return { from, to, prism: 0 };
    });
    return { type: 'prism', label, ranges };
  }

  if (mainType === 'PrismRotation') {
    const ranges = caps.map((c) => {
      const [from, to] = rangeOf(c, scale);
      return c.type === 'PrismRotation' ? rotationRange(c, from, to) : { from, to, stop: true };
    });
    return { type: 'prismRot', label, ranges };
  }

  if (mainType === 'Frost') return { type: 'frost', label };

  if (mainType === 'Zoom') {
    const cap = caps.find((c) => c.type === 'Zoom') || {};
    const start = String(cap.angleStart ?? cap.angle ?? '');
    const end = String(cap.angleEnd ?? cap.angle ?? '');
    const invert = /wide/.test(start) || /narrow/.test(end) || (parseDeg(start) != null && parseDeg(end) != null && parseDeg(start) > parseDeg(end));
    return { type: 'zoom', label, ...(invert ? { invert: true } : {}) };
  }

  if (mainType === 'Fog' || mainType === 'FogOutput') return { type: 'fog', label };
  return { type: 'none', label };
}

function guessKind(fixture, channels) {
  const cats = fixture.categories || [];
  const hasPanTilt = channels.some((c) => c.type === 'pan' || c.type === 'tilt');
  if (cats.includes('Smoke') || cats.includes('Hazer')) return 'fog';
  if (cats.includes('Moving Head') || cats.includes('Scanner') || hasPanTilt) return 'moving';
  if (cats.includes('Pixel Bar') || cats.includes('Matrix')) return 'bar';
  if (cats.includes('Blinder')) return 'blinder';
  if (cats.includes('Strobe') && !cats.includes('Color Changer')) return 'strobe';
  if (cats.includes('Strobe') && cats[0] === 'Strobe') return 'strobe';
  return 'par';
}

/** Returns the list of modes: [{ index, name, channels }]. */
export function listModes(fixture) {
  return (fixture.modes || []).map((m, index) => ({ index, name: m.name || m.shortName || tr('Mod {n}', { n: index + 1 }), shortName: m.shortName, channels: expandModeChannels(fixture, m).length }));
}

export function oflToProfile(fixture, modeIndex = 0, key = fixture.__key || '') {
  const mode = (fixture.modes || [])[modeIndex];
  if (!mode) throw new Error(tr('Modul selectat nu există în fixtură'));
  const items = expandModeChannels(fixture, mode);
  const channels = items.map((item) => {
    if (item.name == null) return { type: 'none', label: '' };
    const converted = convertChannel(fixture, item, resolveDef(fixture, item));
    if (item.pixel != null) converted.pixel = item.pixel;
    return converted;
  });

  // A second prism (and its rotation) → prism 2.
  for (const [type, two] of [['prism', 'prism2'], ['prismRot', 'prism2Rot']]) {
    const list = channels.filter((c) => c.type === type && c.pixel == null);
    if (list.length > 1 && !channels.some((c) => c.type === two)) list[1].type = two;
  }
  const pixelCount = channels.reduce((m, c) => (c.pixel != null ? Math.max(m, c.pixel + 1) : m), 0);
  let kind = guessKind(fixture, channels);
  // 7 heads (1 + 6) on a hexagonal plate: the popular "retro" effect lights.
  if (pixelCount === 7 && ['par', 'bar', 'blinder'].includes(kind)) kind = 'retro';
  const lens = (fixture.physical && fixture.physical.lens && fixture.physical.lens.degreesMinMax) || null;
  const defaults = { par: [25, 25], moving: [15, 15], bar: [25, 25], strobe: [110, 110], blinder: [60, 60], retro: [40, 40], fog: [20, 20] };
  const beamAngle = lens ? [Math.max(1, lens[0]), Math.max(1, lens[1])] : defaults[kind];

  const range = (type, def) => {
    for (const d of Object.values(fixture.availableChannels || {})) {
      const cap = capsOf(d).find((c) => c.type === type);
      if (cap && cap.angleStart != null) {
        const a = parseDeg(cap.angleStart);
        const b = parseDeg(cap.angleEnd);
        if (a != null && b != null) return Math.abs(b - a);
      }
    }
    return def;
  };

  let style;
  if (kind === 'moving') {
    const hasGobo = channels.some((c) => c.type === 'gobo');
    const hasMix = channels.some((c) => ['red', 'green', 'blue', 'cyan'].includes(c.type));
    if (beamAngle[1] <= 6) style = 'beam';
    else if (hasMix && !hasGobo) style = 'wash';
    else style = 'spot';
  }

  const dims = fixture.physical && fixture.physical.dimensions;
  return {
    id: `ofl-${key.replace('/', '-') || fixture.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${modeIndex}`,
    name: `${fixture.name} (${mode.shortName || mode.name || channels.length + 'ch'})`,
    manufacturer: fixture.__manufacturer || (key ? key.split('/')[0] : ''),
    source: 'ofl',
    oflKey: key || undefined,
    kind,
    ...(style ? { style } : {}),
    pixels: Math.max(1, pixelCount || (kind === 'bar' ? 8 : kind === 'blinder' ? 2 : 1)),
    ...(kind === 'retro' && !channels.some((c) => ['red', 'green', 'blue'].includes(c.type)) ? { defaultColor: '#ffb347' } : {}),
    beamAngle,
    panRange: range('Pan', 540),
    tiltRange: range('Tilt', 270),
    ...(dims ? { dimensions: dims.map((d) => d / 1000) } : {}),
    channels,
  };
}
