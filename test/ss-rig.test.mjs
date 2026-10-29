// DJ Matei's real rig (SoundSwitch project, universe 1), channel by channel:
// what SoundSwitch sends → the state the visualizer shows.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { parseSoundSwitchVenues, ssPlacement } from '../public/js/ss-import.js';
import { computeState, createRuntime } from '../public/js/fixture-state.js';
import { normalizeProfile } from '../public/js/profiles.js';
import { DmxStore } from '../public/js/dmx.js';

const require = createRequire(import.meta.url);
const { parseArtDmx } = require('../server/artnet.js');

const bin = fs.readFileSync(new URL('./ss/SoundSwitchVenues.bin', import.meta.url));
const parsed = parseSoundSwitchVenues(bin);
// Same code path as the import dialog: ssPlacement → project profiles → App.normalizeProfile.
const { profiles, placed } = ssPlacement(parsed, { trussY: 3.35, trussZ: -9, trussHalf: 3.4, roomHalfWidth: 13, backZ: -10 });
const byId = new Map(profiles.map((p) => [p.id, normalizeProfile(JSON.parse(JSON.stringify(p)))]));
const rig = placed.map((it) => ({ name: it.fx.name, universe: it.fx.universe, address: it.fx.address, profile: byId.get(it.profile.id) }));
const fixtures = (model) => rig.filter((f) => f.profile.name.startsWith(model)).sort((a, b) => a.address - b.address);

/** State of a fixture for channel values (1-based channel → value) at its real address. */
function state(fx, values, { rt = createRuntime(), dt = 0.02, time = 0 } = {}) {
  const dmx = new Uint8Array(512);
  for (const [ch, v] of Object.entries(values)) dmx[fx.address - 1 + Number(ch) - 1] = v;
  return computeState(fx.profile, dmx, fx.address, rt, dt, time);
}
/** Shutter over 2 s at 50 fps: [min, max] intensity seen. */
function flicker(fx, values) {
  const rt = createRuntime();
  let min = 1; let max = 0;
  for (let i = 0; i < 100; i++) {
    const s = state(fx, values, { rt, dt: 0.02, time: i * 0.02 });
    min = Math.min(min, s.intensity); max = Math.max(max, s.intensity);
  }
  return [min, max];
}
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const rgbNear = (a, b, eps = 0.02) => a.forEach((x, i) => near(x, b[i], eps));
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

test('rig: 13 fixtures in universe 1 at the SoundSwitch addresses', () => {
  assert.strictEqual(rig.length, 13);
  assert.ok(rig.every((f) => f.universe === 1));
  assert.deepStrictEqual(fixtures('Intimidator').map((f) => f.address), [1, 15]);
  assert.deepStrictEqual(fixtures('Panther').map((f) => f.address), [33, 47, 65, 79]);
  assert.deepStrictEqual(fixtures('ZQ01104').map((f) => f.address), [97, 104, 111, 118]);
  assert.deepStrictEqual(fixtures('7 Vintage').map((f) => f.address), [129, 161]);
  assert.deepStrictEqual(fixtures('Entour').map((f) => f.address), [509]);
});

test('Art-Net universe 0 (SoundSwitch "Universe 1") drives the fixtures of universe 1', () => {
  const pkt = Buffer.alloc(18 + 512);
  pkt.write('Art-Net\0', 0, 'ascii');
  pkt.writeUInt16LE(0x5000, 8);
  pkt[11] = 14;
  pkt.writeUInt16BE(512, 16);
  const [spot] = fixtures('Intimidator');
  const [hazer] = fixtures('Entour');
  pkt[18 + spot.address - 1 + 9] = 255; // dimmer
  pkt[18 + spot.address - 1 + 10] = 255; // shutter open
  pkt[18 + hazer.address - 1] = 200; // smoke
  const art = parseArtDmx(pkt);
  assert.strictEqual(art.universe, 0);
  const store = new DmxStore();
  store._onDmx(`artnet|${art.universe}|${art.data.toString('base64')}`);
  store.beginFrame();
  const buf = store.get(1);
  assert.ok(buf, 'Art-Net 0 is shown as universe 1');
  assert.strictEqual(store.get(0), null);
  near(computeState(spot.profile, buf, spot.address, createRuntime(), 0.02, 0).intensity, 1);
  near(computeState(hazer.profile, buf, hazer.address, createRuntime(), 0.02, 0).fog, 200 / 255);
});

// Intimidator Spot LED 250, Advanced (13 ch): 1 pan, 2 pan fine, 3 tilt, 4 tilt fine, 5 speed,
// 6 colour, 7 gobo, 8 gobo rotation, 9 prism, 10 dimmer, 11 shutter, 12 functions, 13 auto programs.
test('Intimidator Spot LED 250: pan/tilt 16 bit, dimmer, shutter', () => {
  for (const spot of fixtures('Intimidator')) {
    assert.deepStrictEqual(spot.profile.channels.map((c) => c.type),
      ['pan', 'panFine', 'tilt', 'tiltFine', 'none', 'colorWheel', 'gobo', 'goboRot', 'prism', 'dimmer', 'strobe', 'none', 'none']);
    assert.deepStrictEqual(spot.profile.channels.filter((c) => c.type === 'none').map((c) => c.label), ['Speed', 'Control Functions', 'Auto Programs']);
    const open = { 10: 255, 11: 255 };
    near(state(spot, { ...open, 1: 0, 3: 0 }).pan, -270, 0.1);
    near(state(spot, { ...open, 1: 255, 2: 255, 3: 255, 4: 255 }).pan, 270, 0.1);
    near(state(spot, { ...open, 1: 255, 2: 255, 3: 255, 4: 255 }).tilt, 135, 0.1);
    near(state(spot, { ...open, 1: 128, 2: 0 }).pan, 0, 0.01); // 128/0 = centre
    near(state(spot, { ...open, 1: 128, 2: 255 }).pan - state(spot, { ...open, 1: 128, 2: 0 }).pan, (255 / 65535) * 540, 0.01);
    near(state(spot, { ...open, 3: 64 }).tilt, -67.5, 0.1);
    near(state(spot, { 10: 128, 11: 255 }).intensity, 128 / 255);
    near(state(spot, { 10: 255, 11: 0 }).intensity, 0); // 0–3 closed
    near(state(spot, { 10: 255, 11: 5 }).intensity, 1); // 4–7 open
    const [min, max] = flicker(spot, { 10: 255, 11: 120 }); // 8–215 strobe
    assert.ok(min === 0 && max === 1);
    near(state(spot, { 10: 0, 11: 255 }).intensity, 0);
    // Speed / functions / auto programs change nothing visible.
    assert.deepStrictEqual(state(spot, { ...open, 5: 200, 12: 200, 13: 200 }).color, state(spot, open).color);
  }
});

test('Intimidator Spot LED 250: colour wheel (17 SoundSwitch slots)', () => {
  const [spot] = fixtures('Intimidator');
  const wheel = spot.profile.channels[5];
  assert.strictEqual(wheel.ranges.length, 17);
  const col = (v) => state(spot, { 6: v, 10: 255, 11: 255 }).color;
  rgbNear(col(0), [1, 1, 1]);
  rgbNear(col(10), [1, 1, 0]);
  rgbNear(col(12), [1, 1, 0]); // 12–13 overlap in the definition: the first slot wins
  rgbNear(col(17), [1, 0, 1]);
  rgbNear(col(24), [0, 1, 0]);
  rgbNear(col(31), [1, 0, 0]);
  rgbNear(col(38), [0, 1, 1]);
  rgbNear(col(52), hex('#fd8008'));
  rgbNear(col(60), [0, 0, 1]);
  rgbNear(col(124), hex('#807eff'));
  near(state(spot, { 6: 31, 10: 255, 11: 255 }).intensity, 1);
});

test('Intimidator Spot LED 250: gobos at the values of the SoundSwitch presets', () => {
  const [spot] = fixtures('Intimidator');
  const slot = (v) => state(spot, { 7: v, 10: 255, 11: 255 }).gobos[0];
  // Presets in the project: SPOT 0, CERC/CT 10, WATER 17, SPIRALA 24, CERCURI 34, FLORI 41, SFERA 52, MELC 62.
  assert.deepStrictEqual([0, 10, 17, 24, 34, 41, 52, 62].map((v) => slot(v).slot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok([0, 10, 62].every((v) => !slot(v).shake));
  assert.deepStrictEqual([slot(66).slot, slot(66).shake, slot(115).slot, slot(115).shake], [7, true, 1, true]);
  assert.strictEqual(slot(124).slot, 0);
  // MIX 134: the wheel scrolls, the gobos pass one after another.
  const rt = createRuntime();
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(state(spot, { 7: 134, 10: 255, 11: 255 }, { rt, dt: 0.05 }).gobos[0].slot);
  assert.ok(seen.size >= 3, `scroll shows several gobos (${[...seen]})`);
});

test('Intimidator Spot LED 250: gobo rotation and 3-facet prism', () => {
  const [spot] = fixtures('Intimidator');
  const spin = (v) => {
    const rt = createRuntime();
    state(spot, { 8: v, 10: 255, 11: 255 }, { rt, dt: 0 });
    return state(spot, { 8: v, 10: 255, 11: 255 }, { rt, dt: 1 }).gobos[0].angle;
  };
  near(spin(0), 0, 1e-9);
  assert.ok(spin(60) > 0);
  assert.ok(spin(200) < 0);
  assert.ok(spin(110) > spin(20));
  const prism = (v) => state(spot, { 9: v, 10: 255, 11: 255 }).prisms[0].facets;
  // PRIMA STATICA 72, PRIMA FAST 141, PRIMA SLOW 183; 0 in every gobo preset.
  assert.deepStrictEqual([0, 10, 72, 141, 183, 255].map(prism), [0, 0, 3, 3, 3, 3]);
  assert.strictEqual(state(spot, { 9: 72, 10: 255, 11: 255 }).prism, 3);
});

// Panther 60 LED Beam, Standard (14 ch): 1 pan, 2 tilt, 3 pan fine, 4 tilt fine, 5 P/T speed,
// 6 dimmer, 7 R, 8 G, 9 B, 10 W, 11 strobe, 12 colour mixing, 13 mode, 14 reset.
test('BeamZ Panther 60: pan/tilt, RGBW, dimmer, strobe', () => {
  for (const p of fixtures('Panther')) {
    assert.strictEqual(p.profile.kind, 'moving');
    assert.deepStrictEqual(p.profile.channels.map((c) => c.type),
      ['pan', 'tilt', 'panFine', 'tiltFine', 'none', 'dimmer', 'red', 'green', 'blue', 'white', 'strobe', 'none', 'none', 'none']);
    near(state(p, { 1: 0, 2: 255, 4: 255, 6: 255, 10: 255 }).pan, -270, 0.1);
    near(state(p, { 1: 0, 2: 255, 4: 255, 6: 255, 10: 255 }).tilt, 135, 0.1);
    near(state(p, { 1: 128, 3: 128 }).pan - state(p, { 1: 128 }).pan, (128 / 65535) * 540, 0.01);
    const c = (v) => state(p, { 6: 255, ...v });
    rgbNear(c({ 7: 255 }).color, [1, 0, 0]);
    rgbNear(c({ 8: 255 }).color, [0, 1, 0]);
    rgbNear(c({ 9: 255 }).color, [0, 0, 1]);
    rgbNear(c({ 10: 255 }).color, [1, 1, 1]);
    rgbNear(c({ 7: 255, 10: 255 }).color, [1, 0.5, 0.5]);
    near(c({ 7: 255 }).intensity, 1);
    near(state(p, { 6: 128, 7: 255 }).intensity, 128 / 255);
    near(state(p, { 6: 0, 7: 255 }).intensity, 0);
    near(state(p, { 6: 255 }).intensity, 0); // no colour = dark
    const [min, max] = flicker(p, { 6: 255, 10: 255, 11: 200 });
    assert.ok(min === 0 && max === 1);
    // Colour mixing / mode / reset: no ranges in SoundSwitch, nothing visible.
    rgbNear(c({ 7: 255, 12: 120, 13: 50, 14: 0 }).color, [1, 0, 0]);
  }
});

// UKing ZQ01104, Mode 1 (7 ch): 1 dimmer, 2 R, 3 G, 4 B, 5 strobe, 6 auto modes, 7 colour shades.
test('UKing ZQ01104: dimmer, RGB and the strobe on channel 5', () => {
  for (const z of fixtures('ZQ01104')) {
    assert.strictEqual(z.profile.kind, 'par');
    assert.deepStrictEqual(z.profile.channels.map((c) => c.type), ['dimmer', 'red', 'green', 'blue', 'strobe', 'none', 'none']);
    rgbNear(state(z, { 1: 255, 2: 255, 4: 255 }).color, [1, 0, 1]);
    near(state(z, { 1: 255, 2: 255 }).intensity, 1);
    near(state(z, { 1: 64, 3: 255 }).intensity, 64 / 255);
    near(state(z, { 1: 0, 2: 255 }).intensity, 0);
    near(state(z, { 1: 255, 2: 255, 5: 10 }).intensity, 1); // SoundSwitch sends 0 here: no strobe
    const [min, max] = flicker(z, { 1: 255, 2: 255, 5: 200 });
    assert.ok(min === 0 && max === 1);
  }
});

// 7 Vintage lights v3 MATEI, Mode 2 (30 ch): 1 dimmer, 2 strobe, 3–23 RGB of heads 1–7, 24–30 white of heads 1–7.
test('7 Vintage lights: 7 heads RGB + warm white, master dimmer and strobe', () => {
  for (const v of fixtures('7 Vintage')) {
    assert.strictEqual(v.profile.kind, 'retro');
    assert.strictEqual(v.profile.pixels, 7);
    assert.strictEqual(v.profile.tungsten, false); // LED heads: no filament lag / orange shift
    for (let head = 0; head < 7; head++) {
      const s = state(v, { 1: 255, [3 + head * 3]: 255 });
      s.pixels.forEach((px, k) => near(px.intensity, k === head ? 1 : 0));
      rgbNear(s.pixels[head].color, [1, 0, 0]);
      const g = state(v, { 1: 255, [4 + head * 3]: 255 }).pixels[head];
      rgbNear(g.color, [0, 1, 0]);
      const b = state(v, { 1: 255, [5 + head * 3]: 255 }).pixels[head];
      rgbNear(b.color, [0, 0, 1]);
      const w = state(v, { 1: 255, [24 + head]: 255 });
      w.pixels.forEach((px, k) => near(px.intensity, k === head ? 1 : 0));
      rgbNear(w.pixels[head].color, [1, 0.78, 0.5]); // warm white
    }
    const all = {};
    for (let c = 3; c <= 30; c++) all[c] = 255;
    near(state(v, { ...all, 1: 0 }).intensity, 0);
    near(state(v, { ...all, 1: 128 }).pixels[3].intensity, 128 / 255);
    near(state(v, { ...all, 1: 255, 2: 5 }).intensity, 1); // 0–9 no strobe
    const [min, max] = flicker(v, { ...all, 1: 255, 2: 180 });
    assert.ok(min === 0 && max === 1);
  }
});

// Entour Faze, Mode 3 (4 ch): 1 smoke, 2 fan speed, 3 duration, 4 interval.
test('ADJ Entour Faze: smoke raises the haze, other channels do not', () => {
  const [hz] = fixtures('Entour');
  assert.strictEqual(hz.profile.kind, 'fog');
  assert.deepStrictEqual(hz.profile.channels.map((c) => c.type), ['fog', 'none', 'none', 'none']);
  near(state(hz, { 1: 255 }).fog, 1);
  near(state(hz, { 1: 100 }).fog, 100 / 255);
  near(state(hz, { 2: 255, 3: 255, 4: 255 }).fog, 0);
});
