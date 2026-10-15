// QLC+ fixture definition (.qxf) → FreeVisualizer profile.
import { parseXml, child, children } from './xml-lite.js';
import { DEFAULT_STROBE_RANGES } from './profiles.js';
import { tr } from './i18n.js';

const PRESETS = {
  IntensityMasterDimmer: 'dimmer', IntensityDimmer: 'dimmer',
  IntensityMasterDimmerFine: 'dimmerFine', IntensityDimmerFine: 'dimmerFine',
  IntensityRed: 'red', IntensityGreen: 'green', IntensityBlue: 'blue', IntensityWhite: 'white',
  IntensityAmber: 'amber', IntensityUV: 'uv', IntensityLime: 'lime', IntensityIndigo: 'uv',
  IntensityCyan: 'cyan', IntensityMagenta: 'magenta', IntensityYellow: 'yellow',
  IntensityWarmWhite: 'warmWhite', IntensityColdWhite: 'coldWhite',
  PositionPan: 'pan', PositionPanFine: 'panFine', PositionTilt: 'tilt', PositionTiltFine: 'tiltFine',
  BeamZoomSmallBig: 'zoom', BeamZoomBigSmall: 'zoom',
};

const COLOURS = { red: 'red', green: 'green', blue: 'blue', white: 'white', amber: 'amber', uv: 'uv', lime: 'lime', cyan: 'cyan', magenta: 'magenta', yellow: 'yellow', indigo: 'uv' };

const TYPES = {
  'Moving Head': 'moving', Scanner: 'moving',
  'LED Bar (Pixels)': 'bar', 'LED Bar (Beams)': 'bar',
  Strobe: 'strobe', Smoke: 'fog', Hazer: 'fog',
};

function capColor(cap) {
  const c = cap.attrs.Res1 || cap.attrs.Color || '';
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
}

function strobeRanges(caps) {
  // No detail (or one 0–255 "strobe" range): usual convention, 0–9 open then faster.
  if (caps.length <= 1) return DEFAULT_STROBE_RANGES.map((r) => ({ ...r }));
  return caps.map((c) => {
    const from = Number(c.attrs.Min); const to = Number(c.attrs.Max);
    const preset = c.attrs.Preset || '';
    const text = (c.text || '').toLowerCase();
    if (/ShutterClose/.test(preset) || /close|blackout/.test(text)) return { from, to, mode: 'closed' };
    if (/Random/i.test(preset) || /random/.test(text)) return { from, to, mode: 'random', hzFrom: 1, hzTo: 20 };
    if (/Pulse|Ramp/i.test(preset) || /pulse|ramp/.test(text)) return { from, to, mode: 'pulse', hzFrom: 1, hzTo: 15 };
    if (/Strobe/i.test(preset) || /strobe/.test(text)) {
      const fast = /FastToSlow/.test(preset);
      return { from, to, mode: 'strobe', hzFrom: fast ? 20 : 1, hzTo: fast ? 1 : 20 };
    }
    return { from, to, mode: 'open' };
  });
}

/** One QLC+ <Channel> definition → our channel. */
function convertChannel(def, fixtureType) {
  const name = def.attrs.Name || '';
  const preset = def.attrs.Preset;
  if (preset && PRESETS[preset]) {
    const out = { type: PRESETS[preset], label: name };
    if (preset === 'BeamZoomBigSmall') out.invert = true;
    return out;
  }
  if (preset && /^ShutterStrobe/.test(preset)) return { type: 'strobe', label: name, ranges: strobeRanges([]) };
  const groupEl = child(def, 'Group');
  const group = groupEl ? groupEl.text : '';
  const fine = groupEl && groupEl.attrs.Byte === '1';
  const caps = children(def, 'Capability');
  const lname = name.toLowerCase();

  if (group === 'Intensity') {
    const colour = (child(def, 'Colour')?.text || '').toLowerCase();
    if (COLOURS[colour]) return { type: fine ? 'none' : COLOURS[colour], label: name };
    for (const [k, v] of Object.entries(COLOURS)) if (new RegExp(`\\b${k}\\b`).test(lname)) return { type: fine ? 'none' : v, label: name };
    if ((fixtureType === 'Smoke' || fixtureType === 'Hazer') && /fog|smoke|haze|output/.test(lname)) return { type: 'fog', label: name };
    return { type: fine ? 'dimmerFine' : 'dimmer', label: name };
  }
  if (group === 'Pan') return { type: fine ? 'panFine' : 'pan', label: name };
  if (group === 'Tilt') return { type: fine ? 'tiltFine' : 'tilt', label: name };
  if (group === 'Shutter' || /strob/.test(lname)) return { type: 'strobe', label: name, ranges: strobeRanges(caps) };
  if (group === 'Colour' && !/rotat|speed|macro|program/.test(lname)) {
    const ranges = caps.map((c) => {
      const from = Number(c.attrs.Min); const to = Number(c.attrs.Max);
      const color = capColor(c);
      if (/Rotation|Rainbow/i.test(c.attrs.Preset || '') || /rainbow|cycl|scroll|rotat/i.test(c.text)) return { from, to, mode: 'rotate' };
      const second = c.attrs.Res2 && /^#[0-9a-f]{6}$/i.test(c.attrs.Res2) ? c.attrs.Res2.toLowerCase() : null;
      return { from, to, color: color || '#ffffff', ...(second ? { split: second } : {}) };
    });
    return ranges.length ? { type: 'colorWheel', label: name, ranges } : { type: 'none', label: name };
  }
  if (group === 'Gobo' && !/rotat|index|speed|shake/.test(lname)) {
    let idx = 0;
    const ranges = caps.map((c) => {
      const from = Number(c.attrs.Min); const to = Number(c.attrs.Max);
      const text = (c.text || '').toLowerCase();
      const preset = c.attrs.Preset || '';
      if (/^open|no function|white/.test(text)) return { from, to, gobo: 0 };
      if (/Rotation/i.test(preset) || /cycle|rotat|scroll/.test(text)) return { from, to, gobo: 1, rotate: true };
      const m = /gobo\s*(\d+)/.exec(text);
      const g = m ? Number(m[1]) : ++idx;
      return { from, to, gobo: g, ...(/Shake/i.test(preset) || /shake/.test(text) ? { shake: true } : {}) };
    });
    return ranges.length ? { type: 'gobo', label: name, ranges } : { type: 'none', label: name };
  }
  if (group === 'Prism' && !/rotat/.test(lname)) {
    const ranges = caps.map((c) => ({ from: Number(c.attrs.Min), to: Number(c.attrs.Max), prism: /open|no function|off/i.test(c.text || '') ? 0 : 3 }));
    return { type: 'prism', label: name, ranges: ranges.length ? ranges : [{ from: 0, to: 127, prism: 0 }, { from: 128, to: 255, prism: 3 }] };
  }
  if (group === 'Beam' && /zoom/.test(lname)) return { type: 'zoom', label: name };
  if ((fixtureType === 'Smoke' || fixtureType === 'Hazer') && /fog|smoke|haze|output|pump/.test(lname)) return { type: 'fog', label: name };
  return { type: 'none', label: name };
}

export function parseQxf(text) {
  const root = parseXml(text);
  if (root.name !== 'FixtureDefinition') throw new Error(tr('Fișierul nu este o definiție QLC+ (.qxf)'));
  return root;
}

export function listQxfModes(root) {
  return children(root, 'Mode').map((m, index) => ({ index, name: m.attrs.Name || tr('Mod {n}', { n: index + 1 }), channels: children(m, 'Channel').length }));
}

function lensAndFocus(node) {
  const phys = child(node, 'Physical');
  if (!phys) return {};
  const lens = child(phys, 'Lens');
  const focus = child(phys, 'Focus');
  const out = {};
  if (lens) {
    const a = Number(lens.attrs.DegreesMin); const b = Number(lens.attrs.DegreesMax);
    if (a > 0 || b > 0) out.beamAngle = [Math.max(1, a || b), Math.max(1, b || a)];
  }
  if (focus) {
    if (Number(focus.attrs.PanMax) > 0) out.panRange = Number(focus.attrs.PanMax);
    if (Number(focus.attrs.TiltMax) > 0) out.tiltRange = Number(focus.attrs.TiltMax);
  }
  return out;
}

export function qxfToProfile(root, modeIndex = 0) {
  const manufacturer = child(root, 'Manufacturer')?.text || '';
  const model = child(root, 'Model')?.text || tr('Fixtură');
  const fixtureType = child(root, 'Type')?.text || '';
  const defs = new Map(children(root, 'Channel').map((c) => [c.attrs.Name, c]));
  const mode = children(root, 'Mode')[modeIndex];
  if (!mode) throw new Error(tr('Modul selectat nu există'));

  const list = children(mode, 'Channel')
    .map((c) => ({ number: Number(c.attrs.Number), name: c.text }))
    .sort((a, b) => a.number - b.number);
  const heads = children(mode, 'Head').map((hd) => children(hd, 'Channel').map((c) => Number(c.text)));
  const pixelOf = new Map();
  heads.forEach((chs, i) => chs.forEach((n) => pixelOf.set(n, i)));

  const channels = list.map((c) => {
    const def = defs.get(c.name);
    const conv = def ? convertChannel(def, fixtureType) : { type: 'none', label: c.name };
    if (pixelOf.has(c.number) && heads.length > 1) conv.pixel = pixelOf.get(c.number);
    return conv;
  });

  const hasPanTilt = channels.some((c) => c.type === 'pan' || c.type === 'tilt');
  let kind = TYPES[fixtureType] || (hasPanTilt ? 'moving' : 'par');
  if (heads.length === 7 && kind !== 'moving') kind = 'retro';
  const pixels = heads.length > 1 ? heads.length : kind === 'bar' ? 8 : 1;
  const phys = { ...lensAndFocus(root), ...lensAndFocus(mode) };
  let style;
  if (kind === 'moving') {
    const gobo = channels.some((c) => c.type === 'gobo');
    const mix = channels.some((c) => ['red', 'green', 'blue', 'cyan'].includes(c.type));
    style = phys.beamAngle && phys.beamAngle[1] <= 6 ? 'beam' : mix && !gobo ? 'wash' : 'spot';
  }
  const defaults = { moving: [15, 15], bar: [25, 25], strobe: [110, 110], retro: [40, 40], fog: [20, 20], par: [25, 25] };
  const slug = `${manufacturer}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `qxf-${slug}-${modeIndex}`,
    name: `${model} (${mode.attrs.Name || channels.length + 'ch'})`,
    manufacturer,
    source: 'qxf',
    kind,
    ...(style ? { style } : {}),
    pixels,
    ...(kind === 'retro' && !channels.some((c) => ['red', 'green', 'blue'].includes(c.type)) ? { defaultColor: '#ffb347' } : {}),
    beamAngle: phys.beamAngle || defaults[kind] || [25, 25],
    panRange: phys.panRange || 540,
    tiltRange: phys.tiltRange || 270,
    channels,
  };
}
