// Real spot light shadows for many fixtures at once.
//
// Three.js gives every shadow-casting spot light its own shadow texture, and a
// GPU has only 16 texture units per shader on most PCs (gobo projections and
// the material's own maps use them too). Here all the shadow maps live in one
// atlas texture: every caster renders into its own tile, and the shadow lookup
// in the lit materials is patched to read that tile. The tile of a light is
// encoded in its shadow.radius (unused by PCF-soft shadows): grid × 64 + slot.
import * as THREE from 'three';

const SPOT_LOOKUP = /getShadow\( spotShadowMap\[ i \], (spotLightShadow|spotLight)\.shadowMapSize, \1\.shadowIntensity, \1\.shadowBias, \1\.shadowRadius, vSpotLightCoord\[ i \] \)/g;

const ATLAS_LOOKUP_GLSL = /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	// Shadow of a spot light whose map is one tile of the shared atlas (see shadows.js).
	float getSpotAtlasShadow( vec2 atlasSize, float shadowIntensity, float shadowBias, float tileCode, vec4 shadowCoord ) {
		if ( shadowCoord.w <= 0.0 ) return 1.0;
		vec3 s = shadowCoord.xyz / shadowCoord.w;
		if ( s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0 ) return 1.0;
		float grid = floor( tileCode / 64.0 + 0.001 );
		float slot = floor( tileCode - grid * 64.0 + 0.5 );
		vec2 tile = vec2( mod( slot, grid ), floor( slot / grid + 0.001 ) );
		vec2 inset = vec2( 2.0 * grid ) / atlasSize;
		vec2 uv = ( tile + clamp( s.xy, inset, 1.0 - inset ) ) / grid;
		return getShadow( spotShadowMap[ 0 ], atlasSize, shadowIntensity, shadowBias, 0.0, vec4( uv, s.z, 1.0 ) );
	}
#endif
`;

let patchResult = null;
/** Patch the shader chunks once, before any material compiles. False = shadows stay off. */
export function patchShadowChunks() {
  if (patchResult !== null) return patchResult;
  const C = THREE.ShaderChunk;
  const decl = 'uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];';
  const ok = C.shadowmap_pars_fragment.includes(decl)
    && (C.lights_fragment_begin.match(SPOT_LOOKUP) || []).length === 1
    && (C.shadowmask_pars_fragment.match(SPOT_LOOKUP) || []).length === 1;
  if (!ok) {
    console.warn('Umbre: shader chunks neașteptate, umbrele rămân oprite');
    patchResult = false;
    return false;
  }
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replace(decl, 'uniform sampler2D spotShadowMap[ 1 ];') + ATLAS_LOOKUP_GLSL;
  const replace = (src) => src.replace(SPOT_LOOKUP, 'getSpotAtlasShadow( $1.shadowMapSize, $1.shadowIntensity, $1.shadowBias, $1.shadowRadius, vSpotLightCoord[ i ] )');
  C.lights_fragment_begin = replace(C.lights_fragment_begin);
  C.shadowmask_pars_fragment = replace(C.shadowmask_pars_fragment);
  patchResult = true;
  return true;
}

/** Tile rectangle (0..1) of `slot` in a grid × grid atlas. */
export function tileRect(slot, grid) {
  return { x: (slot % grid) / grid, y: Math.floor(slot / grid) / grid, w: 1 / grid, h: 1 / grid };
}

/** shadow.radius code read back by getSpotAtlasShadow. */
export function tileCode(slot, grid) {
  return grid * 64 + slot;
}

/**
 * Choose which spot lights cast shadows. Mapped (gobo) lights first, then the
 * brightest; a light that already casts gets a bonus so the choice doesn't flicker.
 * The result keeps the same length while enough candidates exist, so materials
 * don't recompile. Returns the chosen lights.
 */
export function chooseCasters(candidates, count) {
  const scored = candidates.map((l) => ({ l, k: (l.map ? 1e6 : 0) + l.intensity * (l.castShadow ? 1.2 : 1) + (l.castShadow ? 1 : 0) }));
  scored.sort((a, b) => b.k - a.k);
  return scored.slice(0, count).map((e) => e.l);
}

export class ShadowAtlas {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = null;
    this.grid = 1;
    this.tile = 0;
    this.size = 0;
    this.count = 0;
    this.slots = [];      // slot → light
    this.frame = 0;
    this._clearing = false;
    this._clearColor = new THREE.Color();
    // Three clears a shadow map before rendering each light into it: with an atlas
    // that would wipe the other lights' tiles, so tiles are cleared here instead.
    const clear = renderer.clear.bind(renderer);
    this._rawClear = clear;
    renderer.clear = (color = true, depth = true, stencil = true) => {
      if (this.rt && !this._clearing && renderer.getRenderTarget() === this.rt) return;
      clear(color, depth, stencil);
    };
  }

  /** { count, grid, tile, size } from shadowBudget(). */
  configure(budget) {
    this.count = budget.count;
    if (!budget.count) {
      this.release();
      if (this.rt) { this.rt.dispose(); this.rt = null; }
      this.size = 0;
      return;
    }
    if (!this.rt || this.size !== budget.size) {
      this.release();
      if (this.rt) this.rt.dispose();
      this.rt = new THREE.WebGLRenderTarget(budget.size, budget.size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      this.rt.texture.name = 'shadowAtlas';
      this._fresh = true;
    }
    this.grid = budget.grid;
    this.tile = budget.tile;
    this.size = budget.size;
    // More slots than tiles can't happen, but a smaller grid must re-place everyone.
    this.release();
  }

  /** Stop every light from casting (quality change, scene cleared). */
  release() {
    for (const l of this.slots) if (l) this._unset(l);
    this.slots = [];
  }

  /** A light leaves the scene. */
  forget(light) {
    const i = this.slots.indexOf(light);
    if (i >= 0) this.slots[i] = null;
    this._unset(light);
  }

  _unset(light) {
    light.castShadow = false;
    if (light.shadow.map && light.shadow.map === this.rt) light.shadow.map = null;
    light.shadow.radius = 1;
    light.shadow.mapSize.set(512, 512);
    light.shadow.getViewport(0).set(0, 0, 1, 1);
    light.shadow.autoUpdate = true;
    delete light.userData.shadowTile;
  }

  _set(light, slot) {
    const sh = light.shadow;
    const r = tileRect(slot, this.grid);
    light.castShadow = true;
    sh.map = this.rt;
    sh.mapSize.set(this.size, this.size);
    sh.getViewport(0).set(r.x, r.y, r.w, r.h);
    sh.radius = tileCode(slot, this.grid);
    sh.bias = -0.0004;
    sh.normalBias = 0.025;
    sh.autoUpdate = false;
    sh.needsUpdate = true;
    if (sh.camera.near > 0.1 || sh.camera.near < 0.04) sh.camera.near = 0.08;
    sh.camera.far = 40;
    sh.camera.updateProjectionMatrix();
    light.userData.shadowTile = new THREE.Vector4(r.x, r.y, r.w, r.h);
    light.userData.shadowTileSize = this.tile;
    light.userData.shadowMoved = true;
  }

  /** Give the chosen lights a tile each (lights that stay keep theirs). */
  assign(chosen) {
    const keep = new Set(chosen);
    for (let i = 0; i < this.slots.length; i++) {
      const l = this.slots[i];
      if (l && !keep.has(l)) { this._unset(l); this.slots[i] = null; }
    }
    for (const l of chosen) {
      if (this.slots.includes(l)) continue;
      let i = this.slots.indexOf(null);
      if (i < 0) i = this.slots.length;
      if (i >= this.grid * this.grid) break;
      this.slots[i] = l;
      this._set(l, i);
    }
  }

  /**
   * Before the first render of a frame: decide which tiles are redrawn and clear them.
   * Lights that move redraw every frame, the others every second frame (guests move slowly).
   */
  beginFrame() {
    if (!this.rt || !this.count) return;
    this.frame++;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.getClearColor(this._clearColor);
    const alpha = r.getClearAlpha();
    this._clearing = true;
    r.setClearColor(0xffffff, 1);
    if (this._fresh) {
      r.setRenderTarget(this.rt);
      this._rawClear(true, true, false);
      this._fresh = false;
    }
    this.slots.forEach((l, i) => {
      if (!l) return;
      const m = l.matrixWorld.elements;
      const last = l.userData.shadowLast || (l.userData.shadowLast = new Float32Array(16));
      let moved = l.userData.shadowMoved;
      for (let k = 0; k < 16 && !moved; k++) if (Math.abs(m[k] - last[k]) > 1e-5) moved = true;
      if (moved) last.set(m);
      l.userData.shadowMoved = false;
      const due = moved || (this.frame + i) % 2 === 0;
      l.shadow.needsUpdate = due;
      if (!due) return;
      const t = tileRect(i, this.grid);
      this.rt.scissor.set(t.x * this.size, t.y * this.size, t.w * this.size, t.h * this.size);
      this.rt.scissorTest = true;
      r.setRenderTarget(this.rt);
      this._rawClear(true, true, false);
      this.rt.scissorTest = false;
    });
    this._clearing = false;
    r.setRenderTarget(prev);
    r.setClearColor(this._clearColor, alpha);
  }
}
