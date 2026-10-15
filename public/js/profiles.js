// Fixture profiles: channel types, built-in generic library and helpers.
// A profile describes the DMX layout of a fixture and how it should look in 3D.
// Every fixture emits light along its local +Y axis.
import { tr } from './i18n.js';

export const KINDS = {
  par: 'Par / Uplight',
  moving: 'Moving head',
  bar: tr('Bară LED (pixeli)'),
  strobe: tr('Stroboscop'),
  blinder: 'Blinder',
  retro: tr('Retro hexagonal (7 capete)'),
  pinspot: tr('Pinspot (pentru glob)'),
  spark: tr('Mașină scântei reci'),
  lowfog: tr('Fum greu (nor jos)'),
  laser: 'Laser',
  fog: tr('Mașină de fum'),
};

export const MOVING_STYLES = { spot: 'Spot', beam: 'Beam', wash: 'Wash' };

// type -> [label, group]
export const CHANNEL_TYPES = {
  none: [tr('— (ignorat)'), tr('Altele')],
  dimmer: ['Dimmer', tr('Intensitate')],
  dimmerFine: ['Dimmer fine', tr('Intensitate')],
  strobe: ['Strobe / Shutter', tr('Intensitate')],
  red: [tr('Roșu'), tr('Culoare')],
  green: [tr('Verde'), tr('Culoare')],
  blue: [tr('Albastru'), tr('Culoare')],
  white: [tr('Alb'), tr('Culoare')],
  warmWhite: [tr('Alb cald'), tr('Culoare')],
  coldWhite: [tr('Alb rece'), tr('Culoare')],
  amber: ['Amber', tr('Culoare')],
  uv: ['UV', tr('Culoare')],
  lime: ['Lime', tr('Culoare')],
  cyan: ['Cyan (CMY)', tr('Culoare')],
  magenta: ['Magenta (CMY)', tr('Culoare')],
  yellow: [tr('Galben (CMY)'), tr('Culoare')],
  colorWheel: [tr('Roată de culori'), tr('Culoare')],
  pan: ['Pan', tr('Mișcare')],
  panFine: ['Pan fine', tr('Mișcare')],
  tilt: ['Tilt', tr('Mișcare')],
  tiltFine: ['Tilt fine', tr('Mișcare')],
  gobo: [tr('Gobo (roata 1)'), tr('Fascicul')],
  goboRot: [tr('Rotație gobo (roata 1)'), tr('Fascicul')],
  gobo2: [tr('Gobo (roata 2)'), tr('Fascicul')],
  gobo2Rot: [tr('Rotație gobo (roata 2)'), tr('Fascicul')],
  prism: [tr('Prismă'), tr('Fascicul')],
  prismRot: [tr('Rotație prismă'), tr('Fascicul')],
  prism2: [tr('Prismă 2'), tr('Fascicul')],
  prism2Rot: [tr('Rotație prismă 2'), tr('Fascicul')],
  frost: ['Frost', tr('Fascicul')],
  zoom: ['Zoom', tr('Fascicul')],
  fog: [tr('Fum (output)'), tr('Efecte')],
  sparkHeight: [tr('Scântei – înălțime'), tr('Efecte')],
  sparkFire: [tr('Scântei – declanșare'), tr('Efecte')],
  laserPattern: [tr('Laser – model'), tr('Efecte')],
  laserRotate: [tr('Laser – rotație'), tr('Efecte')],
};

export const DEFAULT_STROBE_RANGES = [
  { from: 0, to: 9, mode: 'open' },
  { from: 10, to: 255, mode: 'strobe', hzFrom: 1, hzTo: 25 },
];

export const DEFAULT_WHEEL = ['#ffffff', '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0040ff', '#ff00ff', '#ff60a0'];

/** Evenly divide 0..255 between colors, like most cheap color wheels. */
export function wheelRanges(colors, end = 127) {
  const step = Math.floor((end + 1) / colors.length);
  const ranges = colors.map((color, i) => ({ from: i * step, to: i === colors.length - 1 ? end : (i + 1) * step - 1, color }));
  if (end < 255) ranges.push({ from: end + 1, to: 255, mode: 'rotate' });
  return ranges;
}

export function goboRanges(count, end = 127) {
  const step = Math.floor((end + 1) / count);
  const ranges = [];
  for (let i = 0; i < count; i++) ranges.push({ from: i * step, to: i === count - 1 ? end : (i + 1) * step - 1, gobo: i });
  if (end < 255) ranges.push({ from: end + 1, to: 255, gobo: 1, shake: true });
  return ranges;
}

/** Gobo wheel whose upper half rotates each gobo (slow → fast), like many budget spots. */
export function rotatingGoboRanges(count) {
  const ranges = goboRanges(count).slice(0, count);
  const n = count - 1; // slot 0 is open
  const step = Math.floor(128 / n);
  for (let i = 0; i < n; i++) ranges.push({ from: 128 + i * step, to: i === n - 1 ? 255 : 128 + (i + 1) * step - 1, gobo: i + 1, rotate: 1 });
  return ranges;
}

/** Usual gobo / prism rotation channel: index, CW fast → slow, stop, CCW slow → fast. */
export function rotationRanges() {
  return [
    { from: 0, to: 127, index: true },
    { from: 128, to: 189, rotate: 1, fastToSlow: true },
    { from: 190, to: 193, stop: true },
    { from: 194, to: 255, rotate: -1 },
  ];
}

export function prismRanges(facets, shape = 'circular') {
  return [{ from: 0, to: 127, prism: 0 }, { from: 128, to: 255, prism: facets, ...(shape === 'linear' ? { shape } : {}) }];
}

function laserColors() {
  const colors = ['#ff0000', '#00ff00', '#ffff00', '#0040ff', '#ff00ff', '#00ffff', '#ffffff'];
  return [...wheelRanges(colors, 223).slice(0, colors.length), { from: 224, to: 255, mode: 'rotate' }];
}

const ch = (type, extra) => ({ type, ...(extra || {}) });
const strobe = () => ch('strobe', { ranges: DEFAULT_STROBE_RANGES.map((r) => ({ ...r })) });
const pixelRGB = (n) => {
  const out = [];
  for (let p = 0; p < n; p++) out.push(ch('red', { pixel: p }), ch('green', { pixel: p }), ch('blue', { pixel: p }));
  return out;
};

const pixelDimmers = (n) => Array.from({ length: n }, (_, p) => ch('dimmer', { pixel: p }));
const pixelColors = (n, types) => {
  const out = [];
  for (let p = 0; p < n; p++) for (const t of types) out.push(ch(t, { pixel: p }));
  return out;
};

const generic = (p) => ({ manufacturer: 'Generic', source: 'builtin', pixels: 1, beamAngle: [25, 25], panRange: 540, tiltRange: 270, ...p });

export const BUILTIN_PROFILES = [
  generic({ id: 'gen-par-rgb-3', name: 'Par LED RGB 3ch', kind: 'par', beamAngle: [25, 25], channels: [ch('red'), ch('green'), ch('blue')] }),
  generic({ id: 'gen-par-rgbw-4', name: 'Par LED RGBW 4ch', kind: 'par', channels: [ch('red'), ch('green'), ch('blue'), ch('white')] }),
  generic({ id: 'gen-par-rgb-7', name: tr('Par LED RGB 7ch (D,R,G,B,Strobe,Mod,Viteză)'), kind: 'par', channels: [ch('dimmer'), ch('red'), ch('green'), ch('blue'), strobe(), ch('none', { label: tr('Mod') }), ch('none', { label: tr('Viteză') })] }),
  generic({ id: 'gen-par-rgbw-8', name: tr('Par LED RGBW 8ch (D,R,G,B,W,Strobe,Mod,Viteză)'), kind: 'par', channels: [ch('dimmer'), ch('red'), ch('green'), ch('blue'), ch('white'), strobe(), ch('none', { label: tr('Mod') }), ch('none', { label: tr('Viteză') })] }),
  generic({ id: 'gen-par-rgbwauv-6', name: 'Uplight RGBWA+UV 6ch', kind: 'par', beamAngle: [30, 30], channels: [ch('red'), ch('green'), ch('blue'), ch('white'), ch('amber'), ch('uv')] }),
  generic({ id: 'gen-par-rgbwauv-10', name: tr('Uplight RGBWA+UV 10ch (D,R,G,B,W,A,UV,Strobe,Mod,Viteză)'), kind: 'par', beamAngle: [30, 30], channels: [ch('dimmer'), ch('red'), ch('green'), ch('blue'), ch('white'), ch('amber'), ch('uv'), strobe(), ch('none', { label: tr('Mod') }), ch('none', { label: tr('Viteză') })] }),
  generic({ id: 'gen-dimmer-1', name: tr('Dimmer / Par halogen 1ch'), kind: 'par', defaultColor: '#ffc27a', beamAngle: [20, 20], channels: [ch('dimmer')] }),
  generic({
    id: 'gen-mh-spot-11', name: 'Moving Head Spot 11ch', kind: 'moving', style: 'spot', beamAngle: [14, 14],
    channels: [ch('pan'), ch('panFine'), ch('tilt'), ch('tiltFine'), ch('colorWheel', { ranges: wheelRanges(DEFAULT_WHEEL) }), ch('gobo', { ranges: rotatingGoboRanges(8) }), strobe(), ch('dimmer'), ch('none', { label: tr('Viteză P/T') }), ch('none', { label: 'Auto' }), ch('none', { label: 'Reset' })],
  }),
  generic({
    id: 'gen-mh-beam-16', name: 'Moving Head Beam 16ch', kind: 'moving', style: 'beam', beamAngle: [3, 3],
    channels: [ch('colorWheel', { ranges: wheelRanges(['#ffffff', '#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0040ff', '#ff00ff', '#b0ffb0', '#ff60a0', '#8000ff', '#ffd090', '#40a0ff', '#ff4000']) }), strobe(), ch('dimmer'), ch('gobo', { ranges: goboRanges(14) }), ch('prism', { ranges: prismRanges(8) }), ch('prismRot', { ranges: rotationRanges() }), ch('frost'), ch('none', { label: 'Focus' }), ch('pan'), ch('panFine'), ch('tilt'), ch('tiltFine'), ch('none', { label: tr('Viteză P/T') }), ch('none', { label: 'Reset' }), ch('none', { label: tr('Lampă') }), ch('none', { label: tr('Funcții') })],
  }),
  generic({
    id: 'gen-mh-spot-2g2p-20', name: tr('Moving Head Spot 20ch – 2 roți gobo + 2 prisme'), kind: 'moving', style: 'spot', beamAngle: [10, 32],
    channels: [
      ch('pan'), ch('panFine'), ch('tilt'), ch('tiltFine'), ch('none', { label: tr('Viteză P/T') }), ch('dimmer'), strobe(),
      ch('colorWheel', { ranges: wheelRanges(DEFAULT_WHEEL) }),
      ch('gobo', { ranges: goboRanges(8) }), ch('goboRot', { ranges: rotationRanges() }),
      ch('gobo2', { ranges: goboRanges(10) }), ch('gobo2Rot', { ranges: rotationRanges() }),
      ch('prism', { ranges: prismRanges(3) }), ch('prismRot', { ranges: rotationRanges() }),
      ch('prism2', { ranges: prismRanges(4, 'linear') }), ch('prism2Rot', { ranges: rotationRanges() }),
      ch('frost'), ch('none', { label: 'Focus' }), ch('zoom'), ch('none', { label: 'Reset' }),
    ],
  }),
  generic({
    id: 'gen-mh-wash-14', name: 'Moving Head Wash RGBW Zoom 14ch', kind: 'moving', style: 'wash', beamAngle: [8, 45],
    channels: [ch('pan'), ch('panFine'), ch('tilt'), ch('tiltFine'), ch('none', { label: tr('Viteză P/T') }), ch('dimmer'), strobe(), ch('red'), ch('green'), ch('blue'), ch('white'), ch('zoom'), ch('none', { label: tr('Macro culori') }), ch('none', { label: 'Reset' })],
  }),
  generic({ id: 'gen-bar-8x-rgb-24', name: tr('Bară LED 8 pixeli RGB 24ch'), kind: 'bar', pixels: 8, beamAngle: [25, 25], channels: pixelRGB(8) }),
  generic({ id: 'gen-bar-8x-rgb-26', name: tr('Bară LED 8 pixeli RGB 26ch (D,Strobe + 8×RGB)'), kind: 'bar', pixels: 8, beamAngle: [25, 25], channels: [ch('dimmer'), strobe(), ...pixelRGB(8)] }),
  generic({ id: 'gen-bar-rgb-3', name: tr('Bară LED RGB 3ch (fără pixeli)'), kind: 'bar', pixels: 8, beamAngle: [25, 25], channels: [ch('red'), ch('green'), ch('blue')] }),
  generic({ id: 'gen-strobe-2', name: tr('Stroboscop LED 2ch (Dimmer, Viteză)'), kind: 'strobe', beamAngle: [110, 110], channels: [ch('dimmer'), strobe()] }),
  generic({ id: 'gen-strobe-rgb-6', name: tr('Stroboscop RGB 6ch (D,Strobe,R,G,B,W)'), kind: 'strobe', beamAngle: [110, 110], channels: [ch('dimmer'), strobe(), ch('red'), ch('green'), ch('blue'), ch('white')] }),
  generic({ id: 'gen-blinder-2', name: tr('Blinder 2 lămpi 2ch'), kind: 'blinder', pixels: 2, defaultColor: '#ffb060', beamAngle: [60, 60], channels: [ch('dimmer', { pixel: 0 }), ch('dimmer', { pixel: 1 })] }),
  generic({ id: 'gen-retro-7', name: tr('Retro hexagonal 7 capete 7ch (dimmer pe cap)'), kind: 'retro', pixels: 7, defaultColor: '#ffb347', beamAngle: [40, 40], channels: pixelDimmers(7) }),
  generic({ id: 'gen-retro-9', name: tr('Retro hexagonal 7 capete 9ch (Dimmer, Strobe, 7 capete)'), kind: 'retro', pixels: 7, defaultColor: '#ffb347', beamAngle: [40, 40], channels: [ch('dimmer'), strobe(), ...pixelDimmers(7)] }),
  generic({ id: 'gen-retro-rgb-21', name: tr('Retro 7×60W RGB 21ch (RGB pe cap)'), kind: 'retro', pixels: 7, tungsten: false, beamAngle: [40, 40], channels: pixelRGB(7) }),
  generic({ id: 'gen-retro-rgbw-30', name: tr('Retro 7 capete RGB + alb cald 30ch (D, Strobe, 7×RGBW)'), kind: 'retro', pixels: 7, tungsten: false, beamAngle: [40, 40], channels: [ch('dimmer'), strobe(), ...pixelColors(7, ['red', 'green', 'blue', 'warmWhite'])] }),
  generic({ id: 'gen-pinspot-1', name: tr('Pinspot alb 1ch (pentru glob disco)'), kind: 'pinspot', defaultColor: '#fff1d6', beamAngle: [5, 5], channels: [ch('dimmer')] }),
  generic({ id: 'gen-pinspot-rgbw-4', name: 'Pinspot RGBW 4ch', kind: 'pinspot', beamAngle: [5, 5], channels: [ch('red'), ch('green'), ch('blue'), ch('white')] }),
  generic({ id: 'gen-spark-2', name: tr('Mașină scântei reci 2ch (Înălțime, Declanșare)'), kind: 'spark', channels: [ch('sparkHeight'), ch('sparkFire')] }),
  generic({ id: 'gen-lowfog-1', name: tr('Fum greu / gheață carbonică 1ch'), kind: 'lowfog', channels: [ch('fog')] }),
  generic({
    id: 'gen-laser-6', name: tr('Laser RGB 6ch (Mod, Model, Culoare, Rotație, Deschidere, Viteză)'), kind: 'laser', beamAngle: [10, 90],
    channels: [ch('dimmer', { label: tr('Mod (0 = oprit)') }), ch('laserPattern'), ch('colorWheel', { ranges: laserColors() }), ch('laserRotate'), ch('zoom', { label: tr('Deschidere') }), ch('none', { label: tr('Viteză') })],
  }),
  generic({ id: 'gen-fog-1', name: tr('Mașină de fum 1ch'), kind: 'fog', channels: [ch('fog')] }),
];

export function channelCount(profile) {
  return profile.channels.length;
}

export function channelLabel(c) {
  const base = (CHANNEL_TYPES[c.type] || [c.type])[0];
  const label = c.label && c.type === 'none' ? c.label : c.label ? `${base} (${c.label})` : base;
  return c.pixel != null ? `${label} · px ${c.pixel + 1}` : label;
}

export function cloneProfile(p) {
  return JSON.parse(JSON.stringify(p));
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

/** Make sure a (possibly hand-edited or imported) profile has every field we rely on. */
export function normalizeProfile(p) {
  const out = { pixels: 1, beamAngle: [25, 25], panRange: 540, tiltRange: 270, manufacturer: '', ...p };
  if (!KINDS[out.kind]) out.kind = 'par';
  if (out.kind === 'moving' && !MOVING_STYLES[out.style]) out.style = 'spot';
  if (!Array.isArray(out.beamAngle)) out.beamAngle = [Number(out.beamAngle) || 25, Number(out.beamAngle) || 25];
  out.channels = (out.channels || []).map((c) => ({ ...c, type: CHANNEL_TYPES[c.type] ? c.type : 'none' }));
  const maxPixel = out.channels.reduce((m, c) => (c.pixel != null ? Math.max(m, c.pixel + 1) : m), 0);
  out.pixels = Math.max(out.pixels || 1, maxPixel || 1);
  return out;
}
