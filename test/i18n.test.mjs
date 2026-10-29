// Every tr()/tp() text in the app has an English translation (otherwise English mode shows Romanian).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EN from '../public/js/lang/en.js';

const dir = new URL('../public/js/', import.meta.url);
// Same in both languages (or not words).
const SAME = new Set(['Export', 'Import', 'DMX', 'Model', 'Strobe', 'Pan (°)', 'Tilt (°)', 'Test', 'Art-Net', 'sACN', 'artnet', 'Normal', 'Pixel', 'Generic', 'OFL', 'Glow (bloom)', 'Site / Instagram', 'Shake', 'Start X (m)', 'Z (m)', 'Open Fixture Library (online)']);

test('every Romanian UI text has an English translation', () => {
  const missing = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'i18n.js') continue;
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\b(?:tr|tp)\(([^)]*?)\)/gs)) {
      for (const s of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        const key = s[1].replace(/\\'/g, "'");
        if (key.length < 2 || SAME.has(key) || EN[key] || !/[a-zăâîșț]/i.test(key)) continue;
        missing.push(`${f}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('placeholders match between Romanian and English', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(EN).filter(([ro, en]) => names(ro) !== names(en)).map(([ro]) => ro);
  assert.deepEqual(bad, []);
});
