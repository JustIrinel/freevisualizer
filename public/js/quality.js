// Render quality presets (Setări → Calitate). Each preset sets resolution,
// shadows, floor reflections, ambient occlusion, haze ray-march steps,
// particle density and bloom resolution. The hardware can lower some numbers
// further (texture units / varyings of the GPU, see Visualizer._shadowBudget).
import { tr } from './i18n.js';

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'clip'];
export const DEFAULT_QUALITY = 'high';

export function qualityLabels() {
  return { low: tr('Scăzută'), medium: tr('Medie'), high: tr('Înaltă'), clip: tr('Clip video') };
}

/**
 * pixelRatio: cap for window.devicePixelRatio (× scale)
 * lights: spot/point lights on at once (more = slower on every lit pixel)
 * shadows: spot lights that cast shadows; shadowTile: shadow map size per light
 * reflections: 'off' | 'env' (stronger env specular) | 'planar' (real mirror image, reflectionScale of the screen)
 * ao: ground-truth ambient occlusion; beamSteps: haze ray-march samples (gobo / shadowed beams)
 * particles: share of sparks / low fog particles; bloomScale: bloom buffer resolution; msaa: samples
 */
export const QUALITY = {
  low: { pixelRatio: 1, scale: 0.75, lights: 16, shadows: 0, shadowTile: 0, reflections: 'off', reflectionScale: 0, ao: false, beamSteps: 6, particles: 0.4, bloomScale: 0.5, msaa: 0, toneMapping: 'aces' },
  medium: { pixelRatio: 1.25, scale: 1, lights: 28, shadows: 4, shadowTile: 512, reflections: 'env', reflectionScale: 0, ao: false, beamSteps: 10, particles: 0.7, bloomScale: 0.75, msaa: 2, toneMapping: 'aces' },
  high: { pixelRatio: 2, scale: 1, lights: 40, shadows: 12, shadowTile: 1024, reflections: 'planar', reflectionScale: 0.5, ao: true, aoScale: 0.5, beamSteps: 16, particles: 1, bloomScale: 1, msaa: 4, toneMapping: 'aces' },
  clip: { pixelRatio: 2, scale: 1, lights: 40, shadows: 20, shadowTile: 1024, reflections: 'planar', reflectionScale: 0.75, ao: true, aoScale: 1, beamSteps: 24, particles: 1, bloomScale: 1, msaa: 4, toneMapping: 'agx' },
};

export function qualityPreset(name) {
  return QUALITY[name] || QUALITY[DEFAULT_QUALITY];
}

/** Shadow atlas grid (tiles per side) for n shadow casters. */
export function atlasGrid(n) {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n))));
}

/**
 * How many shadow-casting spot lights the GPU can take.
 * Shadows share one atlas texture (1 texture unit), but every spot light with a
 * shadow or a projected gobo needs a varying in every lit material.
 */
export function shadowBudget(wanted, { maxVaryings = 15, maxTextureSize = 4096, tile = 1024 } = {}) {
  if (!wanted) return { count: 0, grid: 1, tile: 0, size: 0 };
  // ~8 varyings for the material itself (uv, normal, view position, fog, colour…).
  let count = Math.max(0, Math.min(wanted, maxVaryings - 8));
  if (!count) return { count: 0, grid: 1, tile: 0, size: 0 };
  const grid = atlasGrid(count);
  let t = tile;
  while (t > 128 && grid * t > maxTextureSize) t /= 2;
  return { count, grid, tile: t, size: grid * t };
}

/** Floor finish → planar reflection strength and blur (0..1), plus material roughness. */
export const FLOOR_FINISHES = ['gloss', 'satin', 'matte'];
export function floorFinishLabels() {
  return { gloss: tr('lucioasă'), satin: tr('satinată'), matte: tr('mată') };
}
export function floorFinish(name, kind = 'room') {
  if (kind === 'dance') return { strength: 0.8, blur: 0.15, roughness: 0.24 };
  switch (name) {
    case 'gloss': return { strength: 0.7, blur: 0.18, roughness: 0.18 };
    case 'matte': return { strength: 0, blur: 1, roughness: 0.8 };
    default: return { strength: 0.32, blur: 0.5, roughness: 0.42 };
  }
}
