// GDTF (General Device Type Format, .gdtf) → FreeVisualizer profile.
// A .gdtf file is a ZIP with description.xml; see https://gdtf.eu for the spec.
import { parseXml, child, children, descendants } from './xml-lite.js';
import { readZip, readZipText } from './zip-lite.js';

const COLOR_ADD = {
  ColorAdd_R: 'red', ColorAdd_G: 'green', ColorAdd_B: 'blue', ColorAdd_W: 'white',
  ColorAdd_WW: 'warmWhite', ColorAdd_CW: 'coldWhite', ColorAdd_RY: 'amber', ColorAdd_A: 'amber',
  ColorAdd_GY: 'lime', ColorAdd_UV: 'uv', ColorAdd_C: 'cyan', ColorAdd_M: 'magenta', ColorAdd_Y: 'yellow',
  ColorRGB_Red: 'red', ColorRGB_Green: 'green', ColorRGB_Blue: 'blue',
  ColorSub_C: 'cyan', ColorSub_M: 'magenta', ColorSub_Y: 'yellow',
};

/** CIE 1931 "x,y,Y" (as used by GDTF) → #rrggbb. */
export function cieToHex(str) {
  const [x, y, Yraw] = String(str || '').split(',').map(Number);
  if (!(y > 0)) return '#ffffff';
  const Y = 1;
  const X = (x * Y) / y;
  const Z = ((1 - x - y) * Y) / y;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const m = Math.max(r, g, b, 1e-6);
  [r, g, b] = [r, g, b].map((v) => Math.max(0, v / m));
  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const hex = (v) => Math.round(Math.min(1, gamma(v)) * 255).toString(16).padStart(2, '0');
  void Yraw;
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** "128/1" or "32768/2" → value on a 0–255 scale. */
function dmxValue(s) {
  if (!s) return 0;
  const [v, bytes] = String(s).split('/').map(Number);
  return bytes > 1 ? Math.floor(v / Math.pow(256, bytes - 1)) : v;
}

export async function readGdtf(buffer) {
  const xml = await readZipText(buffer, 'description.xml');
  return parseGdtfXml(xml);
}

/** GDTF Position "{a,b,c,d}{e,f,g,h}{…}{…}" (row major, metres) → 16 numbers. */
function parseMatrix(str) {
  const nums = String(str || '').match(/-?\d+(\.\d+)?(e-?\d+)?/gi);
  if (!nums || nums.length < 16) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return nums.slice(0, 16).map(Number);
}

/**
 * 3D description of a GDTF fixture: model files and the geometry tree
 * (Base → Axis (pan) → Axis (tilt) → Beam …).
 */
export function gdtfGeometry(ft) {
  const models = {};
  for (const m of children(child(ft, 'Models'), 'Model')) {
    models[m.attrs.Name] = {
      file: m.attrs.File || '', length: Number(m.attrs.Length) || 0, width: Number(m.attrs.Width) || 0, height: Number(m.attrs.Height) || 0,
      primitive: m.attrs.PrimitiveType || '',
    };
  }
  const walk = (node) => ({
    tag: node.name, name: node.attrs.Name || '', model: node.attrs.Model || '', matrix: parseMatrix(node.attrs.Position),
    children: node.children.filter((c) => c.name && c.name !== '#text').map(walk),
  });
  const geos = child(ft, 'Geometries');
  return { models, tree: geos ? geos.children.filter((c) => c.name).map(walk) : [] };
}

/** Model files (glb preferred, then 3ds) and the thumbnail inside a .gdtf archive. */
export async function gdtfAssets(buffer, ft) {
  const files = readZip(buffer);
  const find = (re) => [...files.keys()].find((k) => re.test(k));
  const geometry = gdtfGeometry(ft);
  const out = { geometry, files: {}, thumbnail: null };
  for (const [name, m] of Object.entries(geometry.models)) {
    if (!m.file) continue;
    const esc = m.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const glb = find(new RegExp(`(^|/)models/gltf/${esc}\\.glb$`, 'i'));
    const tds = find(new RegExp(`(^|/)models/3ds/${esc}\\.3ds$`, 'i'));
    const key = glb || tds;
    if (key) out.files[name] = { ext: glb ? 'glb' : '3ds', bytes: await files.get(key)() };
  }
  const thumb = find(/(^|\/)thumbnail\.png$/i);
  if (thumb) out.thumbnail = await files.get(thumb)();
  return out;
}

export function parseGdtfXml(xml) {
  const root = parseXml(xml);
  const ft = root.name === 'FixtureType' ? root : child(root, 'FixtureType');
  if (!ft) throw new Error('description.xml nu conține FixtureType');
  return ft;
}

export function listGdtfModes(ft) {
  return children(child(ft, 'DMXModes'), 'DMXMode').map((m, index) => ({
    index, name: m.attrs.Name || `Mod ${index + 1}`, channels: modeChannelCount(ft, m),
  }));
}

function modeChannelCount(ft, mode) {
  return expandChannels(ft, mode).reduce((m, c) => Math.max(m, c.offset + c.bytes - 1), 0);
}

/** Geometry helpers: names of geometries that are referenced as repeated pixels. */
function geometryReferences(ft) {
  return descendants(child(ft, 'Geometries'), 'GeometryReference').map((r) => ({
    name: r.attrs.Name,
    geometry: r.attrs.Geometry,
    breaks: children(r, 'Break').map((b) => ({ dmxBreak: Number(b.attrs.DMXBreak || 1), offset: Number(b.attrs.DMXOffset || 1) })),
  }));
}

/** Absolute channels of a mode: [{ offset (1-based), bytes, def, geometry, pixel }]. */
function expandChannels(ft, mode) {
  const refs = geometryReferences(ft);
  const out = [];
  for (const ch of children(child(mode, 'DMXChannels'), 'DMXChannel')) {
    const offs = String(ch.attrs.Offset || '').split(',').map((v) => Number(v)).filter((v) => v > 0);
    if (!offs.length) continue; // virtual channel
    const base = Math.min(...offs);
    const bytes = offs.length;
    const geo = ch.attrs.Geometry || '';
    const templ = refs.filter((r) => r.geometry === geo);
    if (templ.length) {
      // Channel defined on a template geometry: repeat for every reference.
      templ.forEach((r, i) => {
        const brk = r.breaks.find((b) => b.dmxBreak === Number(ch.attrs.DMXBreak || 1)) || r.breaks[0] || { offset: 1 };
        out.push({ offset: brk.offset + base - 1, bytes, def: ch, geometry: r.name, pixel: i });
      });
    } else {
      out.push({ offset: base, bytes, def: ch, geometry: geo, pixel: null });
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function channelFunctions(ch) {
  const lc = child(ch, 'LogicalChannel');
  return children(lc, 'ChannelFunction');
}

function mainAttribute(ch) {
  const lc = child(ch, 'LogicalChannel');
  return (lc && lc.attrs.Attribute) || (channelFunctions(ch)[0]?.attrs.Attribute) || '';
}

function wheelSlots(ft, name) {
  const wheel = children(child(ft, 'Wheels'), 'Wheel').find((w) => w.attrs.Name === name);
  return wheel ? children(wheel, 'Slot') : [];
}

function functionRanges(ch, bytes) {
  const fns = channelFunctions(ch);
  const starts = fns.map((f) => dmxValue(f.attrs.DMXFrom));
  return fns.map((f, i) => ({ fn: f, from: starts[i], to: i + 1 < fns.length ? Math.max(starts[i], starts[i + 1] - 1) : 255, bytes }));
}

function convert(ft, entry) {
  const ch = entry.def;
  const attr = mainAttribute(ch);
  const label = [entry.geometry, attr].filter(Boolean).join(' ');
  const fine = entry.bytes > 1;
  const extra = [];
  const add = (type, more = {}) => {
    const c = { type, label, ...more };
    if (entry.pixel != null) c.pixel = entry.pixel;
    return [c, ...(fine ? [{ type: type === 'pan' ? 'panFine' : type === 'tilt' ? 'tiltFine' : type === 'dimmer' ? 'dimmerFine' : 'none', label: `${label} fine`, ...(entry.pixel != null ? { pixel: entry.pixel } : {}) }] : []), ...extra].slice(0, entry.bytes);
  };

  if (attr === 'Dimmer') return add('dimmer');
  if (attr === 'Pan') return add('pan');
  if (attr === 'Tilt') return add('tilt');
  if (COLOR_ADD[attr]) return add(COLOR_ADD[attr]);
  if (/^Zoom/.test(attr)) return add('zoom');
  if (/^Prism\d*$/.test(attr)) {
    const ranges = functionRanges(ch, entry.bytes).map((r) => ({ from: r.from, to: r.to, prism: /^Prism/.test(r.fn.attrs.Attribute || '') && !/no|open|off/i.test(r.fn.attrs.Name || '') ? 3 : 0 }));
    return add('prism', { ranges });
  }
  if (/^Color\d+$/.test(attr)) {
    const ranges = [];
    for (const r of functionRanges(ch, entry.bytes)) {
      const fnAttr = r.fn.attrs.Attribute || '';
      const slots = wheelSlots(ft, r.fn.attrs.Wheel);
      const sets = children(r.fn, 'ChannelSet');
      if (/Spin|WheelSpin|Rainbow/.test(fnAttr) || (!slots.length && !sets.length)) { ranges.push({ from: r.from, to: r.to, mode: 'rotate' }); continue; }
      if (sets.length) {
        const setStarts = sets.map((s) => dmxValue(s.attrs.DMXFrom));
        sets.forEach((s, i) => {
          const idx = Number(s.attrs.WheelSlotIndex || 0);
          const slot = slots[idx - 1];
          const to = i + 1 < sets.length ? setStarts[i + 1] - 1 : r.to;
          if (!slot) return;
          ranges.push({ from: setStarts[i], to: Math.max(setStarts[i], to), color: slot.attrs.Color ? cieToHex(slot.attrs.Color) : '#ffffff' });
        });
      } else {
        const step = (r.to - r.from + 1) / slots.length;
        slots.forEach((slot, i) => ranges.push({ from: Math.round(r.from + i * step), to: Math.round(r.from + (i + 1) * step - 1), color: slot.attrs.Color ? cieToHex(slot.attrs.Color) : '#ffffff' }));
      }
    }
    return ranges.length ? add('colorWheel', { ranges }) : add('none');
  }
  if (/^Gobo\d+$/.test(attr)) {
    const ranges = [];
    for (const r of functionRanges(ch, entry.bytes)) {
      const fnAttr = r.fn.attrs.Attribute || '';
      const sets = children(r.fn, 'ChannelSet');
      if (sets.length && !/Spin|Shake/.test(fnAttr)) {
        const setStarts = sets.map((s) => dmxValue(s.attrs.DMXFrom));
        sets.forEach((s, i) => {
          const idx = Number(s.attrs.WheelSlotIndex || 1);
          ranges.push({ from: setStarts[i], to: Math.max(setStarts[i], i + 1 < sets.length ? setStarts[i + 1] - 1 : r.to), gobo: Math.max(0, idx - 1) });
        });
      } else {
        ranges.push({ from: r.from, to: r.to, gobo: 1, ...(/Shake/.test(fnAttr) ? { shake: true } : { rotate: true }) });
      }
    }
    return add('gobo', { ranges });
  }
  if (/^Shutter\d*$|Strobe/.test(attr)) {
    const ranges = functionRanges(ch, entry.bytes).map((r) => {
      const a = r.fn.attrs.Attribute || '';
      const name = (r.fn.attrs.Name || '').toLowerCase();
      const hzFrom = Number(r.fn.attrs.PhysicalFrom); const hzTo = Number(r.fn.attrs.PhysicalTo);
      const hz = (hzFrom > 0 || hzTo > 0) && Math.max(hzFrom, hzTo) <= 60 ? { hzFrom: Math.max(0.2, hzFrom || 1), hzTo: Math.max(0.2, hzTo || 20) } : { hzFrom: 1, hzTo: 20 };
      if (/Random/.test(a)) return { from: r.from, to: r.to, mode: 'random', ...hz };
      if (/Pulse|Ramp/.test(a)) return { from: r.from, to: r.to, mode: 'pulse', ...hz };
      if (/Strobe/.test(a)) return { from: r.from, to: r.to, mode: 'strobe', ...hz };
      if (/clos/.test(name)) return { from: r.from, to: r.to, mode: 'closed' };
      return { from: r.from, to: r.to, mode: 'open' };
    });
    return add('strobe', { ranges });
  }
  if (/Fog|Haze/i.test(attr)) return add('fog');
  return add('none');
}

function beamAngles(ft) {
  const beams = descendants(child(ft, 'Geometries'), 'Beam');
  if (!beams.length) return null;
  const a = Number(beams[0].attrs.BeamAngle || beams[0].attrs.FieldAngle);
  return a > 0 ? [a, a] : null;
}

function physicalRange(ft, attrName) {
  for (const ch of descendants(child(ft, 'DMXModes'), 'DMXChannel')) {
    if (mainAttribute(ch) !== attrName) continue;
    const f = channelFunctions(ch)[0];
    if (!f) continue;
    const a = Number(f.attrs.PhysicalFrom); const b = Number(f.attrs.PhysicalTo);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return Math.abs(b - a);
  }
  return null;
}

export function gdtfToProfile(ft, modeIndex = 0) {
  const mode = children(child(ft, 'DMXModes'), 'DMXMode')[modeIndex];
  if (!mode) throw new Error('Modul selectat nu există');
  const entries = expandChannels(ft, mode);
  const channels = [];
  for (const e of entries) {
    while (channels.length < e.offset - 1) channels.push({ type: 'none', label: '' });
    const conv = convert(ft, e);
    conv.forEach((c, k) => { channels[e.offset - 1 + k] = c; });
  }
  for (let i = 0; i < channels.length; i++) if (!channels[i]) channels[i] = { type: 'none', label: '' };

  const pixelCount = channels.reduce((m, c) => (c.pixel != null ? Math.max(m, c.pixel + 1) : m), 0);
  const hasPanTilt = channels.some((c) => c.type === 'pan' || c.type === 'tilt');
  const name = ft.attrs.LongName || ft.attrs.Name || 'Fixtură GDTF';
  const manufacturer = ft.attrs.Manufacturer || '';
  let kind = 'par';
  if (hasPanTilt) kind = 'moving';
  else if (pixelCount === 7) kind = 'retro';
  else if (pixelCount > 1) kind = 'bar';
  else if (channels.some((c) => c.type === 'fog')) kind = 'fog';
  else if (/strob/i.test(name) && !channels.some((c) => ['red', 'green', 'blue'].includes(c.type))) kind = 'strobe';
  const zoomRange = physicalRange(ft, 'Zoom');
  let beamAngle = beamAngles(ft) || ({ moving: [15, 15], bar: [25, 25], retro: [40, 40], strobe: [110, 110] }[kind] || [25, 25]);
  if (zoomRange && channels.some((c) => c.type === 'zoom')) {
    const zf = channelFunctions(descendants(mode, 'DMXChannel').find((c) => mainAttribute(c) === 'Zoom'))[0];
    if (zf) beamAngle = [Number(zf.attrs.PhysicalFrom) || beamAngle[0], Number(zf.attrs.PhysicalTo) || beamAngle[1]].sort((a, b) => a - b);
  }
  let style;
  if (kind === 'moving') {
    const gobo = channels.some((c) => c.type === 'gobo');
    const mix = channels.some((c) => ['red', 'green', 'blue', 'cyan'].includes(c.type));
    style = beamAngle[1] <= 6 ? 'beam' : mix && !gobo ? 'wash' : 'spot';
  }
  const slug = `${manufacturer}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `gdtf-${slug}-${modeIndex}`,
    name: `${name} (${mode.attrs.Name || channels.length + 'ch'})`,
    manufacturer,
    source: 'gdtf',
    kind,
    ...(style ? { style } : {}),
    pixels: Math.max(1, pixelCount || (kind === 'bar' ? 8 : 1)),
    ...(kind === 'retro' && !channels.some((c) => ['red', 'green', 'blue'].includes(c.type)) ? { defaultColor: '#ffb347' } : {}),
    beamAngle,
    panRange: physicalRange(ft, 'Pan') || 540,
    tiltRange: physicalRange(ft, 'Tilt') || 270,
    channels,
  };
}
