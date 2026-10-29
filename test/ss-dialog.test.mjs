// "Importă din SoundSwitch" → "Arhivă .zip…": which picked files are accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { venuesFromFile } from '../public/js/ss-dialog.js';

const bin = fs.readFileSync(new URL('./ss/SoundSwitchVenues.bin', import.meta.url));
const file = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

test('SoundSwitchVenues.bin picked directly is read', async () => {
  const v = await venuesFromFile(file('SoundSwitchVenues.bin', bin));
  assert.equal(v.bytes.length, bin.length);
});

test('a file that is not a SoundSwitch project gets a clear error', async () => {
  const d4 = fs.readFileSync(new URL('./d4/Test-Spot-260.d4', import.meta.url));
  await assert.rejects(venuesFromFile(file('Test-Spot-260.d4', d4)), /SoundSwitchVenues\.bin/);
});
