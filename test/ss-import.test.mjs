import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { parseSoundSwitchVenues, ssProfile, ssPlacement } from '../public/js/ss-import.js';
import { computeState, createRuntime } from '../public/js/fixture-state.js';
import { normalizeProfile } from '../public/js/profiles.js';

// Real project exported from SoundSwitch 2.11 (venue "Default").
const bin = fs.readFileSync(new URL('./ss/SoundSwitchVenues.bin', import.meta.url));
const dmx = (values) => { const b = new Uint8Array(512); values.forEach((v, i) => { b[i] = v; }); return b; };

test('SoundSwitch project: same patch as the DMX Map in SoundSwitch', () => {
  const p = parseSoundSwitchVenues(bin);
  assert.strictEqual(p.venue, 'Default');
  assert.deepStrictEqual(p.warnings, []);
  const rows = p.fixtures.map((f) => [f.address, f.name, f.definition.name, f.definition.modes[f.modeIndex].name, ssProfile(f.definition, f.modeIndex).channels.length]);
  assert.deepStrictEqual(rows, [
    [1, 'Intimidator Spot LED 250 1', 'Intimidator Spot LED 250', 'Advanced Mode', 13],
    [15, 'Intimidator Spot LED 250 2', 'Intimidator Spot LED 250', 'Advanced Mode', 13],
    [33, 'Panther CH 30 Stanga centru', 'Panther 60 LED Beam RGBW (150.468)', 'Standard Mode', 14],
    [47, 'Panther 60 CH15 Dreapta centru', 'Panther 60 LED Beam RGBW (150.468)', 'Standard Mode', 14],
    [65, 'Panther CH1 POZ 1 STANGA', 'Panther 60 LED Beam RGBW (150.468)', 'Standard Mode', 14],
    [79, 'Panther Ch15 POZ 3 dreapta', 'Panther 60 LED Beam RGBW (150.468)', 'Standard Mode', 14],
    [97, 'ZQ01104 POZ 1 STANGA', 'ZQ01104', 'Mode 1', 7],
    [104, 'ZQ01104 POZ 2 STANGA', 'ZQ01104', 'Mode 1', 7],
    [111, 'ZQ01104 POZ 3 DREAPTA', 'ZQ01104', 'Mode 1', 7],
    [118, 'ZQ01104 POZ 4 DREAPTA', 'ZQ01104', 'Mode 1', 7],
    [129, '7 Vintage lights v3 MATEI 1', '7 Vintage lights v3 MATEI', 'Mode 2', 30],
    [161, '7 Vintage lights v3 MATEI 2', '7 Vintage lights v3 MATEI', 'Mode 2', 30],
    [509, 'Entour Faze', 'Entour Faze', 'Mode 3', 4],
  ]);
  assert.ok(p.fixtures.every((f) => f.universe === 1));
});

test('SoundSwitch profiles: channel types, wheel colours, strobe ranges, pixels', () => {
  const p = parseSoundSwitchVenues(bin);
  const def = (name) => p.definitions.find((d) => d.name.startsWith(name));

  const panther = ssProfile(def('Panther'), 0);
  assert.strictEqual(panther.kind, 'moving');
  assert.strictEqual(panther.style, 'beam');
  assert.deepStrictEqual(panther.channels.slice(0, 11).map((c) => c.type),
    ['pan', 'tilt', 'panFine', 'tiltFine', 'none', 'dimmer', 'red', 'green', 'blue', 'white', 'strobe']);
  const s = computeState(normalizeProfile(panther), dmx([0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]), 1, createRuntime(), 0.016, 0);
  assert.ok(s.intensity > 0.99);
  assert.deepStrictEqual(s.color, [1, 0, 0]);

  const spot = ssProfile(def('Intimidator'), 1);
  assert.strictEqual(spot.style, 'spot');
  const wheel = spot.channels.find((c) => c.type === 'colorWheel');
  assert.strictEqual(wheel.ranges.find((r) => r.from === 28).color, '#ff0000');
  const shutter = spot.channels.find((c) => c.type === 'strobe');
  assert.deepStrictEqual(shutter.ranges.map((r) => r.mode), ['closed', 'open', 'strobe', 'open']);
  assert.strictEqual(ssProfile(def('Intimidator'), 0).channels.length, 8);

  const retro = ssProfile(def('7 Vintage'), 1);
  assert.strictEqual(retro.kind, 'retro');
  assert.strictEqual(retro.pixels, 7);
  assert.deepStrictEqual([retro.channels[0].type, retro.channels[1].type], ['dimmer', 'strobe']);
  assert.deepStrictEqual([retro.channels[2].type, retro.channels[2].pixel, retro.channels[29].type, retro.channels[29].pixel], ['red', 0, 'white', 6]);

  assert.strictEqual(ssProfile(def('Entour'), 2).kind, 'fog');
  assert.strictEqual(ssProfile(def('ZQ01104'), 0).kind, 'par');
});

test('SoundSwitch placement: movers on the truss, left (stânga) to right (dreapta)', () => {
  const p = parseSoundSwitchVenues(bin);
  const { profiles, placed } = ssPlacement(p, { trussY: 3.35, trussZ: -9, trussHalf: 3.4, roomHalfWidth: 13, backZ: -10 });
  assert.strictEqual(placed.length, 13);
  assert.strictEqual(profiles.length, 5);
  const x = (name) => placed.find((it) => it.fx.name === name).position.x;
  assert.ok(x('Panther CH1 POZ 1 STANGA') < x('Panther CH 30 Stanga centru'));
  assert.ok(x('Panther CH 30 Stanga centru') < x('Panther 60 CH15 Dreapta centru'));
  assert.ok(x('ZQ01104 POZ 2 STANGA') < x('ZQ01104 POZ 3 DREAPTA'));
  const mover = placed.find((it) => it.fx.name === 'Panther CH1 POZ 1 STANGA');
  assert.deepStrictEqual(mover.rotation, { x: 180, y: 0, z: 0 });
});
