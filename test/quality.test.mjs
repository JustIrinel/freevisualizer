// Quality presets, shadow atlas and caster choice (v1.9 render).
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= { documentElement: {}, createElement: () => ({ style: {}, getContext: () => null }) };

const THREE = await import('three');
const { QUALITY, QUALITY_LEVELS, qualityPreset, shadowBudget, atlasGrid, floorFinish, DEFAULT_QUALITY } = await import('../public/js/quality.js');
const { patchShadowChunks, tileRect, tileCode, chooseCasters } = await import('../public/js/shadows.js');
const { defaultSettings, normalizeProject } = await import('../public/js/project.js');

test('presets grow from Scăzută to Clip video', () => {
  assert.deepEqual(QUALITY_LEVELS, ['low', 'medium', 'high', 'clip']);
  assert.deepEqual(QUALITY_LEVELS.map((k) => QUALITY[k].shadows), [0, 4, 12, 20]);
  for (const key of ['lights', 'beamSteps', 'particles', 'bloomScale', 'pixelRatio']) {
    const v = QUALITY_LEVELS.map((k) => QUALITY[k][key]);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] >= v[i - 1], `${key} must not drop: ${v}`);
  }
  assert.equal(QUALITY.low.reflections, 'off');
  assert.equal(QUALITY.medium.reflections, 'env');
  assert.equal(QUALITY.high.reflections, 'planar');
  assert.equal(QUALITY.high.ao, true);
  assert.equal(QUALITY.low.ao, false);
  assert.equal(QUALITY.clip.toneMapping, 'agx');
  assert.equal(qualityPreset('nope'), QUALITY[DEFAULT_QUALITY]);
});

test('projects default to Înaltă and keep the chosen quality', () => {
  assert.equal(defaultSettings().quality, 'high');
  assert.equal(defaultSettings().showFps, false);
  const p = normalizeProject({ settings: { quality: 'low' } });
  assert.equal(p.settings.quality, 'low');
  assert.equal(normalizeProject({}).settings.quality, 'high');
});

test('shadow budget follows the GPU limits', () => {
  assert.deepEqual(shadowBudget(0), { count: 0, grid: 1, tile: 0, size: 0 });
  const big = shadowBudget(20, { maxVaryings: 31, maxTextureSize: 16384, tile: 1024 });
  assert.equal(big.count, 20);
  assert.equal(big.grid, 5);
  assert.equal(big.size, 5120);
  // 15 varyings (WebGL minimum): only 7 lights can have a shadow.
  assert.equal(shadowBudget(12, { maxVaryings: 15 }).count, 7);
  // Small max texture size: tiles shrink so the atlas fits.
  const small = shadowBudget(12, { maxVaryings: 31, maxTextureSize: 2048, tile: 1024 });
  assert.equal(small.grid, 4);
  assert.ok(small.size <= 2048 && small.tile === 512);
  assert.equal(atlasGrid(4), 2);
  assert.equal(atlasGrid(5), 3);
});

test('atlas tiles do not overlap and the tile code round-trips', () => {
  const grid = 4;
  const seen = new Set();
  for (let slot = 0; slot < grid * grid; slot++) {
    const r = tileRect(slot, grid);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9);
    seen.add(`${r.x},${r.y}`);
    const code = tileCode(slot, grid);
    // Same decoding as getSpotAtlasShadow in GLSL.
    const g = Math.floor(code / 64 + 0.001);
    const s = Math.floor(code - g * 64 + 0.5);
    assert.equal(g, grid);
    assert.equal(s, slot);
    assert.equal((s % g) / g, r.x);
    assert.equal(Math.floor(s / g + 0.001) / g, r.y);
  }
  assert.equal(seen.size, grid * grid);
});

test('gobo lights are preferred shadow casters, then the brightest', () => {
  const L = (name, intensity, map = null, castShadow = false) => ({ name, intensity, map, castShadow });
  const list = [L('par', 300), L('dim', 10), L('gobo', 5, {}), L('wash', 900), L('mid', 280, null, true)];
  assert.deepEqual(chooseCasters(list, 3).map((l) => l.name), ['gobo', 'wash', 'mid']);
  assert.equal(chooseCasters(list, 10).length, list.length);
});

test('shader chunks are patched to read the shadow atlas', () => {
  assert.equal(patchShadowChunks(), true);
  assert.equal(patchShadowChunks(), true, 'second call is a no-op');
  const C = THREE.ShaderChunk;
  assert.match(C.shadowmap_pars_fragment, /uniform sampler2D spotShadowMap\[ 1 \];/);
  assert.match(C.shadowmap_pars_fragment, /getSpotAtlasShadow/);
  assert.match(C.lights_fragment_begin, /getSpotAtlasShadow\( spotLightShadow\.shadowMapSize/);
  assert.doesNotMatch(C.lights_fragment_begin, /spotShadowMap\[ i \]/);
  assert.doesNotMatch(C.shadowmask_pars_fragment, /spotShadowMap\[ i \]/);
});

test('floor finishes: glossy reflects most, matte not at all', () => {
  assert.ok(floorFinish('gloss').strength > floorFinish('satin').strength);
  assert.equal(floorFinish('matte').strength, 0);
  assert.ok(floorFinish('gloss').roughness < floorFinish('matte').roughness);
  assert.ok(floorFinish('matte', 'dance').strength > 0, 'the dance floor is always glossy');
});

test('lit surfaces get a soft highlight limit, emissive glow does not', async () => {
  const { patchHighlightKnee } = await import('../public/js/shadows.js');
  assert.equal(patchHighlightKnee(), true);
  const C = THREE.ShaderChunk;
  assert.match(C.lights_pars_begin, /vec3 fvLightKnee/);
  assert.match(C.lights_fragment_end, /reflectedLight\.directDiffuse = fvLightKnee/);
  assert.doesNotMatch(C.lights_fragment_end, /Emissive/);
});
