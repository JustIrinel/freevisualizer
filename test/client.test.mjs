import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { oflToProfile, listModes } from '../public/js/ofl-import.js';
import { computeState, createRuntime } from '../public/js/fixture-state.js';
import { BUILTIN_PROFILES, normalizeProfile } from '../public/js/profiles.js';
import { nextFreeAddress, findConflicts, demoProject } from '../public/js/project.js';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./ofl/${n}.json`, import.meta.url)));
const builtin = (id) => normalizeProfile(BUILTIN_PROFILES.find((p) => p.id === id));
const dmx = (values, start = 1) => { const b = new Uint8Array(512); values.forEach((v, i) => { b[start - 1 + i] = v; }); return b; };

test('OFL moving head converts with pan/tilt, wheels and strobe', () => {
  const fx = load('intimidator-spot-260');
  const modes = listModes(fx);
  const full = modes.find((m) => m.channels === 14);
  const p = oflToProfile(fx, full.index, 'chauvet-dj/intimidator-spot-260');
  assert.strictEqual(p.kind, 'moving');
  assert.strictEqual(p.channels.length, 14);
  assert.deepStrictEqual(p.channels.slice(0, 4).map((c) => c.type), ['pan', 'panFine', 'tilt', 'tiltFine']);
  assert.ok(p.channels.some((c) => c.type === 'colorWheel' && c.ranges.some((r) => r.color === '#ff0000')));
  assert.ok(p.channels.some((c) => c.type === 'gobo'));
  assert.ok(p.channels.some((c) => c.type === 'dimmer'));
  assert.deepStrictEqual(p.beamAngle, [12, 17]);
});

test('OFL pixel bar expands matrix channels per pixel', () => {
  const fx = load('colorband-pix');
  const m = listModes(fx).find((x) => x.channels === 36);
  const p = oflToProfile(fx, m.index, 'chauvet-dj/colorband-pix');
  assert.strictEqual(p.kind, 'bar');
  assert.strictEqual(p.pixels, 12);
  assert.deepStrictEqual(p.channels.slice(3, 6).map((c) => [c.type, c.pixel]), [['red', 1], ['green', 1], ['blue', 1]]);
  assert.strictEqual(p.channels[35].pixel, 11);
});

test('OFL par keeps RGBAW+UV order', () => {
  const fx = load('slimpar-pro-h-usb');
  const p = oflToProfile(fx, 1, 'chauvet-dj/slimpar-pro-h-usb');
  assert.deepStrictEqual(p.channels.map((c) => c.type), ['dimmer', 'red', 'green', 'blue', 'amber', 'white', 'uv']);
});

test('RGB par without dimmer uses color level as intensity', () => {
  const p = builtin('gen-par-rgb-3');
  const s = computeState(p, dmx([255, 0, 128], 10), 10, createRuntime(), 0.016, 0);
  assert.strictEqual(s.intensity, 1);
  assert.deepStrictEqual(s.color.map((x) => Math.round(x * 100) / 100), [1, 0, 0.5]);
  const off = computeState(p, dmx([0, 0, 0], 10), 10, createRuntime(), 0.016, 0);
  assert.strictEqual(off.intensity, 0);
});

test('dimmer channel scales intensity and strobe closes shutter periodically', () => {
  const p = builtin('gen-par-rgb-7'); // D R G B Strobe Mode Speed
  const half = computeState(p, dmx([128, 255, 255, 255, 0]), 1, createRuntime(), 0.016, 0);
  assert.ok(Math.abs(half.intensity - 128 / 255) < 0.01);
  const rt = createRuntime();
  let on = 0; let off = 0;
  for (let i = 0; i < 200; i++) {
    const s = computeState(p, dmx([255, 255, 255, 255, 200]), 1, rt, 1 / 120, i / 120);
    if (s.intensity > 0.5) on++; else off++;
  }
  assert.ok(on > 0 && off > 0, 'strobe should flash');
});

test('moving head pan/tilt are 16-bit and centered at 50%', () => {
  const p = builtin('gen-mh-spot-11');
  const s = computeState(p, dmx([128, 0, 128, 0]), 1, createRuntime(), 0.016, 0);
  assert.ok(Math.abs(s.pan) < 2);
  assert.ok(Math.abs(s.tilt) < 2);
  const s2 = computeState(p, dmx([255, 255, 0, 0]), 1, createRuntime(), 0.016, 0);
  assert.ok(Math.abs(s2.pan - 270) < 0.01);
  assert.ok(Math.abs(s2.tilt + 135) < 0.01);
});

test('color wheel picks the slot color', () => {
  const p = builtin('gen-mh-spot-11');
  const wheel = p.channels[4].ranges.find((r) => r.color === '#ff0000');
  const s = computeState(p, dmx([128, 0, 128, 0, wheel.from, 0, 0, 255]), 1, createRuntime(), 0.016, 0);
  assert.deepStrictEqual(s.color, [1, 0, 0]);
  assert.strictEqual(s.intensity, 1);
});

test('pixel bar reports per-pixel colors', () => {
  const p = builtin('gen-bar-8x-rgb-24');
  const s = computeState(p, dmx([255, 0, 0, 0, 0, 255]), 1, createRuntime(), 0.016, 0);
  assert.strictEqual(s.pixels.length, 8);
  assert.deepStrictEqual(s.pixels[0].color, [1, 0, 0]);
  assert.deepStrictEqual(s.pixels[1].color, [0, 0, 1]);
  assert.strictEqual(s.pixels[2].intensity, 0);
});

test('demo project patch has no conflicts and next free address works', () => {
  const project = demoProject();
  const byId = Object.fromEntries(BUILTIN_PROFILES.map((p) => [p.id, normalizeProfile(p)]));
  assert.strictEqual(findConflicts(project, byId).size, 0);
  const next = nextFreeAddress(project, byId, 1, 6);
  assert.strictEqual(next, 55); // first gap that fits 6 channels
  assert.strictEqual(nextFreeAddress(project, byId, 2, 6), 1);
});
