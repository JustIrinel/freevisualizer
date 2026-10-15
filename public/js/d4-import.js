// Avolites personality (.d4, the format Fixture.ID and the Avolites library
// use) → FreeVisualizer profile.
//
// Layout (as read by QLC+'s AvolitesD4Parser):
//   <Fixture Name Company>
//     <Control><Attribute ID Name Group="I|P|C|G|B|E|S"><Function Name Dmx="0~255"/></Attribute></Control>
//     <Mode Name>
//       <Physical><Lens Degrees="a~b"/><Focus PanMax TiltMax/></Physical>
//       <Include><Attribute ID ChannelOffset="0" | "1,2"/></Include>
//     </Mode>
//   </Fixture>
// Two offsets = coarse + fine (16 bit). Dmx values can be 16 bit and min/max
// may be swapped. Attributes nested one level deeper inside <Include> belong
// to a cell (pixel).
import { parseXml, child, children, descendants } from './xml-lite.js';
import { DEFAULT_STROBE_RANGES, rotationRanges } from './profiles.js';
import { tr } from './i18n.js';

const COLOR_NAMES = [
  [/uv|black ?light|ultra ?violet/, '#7a3cff'],
  [/cto|warm|3200|tungsten|amber/, '#ffb347'],
  [/ctb|cool|5600|6500|daylight/, '#cfe4ff'],
  [/light ?blue|sky|aqua|turq/, '#40c0ff'],
  [/dark ?blue|congo|deep ?blue|navy/, '#1020ff'],
  [/lavender|lilac/, '#b080ff'],
  [/purple|violet/, '#8020ff'],
  [/magenta|pink|rose/, '#ff40c0'],
  [/orange/, '#ff8000'],
  [/light ?green|lime/, '#80ff40'],
  [/dark ?green/, '#008020'],
  [/green/, '#00ff00'],
  [/cyan/, '#00ffff'],
  [/yellow|gold/, '#ffff00'],
  [/red/, '#ff0000'],
  [/blue/, '#0040ff'],
  [/white|open|no ?colou?r/, '#ffffff'],
];

const MIX = [
  ['warmWhite', /warm ?white|ww\b/], ['coldWhite', /cold ?white|cool ?white|cw\b/],
  ['red', /red/], ['green', /green/], ['blue', /blue/], ['white', /white/], ['amber', /amber/],
  ['uv', /\buv\b|ultra/], ['lime', /lime/], ['cyan', /cyan/], ['magenta', /magenta/], ['yellow', /yellow/],
];

function nameToColor(name) {
  const n = name.toLowerCase();
  for (const [re, hex] of COLOR_NAMES) if (re.test(n)) return hex;
  return null;
}

/** "0~255" / "65535~0" → { from, to } in 8 bit. */
function dmxRange(s) {
  const parts = String(s || '').split('~').map((v) => Number(v.trim()));
  if (!parts.length || parts.some((v) => !Number.isFinite(v))) return null;
  const sixteen = parts.some((v) => v > 255);
  let [a, b = a] = parts.map((v) => (sixteen ? v >> 8 : v));
  if (a > b) [a, b] = [b, a];
  return { from: Math.max(0, Math.min(255, a)), to: Math.max(0, Math.min(255, b)) };
}

function functionsOf(attr) {
  return children(attr, 'Function')
    .map((f) => ({ name: f.attrs.Name || '', range: dmxRange(f.attrs.Dmx) }))
    .filter((f) => f.range)
    .sort((a, b) => a.range.from - b.range.from);
}

function strobeRanges(funcs) {
  if (funcs.length <= 1) return DEFAULT_STROBE_RANGES.map((r) => ({ ...r }));
  return funcs.map(({ name, range: { from, to } }) => {
    const n = name.toLowerCase();
    if (/close|blackout|shut\b|off/.test(n)) return { from, to, mode: 'closed' };
    if (/random/.test(n)) return { from, to, mode: 'random', hzFrom: 1, hzTo: 20 };
    if (/pulse|ramp|lightning/.test(n)) return { from, to, mode: 'pulse', hzFrom: 1, hzTo: 15 };
    if (/strob/.test(n)) {
      const fastFirst = /fast.*slow/.test(n);
      return { from, to, mode: 'strobe', hzFrom: fastFirst ? 20 : 1, hzTo: fastFirst ? 1 : 20 };
    }
    return { from, to, mode: 'open' };
  });
}

/** Function name → rotation: index, stop or rotation with direction (null when it says nothing). */
function rotationOfName(name) {
  const n = name.toLowerCase();
  if (/stop|no rot|static/.test(n)) return { stop: true };
  if (/index|position|angle|\bpos\b/.test(n)) return { index: true };
  const ccw = /ccw|counter|anti|reverse|left/.test(n);
  if (ccw || /\bcw\b|clockwise|rotat|spin|right/.test(n)) return { rotate: ccw ? -1 : 1, ...(/fast.*slow/.test(n) ? { fastToSlow: true } : {}) };
  return null;
}

function rotationRangesOf(funcs) {
  const known = funcs.map((f) => ({ ...f.range, ...(rotationOfName(f.name) || { stop: true }) }));
  // One vague "Rotate" function over the whole range: use the usual layout instead.
  if (funcs.length <= 1) return rotationRanges();
  return known;
}

/** One <Control><Attribute> → our channel description (coarse). */
function convertAttribute(attr) {
  const id = attr.attrs.ID || '';
  const name = attr.attrs.Name || id;
  const group = (attr.attrs.Group || '').toUpperCase();
  const text = `${id} ${name}`.toLowerCase();
  const funcs = functionsOf(attr);
  const base = { label: name };

  // Gobo / prism rotation and index.
  if (/gobo|prism/.test(text) && /rotat|index|spin|\bpos\b|rot\b/.test(text) && !/speed|macro|reset/.test(text)) {
    const prism = /prism/.test(text);
    const two = /(gobo|prism) ?2|2rot/.test(text);
    const type = prism ? (two ? 'prism2Rot' : 'prismRot') : two ? 'gobo2Rot' : 'goboRot';
    return { type, ...base, ranges: rotationRangesOf(funcs) };
  }
  if (/frost|diffus/.test(text)) return { type: 'frost', ...base };
  // Speeds, macros, rotations and maintenance channels have no visual effect here.
  if (/speed|macro|reset|lamp|control|mode|reserved|rotat|index|shake|\bfx\b/.test(text) && !/^(dimmer|pan|tilt)\b/.test(text)) return { type: 'none', ...base };
  if (/^pan|\bpan\b/.test(text) && !/tilt/.test(text)) return { type: 'pan', ...base };
  if (/^tilt|\btilt\b/.test(text)) return { type: 'tilt', ...base };
  if (/shutter|strob/.test(text)) return { type: 'strobe', ...base, ranges: strobeRanges(funcs) };
  if (/dimmer|intensity|master/.test(text) || (group === 'I' && !MIX.some(([, re]) => re.test(text)))) return { type: 'dimmer', ...base };
  if (/fog|smoke|haze|pump/.test(text)) return { type: 'fog', ...base };
  if (/zoom/.test(text)) return { type: 'zoom', ...base };
  if (/prism/.test(text)) {
    let last = 3;
    const ranges = funcs.map((f) => {
      if (/open|off|out|no /i.test(f.name)) return { ...f.range, prism: 0 };
      const rot = rotationOfName(f.name);
      const m = /(\d+)/.exec(f.name);
      if (m && !rot) last = Math.max(2, Math.min(16, Number(m[1])));
      return { ...f.range, prism: last, ...(/linear/i.test(f.name) ? { shape: 'linear' } : {}), ...(rot && !rot.index && !rot.stop ? rot : {}) };
    });
    return { type: /prism ?2/.test(text) ? 'prism2' : 'prism', ...base, ranges: ranges.length ? ranges : [{ from: 0, to: 127, prism: 0 }, { from: 128, to: 255, prism: 3 }] };
  }
  if (/gobo/.test(text) || group === 'G') {
    let n = 0;
    const ranges = funcs.map((f) => {
      const fn = f.name.toLowerCase();
      if (/open|no gobo|white/.test(fn)) return { ...f.range, gobo: 0 };
      if (/scroll|rotat|cycle|rainbow/.test(fn)) return { ...f.range, gobo: 1, rotate: true };
      const m = /(\d+)/.exec(fn);
      return { ...f.range, gobo: m ? Number(m[1]) : ++n, ...(/shake/.test(fn) ? { shake: true } : {}) };
    });
    return ranges.length ? { type: /gobo ?2|static gobo/.test(text) ? 'gobo2' : 'gobo', ...base, ranges } : { type: 'none', ...base };
  }
  // Colour mixing channels (RGB/W/A/UV/CMY…), then colour wheels.
  const mix = MIX.find(([, re]) => re.test(text));
  if (mix && !/wheel|colou?r ?\d|^colou?r$/.test(text)) return { type: mix[0], ...base };
  if (/colou?r|wheel/.test(text) || group === 'C') {
    const ranges = funcs.map((f) => {
      if (/rainbow|scroll|rotat|cycle|spin/i.test(f.name)) return { ...f.range, mode: 'rotate' };
      const parts = f.name.split(/\s*[/+&]\s*|\s+and\s+/i);
      const color = nameToColor(parts[0]) || '#ffffff';
      const second = parts.length > 1 ? nameToColor(parts[1]) : null;
      return { ...f.range, color, ...(second && second !== color ? { split: second } : {}) };
    });
    return ranges.length ? { type: 'colorWheel', ...base, ranges } : { type: 'none', ...base };
  }
  return { type: 'none', ...base };
}

const FINE = { dimmer: 'dimmerFine', pan: 'panFine', tilt: 'tiltFine' };

export function parseD4(text) {
  const root = parseXml(text);
  if (root.name !== 'Fixture') throw new Error(tr('Fișierul nu este o personalitate Avolites (.d4)'));
  return root;
}

export function isD4Xml(text) {
  return /<Fixture[\s>]/.test(text.slice(0, 2000)) && !/<FixtureDefinition[\s>]/.test(text.slice(0, 2000));
}

/** Mode attribute references → [{ id, offsets: [n, n?], cell }]. */
function modeEntries(mode) {
  const out = [];
  const include = child(mode, 'Include');
  if (!include) return out;
  let cell = -1;
  for (const node of include.children) {
    if (node.name === 'Attribute') {
      if (node.attrs.ChannelOffset != null && node.attrs.ChannelOffset !== '') out.push({ id: node.attrs.ID, offsets: node.attrs.ChannelOffset.split(',').map(Number), cell: null });
    } else {
      // A cell (pixel) group: every attribute inside belongs to it.
      cell += 1;
      for (const a of descendants(node, 'Attribute')) {
        if (a.attrs.ChannelOffset == null || a.attrs.ChannelOffset === '') continue;
        out.push({ id: a.attrs.ID, offsets: a.attrs.ChannelOffset.split(',').map(Number), cell });
      }
    }
  }
  return out.filter((e) => e.offsets.every(Number.isFinite));
}

export function listD4Modes(root) {
  return children(root, 'Mode').map((m, index) => {
    const entries = modeEntries(m);
    const offs = entries.flatMap((e) => e.offsets);
    const base = offs.includes(0) ? 0 : Math.min(...offs, 1);
    return { index, name: m.attrs.Name || tr('Mod {n}', { n: index + 1 }), channels: offs.length ? Math.max(...offs) - base + 1 : 0 };
  });
}

function physical(mode, root) {
  const out = {};
  for (const phys of [child(root, 'Physical'), child(mode, 'Physical')]) {
    if (!phys) continue;
    const lens = child(phys, 'Lens');
    if (lens && lens.attrs.Degrees) {
      const d = lens.attrs.Degrees.split('~').map(Number).filter((v) => v > 0).sort((a, b) => a - b);
      if (d.length) out.beamAngle = [d[0], d[d.length - 1]];
    }
    const focus = child(phys, 'Focus');
    if (focus) {
      if (Number(focus.attrs.PanMax) > 0) out.panRange = Number(focus.attrs.PanMax);
      if (Number(focus.attrs.TiltMax) > 0) out.tiltRange = Number(focus.attrs.TiltMax);
    }
  }
  return out;
}

export function d4ToProfile(root, modeIndex = 0) {
  const mode = children(root, 'Mode')[modeIndex];
  if (!mode) throw new Error(tr('Modul selectat nu există'));
  const defs = new Map();
  for (const control of children(root, 'Control')) for (const a of children(control, 'Attribute')) if (a.attrs.ID) defs.set(a.attrs.ID, a);

  const entries = modeEntries(mode);
  const offs = entries.flatMap((e) => e.offsets);
  if (!offs.length) throw new Error(tr('Modul nu are canale'));
  const base = offs.includes(0) ? 0 : Math.min(...offs);
  const channels = [];
  for (const e of entries) {
    const def = defs.get(e.id);
    const conv = def ? convertAttribute(def) : { type: 'none', label: e.id };
    const [coarse, fine] = e.offsets.map((o) => o - base);
    channels[coarse] = { ...conv, ...(e.cell != null ? { pixel: e.cell } : {}) };
    if (fine != null) channels[fine] = { type: FINE[conv.type] || 'none', label: `${conv.label} fine`, ...(e.cell != null ? { pixel: e.cell } : {}) };
  }
  for (let i = 0; i < channels.length; i++) if (!channels[i]) channels[i] = { type: 'none', label: '' };

  const cells = new Set(entries.filter((e) => e.cell != null).map((e) => e.cell)).size;
  if (cells <= 1) channels.forEach((c) => { delete c.pixel; });
  const name = root.attrs.Name || tr('Fixtură');
  const manufacturer = root.attrs.Company || '';
  const hasPanTilt = channels.some((c) => c.type === 'pan' || c.type === 'tilt');
  const hasMix = channels.some((c) => ['red', 'green', 'blue'].includes(c.type));
  let kind = 'par';
  if (hasPanTilt) kind = 'moving';
  else if (cells === 7) kind = 'retro';
  else if (cells > 1) kind = 'bar';
  else if (channels.some((c) => c.type === 'fog')) kind = 'fog';
  else if (/strob/i.test(name) && !hasMix) kind = 'strobe';
  else if (/blinder/i.test(name)) kind = 'blinder';
  const phys = physical(mode, root);
  const beamAngle = phys.beamAngle || ({ moving: [15, 15], bar: [25, 25], retro: [40, 40], strobe: [110, 110], blinder: [60, 60] }[kind] || [25, 25]);
  let style;
  if (kind === 'moving') {
    const gobo = channels.some((c) => c.type === 'gobo');
    style = beamAngle[1] <= 6 ? 'beam' : (hasMix || channels.some((c) => c.type === 'cyan')) && !gobo ? 'wash' : 'spot';
  }
  const slug = `${manufacturer}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `d4-${slug}-${modeIndex}`,
    name: `${name} (${mode.attrs.Name || channels.length + 'ch'})`,
    manufacturer,
    source: 'd4',
    kind,
    ...(style ? { style } : {}),
    pixels: cells > 1 ? cells : kind === 'bar' ? 8 : 1,
    ...(kind === 'retro' && !hasMix ? { defaultColor: '#ffb347' } : {}),
    beamAngle,
    panRange: phys.panRange || 540,
    tiltRange: phys.tiltRange || 270,
    channels,
  };
}
