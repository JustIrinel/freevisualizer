// Three.js scene: room, camera, post-processing, picking and gizmos.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildVenue } from './venue3d.js';
import { createFixtureModel, roomUniforms, beamQuality } from './fixtures3d.js';
import { createPropModel } from './props3d.js';
import { tripodParams, tripodMount, caseTop, totemParams, totemMount } from './prop-layout.js';
import { viewAxes, chooseLockAxis, dragDelta, wheelTurn } from './drag-math.js';
import { tr } from './i18n.js';
import { GoboLightManager } from './gobos.js';
import { qualityPreset, qualityLabels, shadowBudget, floorFinish, DEFAULT_QUALITY } from './quality.js';
import { patchShadowChunks, patchHighlightKnee, ShadowAtlas, chooseCasters } from './shadows.js';
import { PlanarReflection } from './reflections.js';
import { Particles } from './particles.js';

// Shadow lookups read one atlas texture; patched before any material compiles.
const SHADOWS_OK = patchShadowChunks();
patchHighlightKnee();
// Haze beams, particles, sprites and lines: drawn after the ambient occlusion so it doesn't darken them.
const FX_LAYER = 1;

const MAX_LIGHTS = 40;
// Spot lights that can project a gobo / prism texture (each costs a texture unit
// and a varying in every lit material).
export const MAX_GOBO_LIGHTS = 8;
const D2R = THREE.MathUtils.degToRad;
const R2D = THREE.MathUtils.radToDeg;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Renders only the objects on some layers (bit mask) into the read buffer, without swapping. */
class LayerPass extends Pass {
  constructor(scene, camera, mask, clear) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.mask = mask;
    this.clear = clear;
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const mask = this.camera.layers.mask;
    const auto = renderer.autoClear;
    const bg = this.scene.background;
    this.camera.layers.mask = this.mask;
    renderer.autoClear = false;
    // A colour background would clear the target again: only the first pass may.
    if (!this.clear) this.scene.background = null;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    if (this.clear) renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.background = bg;
    renderer.autoClear = auto;
    this.camera.layers.mask = mask;
  }
}

/** GTAO that sees only solid geometry (layer 0, no glass / transparent helpers). */
class FxSafeGTAOPass extends GTAOPass {
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    const m = this.camera.layers.mask;
    this.camera.layers.mask = 1;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
    this.camera.layers.mask = m;
  }

  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if (o.isPoints || o.isLine || o.isSprite || (o.material && !Array.isArray(o.material) && o.material.transparent)) o.visible = false;
    });
  }
}

/** Multiplies the GTAO result into the read buffer (keeps its depth for the haze pass). */
class AOBlendPass extends Pass {
  constructor(gtao) {
    super();
    this.gtao = gtao;
    this.needsSwap = false;
    this.quad = new FullScreenQuad(gtao.blendMaterial);
  }

  render(renderer, writeBuffer, readBuffer) {
    const g = this.gtao;
    g.blendMaterial.uniforms.intensity.value = g.blendIntensity;
    g.blendMaterial.uniforms.tDiffuse.value = g.pdRenderTarget.texture;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = auto;
  }

  dispose() {
    this.quad.dispose();
  }
}

const _box = new THREE.Box3();
/** Bounds of the solid parts of an object (beams, sprites and labels excluded). */
function computeBounds(root, target) {
  target.makeEmpty();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || o.isSprite || o.material?.isShaderMaterial) return;
    if (o.isInstancedMesh) {
      if (!o.boundingBox) o.computeBoundingBox();
      _box.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    }
    target.union(_box);
  });
  if (target.isEmpty()) target.setFromCenterAndSize(root.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.5, 0.5, 0.5));
  target.expandByScalar(0.05);
  return target;
}

export class Visualizer {
  constructor(container) {
    this.container = container;
    this.objects = new Map(); // id -> { type: 'fixture'|'prop', model, data }
    this.selectedIds = [];
    this.onPick = () => {};        // (id | null, { toggle }) – click in the scene
    this.onMarquee = () => {};     // (ids, { add }) – Shift + drag rectangle
    this.onTransform = () => {};   // ([{ id, position, rotation }]) – while dragging the gizmo
    this.onTransformStart = () => {};
    this.onTransformEnd = () => {};
    this.onGizmoInfo = () => {};   // (text | null) – live position / rotation readout
    this.onWheelRotate = () => {}; // (degrees) – Alt + mouse wheel over the scene
    this.hoverInfo = () => null;   // (id) → { ids, locked, label } for the hover highlight
    this.lockedIds = new Set();
    this.settings = { haze: 0.5, bloom: 0.9, ambient: 0.25, houseLight: 0.3, workLights: false, lightPower: 1, showLabels: false, snap: true, quality: DEFAULT_QUALITY, showFps: false };
    this.lightPool = new Set();
    this.maxLights = MAX_LIGHTS;
    this.qualityOverride = null; // 'clip' while a video is recorded
    this.fogLevel = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Shadow maps are redrawn once per frame (ShadowAtlas.beginFrame), not for every extra render pass.
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.shadowAtlas = new ShadowAtlas(renderer);
    this.reflection = new PlanarReflection();
    this.floors = new Map(); // key ('room' or prop id) → [{ mesh, kind }]

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030305);
    this.scene.fog = new THREE.FogExp2(0x030305, 0.012);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
    this.camera.position.set(0, 5, 15);
    this.camera.layers.enable(FX_LAYER);

    // Our pointerdown runs in the capture phase so Shift+drag can switch the
    // orbit controls off before they start rotating the camera.
    renderer.domElement.addEventListener('pointerdown', (e) => this._onPointerDown(e), { capture: true });
    renderer.domElement.addEventListener('pointermove', (e) => this._onPointerMove(e));
    renderer.domElement.addEventListener('pointerup', (e) => this._onPointerUp(e));
    renderer.domElement.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    renderer.domElement.addEventListener('pointerleave', () => this._setHover(null));

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.target.set(0, 1.8, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    // Gizmo: attached to the object itself (one selected) or to a pivot in the
    // middle of the group (several selected).
    this.pivot = new THREE.Object3D();
    this.scene.add(this.pivot);
    this.transform = new TransformControls(this.camera, renderer.domElement);
    this.transform.setSize(1.05);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (!this.selectedIds.length) return;
      if (e.value) {
        this._dragStart = {
          pivot: this.pivot.matrix.clone(),
          members: this._movableIds().map((id) => ({ id, matrix: this.objects.get(id).model.root.matrix.clone() })),
        };
        this.onTransformStart(this.selectedIds);
      } else {
        this._dragStart = null;
        this.onGizmoInfo(null);
        this.onTransformEnd(this.selectedIds);
      }
    });
    this.transform.addEventListener('objectChange', () => this._onGizmoChange());
    // Only the three arrows / three rings: the plane squares, the centre handle and the
    // trackball moved things on two axes at once (dragging "right" also went back).
    const giz = this.transform._gizmo;
    if (giz) {
      const strip = (group, names) => { for (const c of [...group.children]) if (names.includes(c.name)) group.remove(c); };
      for (const set of [giz.gizmo, giz.picker]) {
        strip(set.translate, ['XY', 'YZ', 'XZ', 'XYZ']);
        strip(set.rotate, ['XYZE', 'E']);
      }
    }
    this.scene.add(this.transform.getHelper());
    renderer.domElement.addEventListener('wheel', (e) => this._onWheel(e), { capture: true, passive: false });
    this.setSnap(true);

    this.hemi = new THREE.HemisphereLight(0xfff1dd, 0x3a3430, 0.25);
    this.scene.add(this.hemi);
    // "Work lights": an extra soft key light so the room is bright while placing fixtures.
    this.workLight = new THREE.DirectionalLight(0xfff4e6, 0);
    this.workLight.position.set(4, 10, 8);
    this.scene.add(this.workLight);
    // Every light also lights the effects / fixtures pass (same lights = no shader switch).
    this.hemi.layers.enable(FX_LAYER);
    this.workLight.layers.enable(FX_LAYER);
    // Image-based lighting so metal, plastic and glass reflect like real materials.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    pmrem.dispose();
    this.venue = null;

    this.ctx = {
      settings: this.settings,
      puffTexture: puffTexture(),
      // Every fixture gets its light; only the MAX_LIGHTS brightest are on at any time (_updateLightPool).
      allocateLight: (light) => { if (light) { this.lightPool.add(light); light.layers.enable(FX_LAYER); } return true; },
      releaseLight: (light) => { if (light) { this.lightPool.delete(light); this.shadowAtlas.forget(light); } },
      // Each projected gobo uses a texture slot; weak GPUs have only 16 per shader.
      goboLights: new GoboLightManager(Math.max(0, Math.min(MAX_GOBO_LIGHTS, renderer.capabilities.maxTextures - 8))),
      // World-space layer for effects that must not follow the fixture's rotation (sparks, low fog, reflections).
      world: new THREE.Group(),
      roomBox: new THREE.Box3(new THREE.Vector3(-12, 0, -10), new THREE.Vector3(12, 6, 10)),
      walls: true,
    };
    this.scene.add(this.ctx.world);
    // Effective quality for props (guests): 'clip' while recording, else the project's setting.
    Object.defineProperty(this.ctx, 'quality', { get: () => this.qualityName(), enumerable: true });

    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.5, 0.75);
    // Bloom at a lower resolution on weaker presets.
    const bloomSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSize(Math.max(2, Math.round(w * (this._bloomScale || 1))), Math.max(2, Math.round(h * (this._bloomScale || 1))));
    this.outputPass = new OutputPass();
    this.fpsDiv = document.createElement('div');
    this.fpsDiv.className = 'fps-counter';
    Object.assign(this.fpsDiv.style, { position: 'absolute', right: '8px', bottom: '8px', padding: '2px 7px', borderRadius: '6px', background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.75)', font: '11px/1.5 ui-monospace, Menlo, Consolas, monospace', pointerEvents: 'none', zIndex: 5, display: 'none' });
    container.appendChild(this.fpsDiv);
    this._fps = { frames: 0, time: 0 };
    this.applyQuality();

    // One outline box + one direction arrow per selected object.
    this.selHelpers = [];

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.enableAll(); // fixtures live on the effects layer (drawn after the AO)
    this._pointerDown = null;

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(container);
    this.resize();
  }

  /** Render at a fixed resolution (video recording); null returns to the window size. */
  setRenderSize(size) {
    this.fixedSize = size;
    this._applyPixelRatio();
    this.resize();
  }

  _applyPixelRatio() {
    const q = this.quality || qualityPreset(DEFAULT_QUALITY);
    const ratio = this.fixedSize ? 1 : Math.min(window.devicePixelRatio || 1, q.pixelRatio) * q.scale;
    this.renderer.setPixelRatio(ratio);
    if (this.composer) this.composer.setPixelRatio(ratio);
  }

  /** Quality preset in use ('clip' while recording, else the project's setting). */
  qualityName() {
    const n = this.qualityOverride || this.settings.quality;
    return ['low', 'medium', 'high', 'clip'].includes(n) ? n : DEFAULT_QUALITY;
  }

  /** While a clip is recorded: 'clip'; null returns to the chosen preset. */
  setQualityOverride(name) {
    this.qualityOverride = name || null;
    this.applyQuality();
  }

  /** Apply the quality preset: resolution, shadows, reflections, AO, beams, particles, bloom. */
  applyQuality() {
    const name = this.qualityName();
    // qualityTweaks: overrides for measurements (window.freevis.vis.qualityTweaks = { ao: false }).
    const q = { ...qualityPreset(name), ...(this.qualityTweaks || {}) };
    const prev = this.quality;
    this.quality = q;
    this.qualityKey = name;
    const caps = this.renderer.capabilities;
    this.maxLights = q.lights;
    this._scanTimer = 0;
    this._poolTimer = 0;
    if (this._poolCapped || this.lightPool.size > this.maxLights) this._poolCapped = true;
    beamQuality.uSteps.value = q.beamSteps;
    Particles.budget = q.particles;
    this._bloomScale = q.bloomScale;
    // Shadows: one atlas, as many lights as the GPU's varyings allow.
    const budget = SHADOWS_OK ? shadowBudget(q.shadows, { maxVaryings: caps.maxVaryings || 15, maxTextureSize: caps.maxTextureSize || 4096, tile: q.shadowTile }) : { count: 0 };
    this.shadowAtlas.configure(budget);
    this.shadowInfo = { wanted: q.shadows, count: budget.count, tile: budget.tile || 0 };
    this.renderer.shadowMap.enabled = budget.count > 0;
    // The shadow atlas takes one texture unit from the gobo projections.
    const gobo = this.ctx.goboLights;
    const goboMax = Math.max(0, Math.min(MAX_GOBO_LIGHTS, caps.maxTextures - (budget.count ? 9 : 8)));
    if (gobo.max !== goboMax) gobo.max = goboMax;
    this.reflection.enabled = q.reflections === 'planar';
    this.reflection.scale = q.reflectionScale || 0.5;
    this._applyFloors();
    const tone = q.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMapping = tone;
    this.renderer.toneMappingExposure = q.toneMapping === 'agx' ? 0.95 : 0.9;
    if (!prev || !this.composer || prev.msaa !== q.msaa || prev.ao !== q.ao || prev.aoScale !== q.aoScale) this._buildComposer(q);
    this._applyPixelRatio();
    this.resize();
    this._fps.frames = 0; this._fps.time = 0;
  }

  /** Post-processing chain. With AO: scene without haze → AO → haze/particles on top → bloom → output. */
  _buildComposer(q) {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    if (this.gtao) { this.gtao.dispose(); this.gtao = null; }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa || 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    if (q.ao) {
      this.composer.addPass(new LayerPass(this.scene, this.camera, 1 << 0, true));
      // AO at half resolution on Înaltă (soft anyway), full on Clip.
      const aoScale = q.aoScale || 0.5;
      this.gtao = new FxSafeGTAOPass(this.scene, this.camera, Math.max(1, Math.round(size.x * aoScale)), Math.max(1, Math.round(size.y * aoScale)));
      const aoSize = this.gtao.setSize.bind(this.gtao);
      this.gtao.setSize = (w, h) => aoSize(Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale)));
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtao.needsSwap = false;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
      this.composer.addPass(new AOBlendPass(this.gtao));
      this.composer.addPass(new LayerPass(this.scene, this.camera, 1 << FX_LAYER, false));
    } else {
      this.composer.addPass(new RenderPass(this.scene, this.camera));
    }
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outputPass);
  }

  /** Floors: planar reflection (Înaltă / Clip), stronger env-map gloss (Medie) or as built (Scăzută). */
  _applyFloors() {
    const mode = this.quality ? this.quality.reflections : 'off';
    const finishName = this.room?.floorFinish || 'satin';
    for (const list of this.floors.values()) {
      for (const { mesh, kind } of list) {
        const mat = mesh.material;
        if (!mat || !mat.isMeshStandardMaterial) continue;
        const ud = mat.userData;
        if (ud.baseRoughness === undefined) { ud.baseRoughness = mat.roughness; ud.baseEnv = mat.envMapIntensity; }
        const f = floorFinish(finishName, kind);
        if (mode === 'off') {
          mat.roughness = ud.baseRoughness;
          mat.envMapIntensity = ud.baseEnv;
        } else {
          mat.roughness = f.roughness;
          mat.envMapIntensity = mode === 'env' ? 2.5 * (1 - f.roughness) + 0.5 : 1;
        }
        // Always patched (highlight knee); the mirror image only on Înaltă / Clip.
        this.reflection.attach(mesh, mode === 'planar' ? f : { strength: 0, blur: f.blur });
      }
    }
  }

  _registerFloor(key, mesh, kind) {
    if (!mesh) return;
    mesh.userData.floor = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const list = this.floors.get(key) || [];
    list.push({ mesh, kind });
    this.floors.set(key, list);
  }

  _unregisterFloors(key) {
    const list = this.floors.get(key);
    if (!list) return;
    for (const { mesh } of list) this.reflection.detach(mesh);
    this.floors.delete(key);
  }

  resize() {
    const w = this.fixedSize ? this.fixedSize[0] : this.container.clientWidth || 1;
    const h = this.fixedSize ? this.fixedSize[1] : this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, !this.fixedSize);
    this.composer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.reflection.setSize(buf.x, buf.y);
    this.labels.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1);
  }

  // ------------------------------------------------------------ room
  buildRoom(room) {
    for (const c of [...this.roomGroup.children]) {
      this.roomGroup.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
      });
    }
    const w = room.width || 24;
    const d = room.depth || 24;
    const hgt = room.height || 6;
    this.venue = null;
    if (room.style === 'banquet' || room.style === 'plain') {
      this.venue = buildVenue(room, this.roomGroup, this.ctx);
      this.venue.setHouse(this.houseLevel());
    } else {
      this._buildDarkRoom(room, w, d, hgt);
    }
    this.ctx.roomBox.min.set(-w / 2, 0, -d / 2);
    this.ctx.roomBox.max.set(w / 2, hgt, d / 2);
    this.ctx.walls = room.walls !== false;
    this.room = room;
    // Floor finish and shadows of the room.
    this._unregisterFloors('room');
    this.roomGroup.traverse((o) => { if (o.isMesh && o.userData.floor) this._registerFloor('room', o, 'room'); });
    this._markShadows(this.roomGroup, 'room');
    this._applyFloors();
    if (room.walls !== false) {
      roomUniforms.uRoomMin.value.set(-w / 2, 0, -d / 2);
      roomUniforms.uRoomMax.value.set(w / 2, hgt, d / 2 + 50);
    } else {
      roomUniforms.uRoomMin.value.set(-1000, 0, -1000);
      roomUniforms.uRoomMax.value.set(1000, 1000, 1000);
    }
    this.room = room;
  }

  /** Original dark "club" room: flat colours, no decor. */
  _buildDarkRoom(room, w, d, hgt) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: room.floorColor || '#1b1b1f', roughness: room.floorRoughness ?? 0.55, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.userData.isRoom = true;
    floor.userData.floor = true;
    this.roomGroup.add(floor);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x2a2a33, 0x18181e);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = room.grid === false ? 0 : 0.35;
    grid.raycast = () => {};
    this.roomGroup.add(grid);
    if (room.walls === false) return;
    const wallMat = () => new THREE.MeshStandardMaterial({ color: room.wallColor || '#16161a', roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), wallMat());
    back.position.set(0, hgt / 2, -d / 2);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(d, hgt), wallMat());
    left.rotation.y = Math.PI / 2;
    left.position.set(-w / 2, hgt / 2, 0);
    const right = left.clone();
    right.material = wallMat();
    right.rotation.y = -Math.PI / 2;
    right.position.x = w / 2;
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.95 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = hgt;
    for (const m of [back, left, right, ceiling]) { m.userData.isRoom = true; this.roomGroup.add(m); }
  }

  /** House light level 0..1 (work lights force it to full). */
  houseLevel() {
    const s = this.settings;
    if (s.workLights) return 1;
    return Math.max(0, Math.min(1, s.houseLight ?? (s.ambient ?? 0.25) / 1.2));
  }

  applySettings() {
    const s = this.settings;
    const h = this.houseLevel();
    // With the house lights up, only real light sources should glow, not white tablecloths.
    // Glow only around real highlights (lenses, hot spots), not a veil over the whole picture.
    // (v1.8 strength and radius: the glowing lenses stay; the floors' highlight knee in reflections.js
    // keeps light pools on glossy floors from turning into blobs.)
    this.bloom.strength = s.bloom * (1 - h * 0.4);
    this.bloom.radius = 0.5;
    // Lit surfaces are soft-limited to ~2.4 (patchHighlightKnee): lenses / LEDs (emissive 4–12) glow, floors barely.
    this.bloom.threshold = 1.3 + h * 0.45;
    this.bloom.enabled = s.bloom > 0.01;
    this.hemi.intensity = 0.03 + h * 0.8 + (s.workLights ? 0.45 : 0);
    this.workLight.intensity = s.workLights ? 1.5 : h * 0.25;
    this.scene.environmentIntensity = 0.04 + h * 0.4 + (s.workLights ? 0.2 : 0);
    if (this.venue) this.venue.setHouse(h);
    const dark = new THREE.Color(0x030305);
    const lit = new THREE.Color(0x2b2724);
    const c = dark.lerp(lit, h);
    this.scene.background.copy(c);
    this.scene.fog.color.copy(c);
    this.scene.fog.density = 0.012 * (1 - h * 0.7);
    this.labels.domElement.style.display = s.showLabels ? '' : 'none';
    this.fpsDiv.style.display = s.showFps ? '' : 'none';
    if (this.qualityKey !== this.qualityName()) this.applyQuality();
  }

  // ------------------------------------------------------------ shadows / layers of new objects
  /**
   * Who casts and receives shadows, and which objects are "haze / effects" (drawn after the AO).
   * kind: 'fixture' (receives only: the light sits inside the fixture), 'prop', 'room'.
   */
  _markShadows(root, kind) {
    root.traverse((o) => {
      if (o.isLight) { o.layers.enable(FX_LAYER); return; }
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      if (o.userData.shadowMarked === kind) return;
      o.userData.shadowMarked = kind;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const fx = o.isPoints || o.isLine || o.isSprite || (m && (m.isShaderMaterial || m.blending === THREE.AdditiveBlending)) || (m && m.transparent && m.depthWrite === false);
      if (fx) { o.layers.set(FX_LAYER); o.castShadow = false; o.receiveShadow = false; return; }
      o.receiveShadow = true;
      // Fixtures are drawn after the AO too: glowing lenses and reflector cups must not be darkened.
      if (kind === 'fixture') { o.layers.set(FX_LAYER); o.castShadow = false; return; }
      if (o.userData.floor || o.userData.reflective) { o.castShadow = false; return; }
      const flat = o.geometry && o.geometry.type === 'PlaneGeometry';
      const glow = m && (m.isMeshBasicMaterial || m.transparent);
      // Room: walls, floor and ceiling don't need to cast (the lights are inside); decor does.
      o.castShadow = !glow && !(kind === 'room' && flat);
    });
  }

  /** Re-check every object now and then: 3D models and guests can arrive later (async load). */
  _rescanShadows(dt) {
    this._scanTimer = (this._scanTimer || 0) - dt;
    if (this._scanTimer > 0) return;
    this._scanTimer = 1;
    for (const o of this.objects.values()) this._markShadows(o.model.root, o.type === 'fixture' ? 'fixture' : 'prop');
    this._markShadows(this.ctx.world, 'prop');
    // Seated guests at the tables (low-detail bodies) cast shadows only on Clip video:
    // every shadow light would redraw them, and they sit away from the show lights.
    const seated = (this.quality?.shadows || 0) >= 20;
    for (const o of this.objects.values()) {
      if (o.type !== 'prop' || (o.data.type !== 'table' && o.data.type !== 'headtable')) continue;
      o.model.root.traverse((m) => { if (m.userData.guests) m.castShadow = seated; });
    }
  }

  // ------------------------------------------------------------ objects
  addFixture(fixture, profile) {
    this.removeObject(fixture.id);
    const model = createFixtureModel(fixture, profile, this.ctx);
    this.scene.add(model.root);
    this.objects.set(fixture.id, { type: 'fixture', model, data: fixture, profile });
    this._applyTransform(model.root, fixture);
    this._markShadows(model.root, 'fixture');
    this._markShadows(this.ctx.world, 'prop');
    // Beams are cut by the shadow of their own fixture's light.
    if (model.light && model.beams) for (const b of model.beams) b.setShadowLight?.(model.light);
    if (this.selectedIds.includes(fixture.id)) this.setSelection(this.selectedIds);
    return model;
  }

  addProp(prop) {
    this.removeObject(prop.id);
    const model = createPropModel(prop, this.ctx);
    this.scene.add(model.root);
    this.objects.set(prop.id, { type: 'prop', model, data: prop });
    this._applyTransform(model.root, prop);
    if (prop.type === 'dancefloor') {
      // The biggest flat part (or the one tagged userData.floor) is the glossy surface.
      let best = null; let area = 0;
      model.root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        const a = (b.max.x - b.min.x) * (b.max.z - b.min.z) * o.scale.x * o.scale.z + (o.userData.floor ? 1e6 : 0);
        if (a > area) { area = a; best = o; }
      });
      this._registerFloor(prop.id, best, 'dance');
      this._applyFloors();
    }
    this._markShadows(model.root, 'prop');
    this._markShadows(this.ctx.world, 'prop');
    if (this.selectedIds.includes(prop.id)) this.setSelection(this.selectedIds);
    return model;
  }

  removeObject(id) {
    const o = this.objects.get(id);
    if (!o) return;
    if (this.transform.object === o.model.root) this.transform.detach();
    this.selectedIds = this.selectedIds.filter((x) => x !== id);
    this.scene.remove(o.model.root);
    this._unregisterFloors(id);
    o.model.dispose();
    this.objects.delete(id);
  }

  clear() {
    for (const id of [...this.objects.keys()]) this.removeObject(id);
    this.setSelection([]);
  }

  updateTransform(item) {
    const o = this.objects.get(item.id);
    if (o) this._applyTransform(o.model.root, item);
  }

  refreshLabel(id) {
    const o = this.objects.get(id);
    if (o && o.model.refreshLabel) o.model.refreshLabel();
  }

  _applyTransform(root, item) {
    const p = item.position || { x: 0, y: 0, z: 0 };
    const r = item.rotation || { x: 0, y: 0, z: 0 };
    root.position.set(p.x, p.y, p.z);
    root.rotation.set(D2R(r.x), D2R(r.y), D2R(r.z), 'YXZ');
  }

  _readTransform(id) {
    const root = this.objects.get(id).model.root;
    const round = (v, n = 1000) => Math.round(v * n) / n;
    return {
      id,
      position: { x: round(root.position.x), y: round(root.position.y), z: round(root.position.z) },
      rotation: { x: round(R2D(root.rotation.x), 10), y: round(R2D(root.rotation.y), 10), z: round(R2D(root.rotation.z), 10) },
    };
  }

  // ------------------------------------------------------------ selection
  get selectedId() {
    return this.selectedIds[this.selectedIds.length - 1] || null;
  }

  /** Shortcut: select one object (or nothing). */
  select(id) {
    this.setSelection(id ? [id] : []);
  }

  setSelection(ids) {
    this.selectedIds = (ids || []).filter((id) => this.objects.has(id));
    while (this.selHelpers.length < this.selectedIds.length) {
      const box = new THREE.Box3();
      const helper = new THREE.Box3Helper(box, 0x4da3ff);
      helper.raycast = () => {};
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 2.5, 0xffc23d, 0.32, 0.16);
      arrow.raycast = () => {};
      arrow.traverse((o) => {
        if (o.material) { o.material.depthTest = false; o.material.transparent = true; o.material.opacity = 0.9; }
        o.raycast = () => {};
        o.renderOrder = 20;
      });
      this.scene.add(helper, arrow);
      this.selHelpers.push({ box, helper, arrow });
    }
    this.selHelpers.forEach((h, i) => {
      h.helper.visible = i < this.selectedIds.length;
      h.arrow.visible = false;
      // Locked objects get a red box.
      if (h.helper.visible) h.helper.material.color.set(this.lockedIds.has(this.selectedIds[i]) ? 0xff4d5e : 0x4da3ff);
    });
    this._updateSelectionHelpers();
    this._attachGizmo();
  }

  /** Ids of locked objects: they get no gizmo and a red outline. */
  setLocked(ids) {
    this.lockedIds = new Set(ids);
  }

  _movableIds() {
    return this.selectedIds.filter((id) => this.objects.has(id) && !this.lockedIds.has(id));
  }

  _attachGizmo() {
    const ids = this._movableIds();
    if (!ids.length) {
      this.transform.detach();
      if (this.selectedIds.length) this.onGizmoInfo(tr('🔒 Blocat – apasă K sau 🔓 în inspector ca să-l poți muta'));
      else this.onGizmoInfo(null);
      return;
    }
    if (ids.length < this.selectedIds.length) this.onGizmoInfo(tr('🔒 Obiectele blocate rămân pe loc'));
    else this.onGizmoInfo(null);
    if (ids.length === 1 && this.transform.mode === 'rotate') {
      this.transform.attach(this.objects.get(ids[0]).model.root);
    } else {
      // Moving: the arrows follow the camera (left/right on screen, towards/away from you),
      // so dragging the "right" arrow never slides the object backwards.
      this._placePivot(ids);
      this.pivot.quaternion.identity();
      if (this.transform.mode === 'translate') this.pivot.rotation.y = this.cameraYaw();
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrix();
      this.pivot.updateMatrixWorld(true);
      this.transform.attach(this.pivot);
    }
    this._applySpace();
  }

  /** Pivot at the object's origin (one object) or the middle of the group. */
  _placePivot(ids) {
    if (ids.length === 1) {
      this.objects.get(ids[0]).model.root.getWorldPosition(this.pivot.position);
      return;
    }
    const box = new THREE.Box3();
    for (const id of ids) box.union(computeBounds(this.objects.get(id).model.root, new THREE.Box3()));
    box.getCenter(this.pivot.position);
  }

  /**
   * Camera heading around Y: the pivot's +X then points right on screen and +Z towards
   * the camera. Within 12° of a room axis it snaps to it, so normal views stay on the grid.
   */
  cameraYaw() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    if (f.x * f.x + f.z * f.z < 1e-6) return 0;
    let yaw = Math.atan2(-f.x, -f.z);
    const q = Math.PI / 2;
    const near = Math.round(yaw / q) * q;
    if (Math.abs(yaw - near) < D2R(12)) yaw = near;
    return yaw;
  }

  /** Moving: arrows in the pivot's (camera) frame. Rotating: one object around its own axes, a group around the room's. */
  _applySpace() {
    const local = this.transform.mode === 'translate' || this._movableIds().length === 1;
    this.transform.setSpace(local ? 'local' : 'world');
  }

  /** Every frame while not dragging: the pivot follows the objects (keys, pad) and the camera. */
  _syncPivot() {
    if (this.transform.object !== this.pivot || this.transform.dragging) return;
    const ids = this._movableIds();
    if (!ids.length) return;
    if (ids.length === 1 || ids.length <= 12) this._placePivot(ids);
    if (this.transform.mode === 'translate') this.pivot.rotation.set(0, this.cameraYaw(), 0);
    this.pivot.updateMatrix();
    this.pivot.updateMatrixWorld(true);
  }

  _onGizmoChange() {
    const ids = this._movableIds();
    if (!ids.length) return;
    if (this.transform.object === this.pivot && this._dragStart) {
      // Apply the pivot's change since the drag started to every member.
      this.pivot.updateMatrix();
      const delta = this.pivot.matrix.clone().multiply(this._dragStart.pivot.clone().invert());
      for (const m of this._dragStart.members) {
        const root = this.objects.get(m.id)?.model.root;
        if (!root) continue;
        delta.clone().multiply(m.matrix).decompose(root.position, root.quaternion, root.scale);
        root.scale.set(1, 1, 1);
      }
    }
    this._updateSelectionHelpers();
    const changes = ids.filter((id) => this.objects.has(id)).map((id) => this._readTransform(id));
    this.onTransform(changes);
    const last = changes[changes.length - 1];
    if (!last) return;
    const f = (v) => v.toFixed(2);
    if (this.transform.mode === 'rotate') {
      this.onGizmoInfo(ids.length > 1
        ? tr('Rotire grup · {n} obiecte', { n: ids.length })
        : tr('Înclinare {x}° · Rotire {y}° · Lateral {z}°', { x: Math.round(last.rotation.x), y: Math.round(last.rotation.y), z: Math.round(last.rotation.z) }));
    } else {
      this.onGizmoInfo(ids.length > 1
        ? tr('Mutare grup · {n} obiecte', { n: ids.length })
        : tr('X {x} m · Înălțime {y} m · Z {z} m', { x: f(last.position.x), y: f(last.position.y), z: f(last.position.z) }));
    }
  }

  _updateSelectionHelpers() {
    this.selectedIds.forEach((id, i) => {
      const o = this.objects.get(id);
      const h = this.selHelpers[i];
      if (!o || !h) return;
      computeBounds(o.model.root, h.box);
      // Direction arrow: where the light goes (beam for moving heads, +Y otherwise).
      if (o.type === 'fixture' && !['fog', 'lowfog', 'spark'].includes(o.profile.kind)) {
        const src = o.model.beam ? o.model.beam.mesh : o.model.root;
        src.updateWorldMatrix(true, false);
        h.arrow.position.setFromMatrixPosition(src.matrixWorld);
        h.arrow.setDirection(new THREE.Vector3().setFromMatrixColumn(src.matrixWorld, 1).normalize());
        h.arrow.visible = true;
      } else {
        h.arrow.visible = false;
      }
    });
  }

  setTransformMode(mode) {
    this.transform.setMode(mode);
    this._attachGizmo();
  }

  setSnap(on) {
    this.settings.snap = on;
    this.transform.setTranslationSnap(on ? 0.1 : null);
    this.transform.setRotationSnap(on ? D2R(5) : null);
  }

  // ------------------------------------------------------------ camera-relative moves
  /**
   * World directions for "right" and "towards me" as seen from the camera,
   * snapped to the nearest world axis so moves stay on the grid.
   */
  cameraAxes() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const toward = Math.abs(dir.x) > Math.abs(dir.z) ? { x: -Math.sign(dir.x), z: 0 } : { x: 0, z: -Math.sign(dir.z) };
    // right = forward × up, forward = −toward
    const right = { x: toward.z, z: -toward.x };
    return { right, toward };
  }

  // ------------------------------------------------------------ axis hints next to the gizmo
  _updateAxisHints() {
    if (!this._hints) {
      this._hints = ['x', 'y', 'z'].map((axis) => {
        const div = document.createElement('div');
        div.className = `axis-hint axis-${axis}`;
        this.container.appendChild(div);
        return div;
      });
    }
    const show = this.selectedIds.length && this.transform.object && !this._placing;
    if (!show) { for (const d of this._hints) d.style.display = 'none'; return; }
    const obj = this.transform.object;
    const origin = obj.getWorldPosition(new THREE.Vector3());
    const dist = origin.distanceTo(this.camera.position);
    const len = dist * 0.16;
    const rotate = this.transform.mode === 'rotate';
    const labels = rotate
      ? { x: '', y: tr('⟳ rotire: trage de cercul verde (sau Alt + rotița)'), z: '' }
      : this.hintLabels || { x: tr('⟷ stânga / dreapta'), y: tr('↕ sus / jos'), z: tr('⤢ față / spate') };
    const q = this.transform.space === 'local' ? obj.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const w = this.container.clientWidth; const h = this.container.clientHeight;
    ['x', 'y', 'z'].forEach((axis, i) => {
      if (!labels[axis]) { this._hints[i].style.display = 'none'; return; }
      const dir = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).applyQuaternion(q);
      // Rotate mode: the label sits beside the horizontal ring, not on the up axis.
      if (rotate) dir.set(1, 0, 0).applyQuaternion(q).multiplyScalar(1.1);
      const p = origin.clone().addScaledVector(dir, len);
      p.project(this.camera);
      const div = this._hints[i];
      if (p.z > 1) { div.style.display = 'none'; return; }
      div.style.display = '';
      div.textContent = labels[axis];
      div.style.transform = `translate(${((p.x + 1) / 2) * w + 8}px, ${((1 - p.y) / 2) * h - 10}px)`;
    });
  }

  // ------------------------------------------------------------ place with the mouse
  /**
   * Fixture placement: a ghost follows the mouse and snaps to the surface under it.
   * onPlace({ position, rotation, surface }) is called on click; Esc / cancelPlacement() stops.
   */
  startPlacement(onPlace, onCancel) {
    this.cancelAim();
    this.cancelPlacement(false);
    const ghost = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9d7bff, transparent: true, opacity: 0.8, depthTest: false }));
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.8, 0xffd23a, 0.2, 0.12);
    arrow.line.material.depthTest = false;
    arrow.cone.material.depthTest = false;
    ghost.add(dot, arrow);
    ghost.renderOrder = 999;
    ghost.visible = false;
    ghost.traverse((o) => { o.raycast = () => {}; });
    this.scene.add(ghost);
    this._placing = { onPlace, onCancel, ghost, arrow, current: null };
    this.renderer.domElement.style.cursor = 'copy';
    this.setSelection([]);
  }

  cancelPlacement(notify = true) {
    const p = this._placing;
    if (!p) return;
    this.scene.remove(p.ghost);
    this._placing = null;
    this.renderer.domElement.style.cursor = '';
    if (notify && p.onCancel) p.onCancel();
  }

  /** Surface under the mouse → where and how a fixture would be mounted there. */
  _placementAt(e) {
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const props = [...this.objects.values()].filter((o) => o.type === 'prop' && !['crowd', 'mirrorball'].includes(o.data.type));
    const targets = [this.roomGroup, ...props.map((o) => o.model.root)];
    const hit = this.raycaster.intersectObjects(targets, true).find((h) => h.face);
    const v = (x, y, z) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 });
    // Truss tubes are thin: give each truss a generous invisible hit box.
    let best = null;
    for (const o of props) {
      if (o.data.type !== 'truss') continue;
      const box = computeBounds(o.model.root, new THREE.Box3()).expandByScalar(0.18);
      const pt = this.raycaster.ray.intersectBox(box, new THREE.Vector3());
      if (!pt) continue;
      const dist = pt.distanceTo(this.raycaster.ray.origin);
      if (!best || dist < best.dist) best = { dist, pt, o };
    }
    // Tripod stands: snap onto the T-bar (or the top plate), Alt = hang under the bar.
    let stand = null;
    for (const o of props) {
      if (o.data.type !== 'tripod') continue;
      const { height, bar } = tripodParams(o.data.params);
      const inv = o.model.root.matrixWorld.clone().invert();
      const ray = this.raycaster.ray.clone().applyMatrix4(inv);
      const half = bar > 0 ? bar / 2 : 0;
      const box = new THREE.Box3(new THREE.Vector3(-half - 0.1, height - 0.45, -0.14), new THREE.Vector3(half + 0.1, height + 0.22, 0.14));
      const pt = ray.intersectBox(box, new THREE.Vector3());
      const own = hit && this._objectIdOf(hit.object) === o.data.id;
      if (!pt && !own) continue;
      const dist = pt ? pt.applyMatrix4(o.model.root.matrixWorld).distanceTo(this.raycaster.ray.origin) : hit.distance;
      if (stand && dist >= stand.dist) continue;
      const onBar = new THREE.Vector3();
      ray.distanceSqToSegment(new THREE.Vector3(-half, height, 0), new THREE.Vector3(half, height, 0), null, onBar);
      stand = { dist, o, offset: Number.isFinite(onBar.x) ? onBar.x : 0 };
    }
    // Light totems: anywhere on (or just above) the top plate puts the fixture on it.
    for (const o of props) {
      if (o.data.type !== 'totem') continue;
      const { height, plate } = totemParams(o.data.params);
      const inv = o.model.root.matrixWorld.clone().invert();
      const ray = this.raycaster.ray.clone().applyMatrix4(inv);
      const box = new THREE.Box3(new THREE.Vector3(-plate / 2 - 0.05, height - 0.3, -plate / 2 - 0.05), new THREE.Vector3(plate / 2 + 0.05, height + 0.25, plate / 2 + 0.05));
      const pt = ray.intersectBox(box, new THREE.Vector3());
      if (!pt) continue;
      const dist = pt.clone().applyMatrix4(o.model.root.matrixWorld).distanceTo(this.raycaster.ray.origin);
      if (stand && dist >= stand.dist) continue;
      stand = { dist, o, offset: pt.x, totem: true };
    }
    if (stand && (!hit || stand.dist <= hit.distance + 0.3) && (!best || stand.dist <= best.dist)) {
      if (stand.totem) {
        const at = totemMount(stand.o.data, stand.offset);
        return { surface: 'totem', position: at.position, rotation: at.rotation };
      }
      const at = tripodMount(stand.o.data, stand.offset, !!(e && e.altKey));
      return { surface: 'stand', position: at.position, rotation: at.rotation };
    }
    if (best && (!hit || best.dist <= hit.distance + 0.3)) {
      const tp = best.o.model.root.position;
      const horizontal = Math.abs(best.o.model.root.rotation.z) < 0.3;
      return horizontal
        ? { surface: 'truss', position: v(best.pt.x, tp.y - 0.17, tp.z), rotation: { x: 180, y: 0, z: 0 } }
        : { surface: 'truss', position: v(tp.x, best.pt.y, tp.z + 0.2), rotation: { x: 90, y: 0, z: 0 } };
    }
    if (!hit) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const propId = this._objectIdOf(hit.object);
    const prop = propId ? this.objects.get(propId) : null;
    // Road case lid: exact height (also for stacked cases), whatever part of the lid was hit.
    if (n.y > 0.7 && prop && prop.data.type === 'case' && Math.abs(prop.data.rotation?.x || 0) < 1 && Math.abs(prop.data.rotation?.z || 0) < 1) {
      return { surface: 'case', position: v(hit.point.x, caseTop(prop.data), hit.point.z), rotation: { x: 0, y: 0, z: 0 } };
    }
    if (n.y > 0.7) return { surface: prop ? 'top' : 'floor', position: v(hit.point.x, hit.point.y, hit.point.z), rotation: { x: 0, y: 0, z: 0 } };
    if (n.y < -0.7) return { surface: 'ceiling', position: v(hit.point.x, hit.point.y - 0.05, hit.point.z), rotation: { x: 180, y: 0, z: 0 } };
    // Wall (or the side of an object): stand off 15 cm, light pointing into the room.
    const pos = hit.point.clone().addScaledVector(n, 0.15);
    const heading = THREE.MathUtils.radToDeg(Math.atan2(n.x, n.z));
    return { surface: 'wall', position: v(pos.x, Math.max(0.2, pos.y), pos.z), rotation: { x: 90, y: Math.round(heading), z: 0 } };
  }

  _updatePlacementGhost(e) {
    const p = this._placing;
    const at = this._placementAt(e);
    p.current = at;
    p.ghost.visible = !!at;
    if (!at) return;
    p.ghost.position.set(at.position.x, at.position.y, at.position.z);
    const r = at.rotation;
    const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(D2R(r.x), D2R(r.y), D2R(r.z), 'YXZ'));
    p.arrow.setDirection(dir);
  }

  /** The next click in the scene picks a point (floor, wall, object) and calls back with it. */
  startAim(callback) {
    this._aim = callback;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  cancelAim() {
    this._aim = null;
    this.renderer.domElement.style.cursor = '';
  }

  /**
   * Drag of the selected objects with the mouse: they slide on a horizontal plane and stay
   * under the cursor (right on screen = right). Shift = only in the direction the move
   * started, Alt = only up / down. A single fixture dragged over a truss, stand, case or
   * totem snaps onto it. Locked objects stay put.
   */
  _dragObjects(e) {
    const d = this._objDrag;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) <= 4) return;
      const ids = this._movableIds();
      if (!ids.length) { this._objDrag = null; this.orbit.enabled = true; return; }
      d.started = true;
      d.members = ids.map((id) => ({ id, start: this.objects.get(id).model.root.position.clone(), rot: this.objects.get(id).model.root.rotation.clone() }));
      d.axes = viewAxes(this.cameraYaw());
      try { this.renderer.domElement.setPointerCapture(d.pointerId); } catch (_) { /* old browsers */ }
      this.renderer.domElement.style.cursor = 'grabbing';
      this._setHover(null);
      this.onTransformStart(ids);
    }
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const ray = this.raycaster.ray;
    const vertical = e.altKey;
    let raw = null;
    if (vertical) {
      // Plane through the grab point facing the camera (horizontally): only its height is used.
      const n = new THREE.Vector3();
      this.camera.getWorldDirection(n);
      n.y = 0;
      if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
      const pt = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), d.grab), new THREE.Vector3());
      if (pt) raw = { x: 0, y: pt.y - d.grab.y, z: 0 };
    } else {
      const pt = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.grab.y), new THREE.Vector3());
      // Looking almost along the floor the plane point runs away: keep the move within 40 m.
      if (pt && pt.distanceTo(d.grab) < 40) raw = { x: pt.x - d.grab.x, y: 0, z: pt.z - d.grab.z };
    }
    if (!raw) return;
    if (e.shiftKey && !vertical) d.lock = d.lock || chooseLockAxis(raw, d.axes);
    else d.lock = null;
    const delta = dragDelta(raw, { axes: d.axes, lock: d.lock, vertical, snap: this.settings.snap ? 0.05 : 0 });
    // One fixture over a mounting point: it goes onto it (like placing with the mouse).
    let mount = null;
    if (d.members.length === 1 && !vertical && !e.shiftKey && this.objects.get(d.members[0].id)?.type === 'fixture') {
      const at = this._placementAt(e);
      if (at && ['truss', 'stand', 'case', 'totem'].includes(at.surface)) mount = at;
    }
    for (const m of d.members) {
      const root = this.objects.get(m.id)?.model.root;
      if (!root) continue;
      if (mount) {
        root.position.set(mount.position.x, mount.position.y, mount.position.z);
        root.rotation.set(D2R(mount.rotation.x), D2R(mount.rotation.y), D2R(mount.rotation.z), 'YXZ');
      } else {
        root.position.set(m.start.x + delta.x, Math.max(0, m.start.y + delta.y), m.start.z + delta.z);
        if (d.mounted) root.rotation.copy(m.rot);
      }
    }
    d.mounted = !!mount;
    this._updateSelectionHelpers();
    const changes = d.members.filter((m) => this.objects.has(m.id)).map((m) => this._readTransform(m.id));
    this.onTransform(changes);
    const last = changes[changes.length - 1];
    if (last) {
      const f = (v) => v.toFixed(2);
      this.onGizmoInfo(vertical ? tr('Înălțime {y} m (Alt)', { y: f(last.position.y) })
        : d.lock ? tr('Doar {dir} (Shift) · X {x} m · Z {z} m', { dir: d.lock === 'right' ? tr('stânga / dreapta') : tr('față / spate'), x: f(last.position.x), z: f(last.position.z) })
          : tr('X {x} m · Înălțime {y} m · Z {z} m', { x: f(last.position.x), y: f(last.position.y), z: f(last.position.z) }));
    }
  }

  /** Alt + mouse wheel turns the selection (Shift = fine steps); the plain wheel still zooms. */
  _onWheel(e) {
    if (!e.altKey || !this._movableIds().length || this._placing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const delta = e.deltaMode === 1 ? raw * 33 : e.deltaMode === 2 ? raw * 400 : raw;
    const { deg, acc } = wheelTurn(this._wheelAcc || 0, delta, e.shiftKey);
    this._wheelAcc = acc;
    // Wheel down / towards you = clockwise seen from above.
    if (deg) this.onWheelRotate(-deg);
  }

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  _onPointerDown(e) {
    this._pointerDown = { x: e.clientX, y: e.clientY };
    // Press on an object that is already selected: dragging moves it (see _dragObjects).
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !this.transform.axis && !this._aim && !this._placing && this._movableIds().length) {
      this.raycaster.setFromCamera(this._ndc(e), this.camera);
      const id = this._pickId();
      if (id && this.selectedIds.includes(id)) {
        const hit = this.raycaster.intersectObject(this.objects.get(id).model.root, true)[0];
        const grab = hit ? hit.point.clone() : this.objects.get(id).model.root.getWorldPosition(new THREE.Vector3());
        this._objDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, grab, started: false };
        this.orbit.enabled = false; // the camera stays put while an object is dragged
        return;
      }
    }
    if (e.button === 0 && e.shiftKey && !this.transform.axis && !this._aim && !this._placing) {
      // Rectangle selection.
      this.orbit.enabled = false;
      const rect = this.container.getBoundingClientRect();
      const div = document.createElement('div');
      div.className = 'marquee';
      this.container.appendChild(div);
      this._marquee = { x0: e.clientX - rect.left, y0: e.clientY - rect.top, div, add: e.ctrlKey || e.metaKey };
      this._onPointerMove(e);
    }
  }

  _onPointerMove(e) {
    if (this._objDrag) { this._dragObjects(e); return; }
    if (this._placing) { this._updatePlacementGhost(e); return; }
    const m = this._marquee;
    if (!m) {
      // Hover highlight, at most once per frame and not while dragging.
      if (e.buttons || this.transform.dragging || this.transform.axis || this._aim) { this._setHover(null); return; }
      this._hoverEvent = e;
      if (!this._hoverQueued) {
        this._hoverQueued = true;
        requestAnimationFrame(() => { this._hoverQueued = false; this._updateHover(this._hoverEvent); });
      }
      return;
    }
    const rect = this.container.getBoundingClientRect();
    m.x1 = e.clientX - rect.left;
    m.y1 = e.clientY - rect.top;
    Object.assign(m.div.style, {
      left: `${Math.min(m.x0, m.x1)}px`,
      top: `${Math.min(m.y0, m.y1)}px`,
      width: `${Math.abs(m.x1 - m.x0)}px`,
      height: `${Math.abs(m.y1 - m.y0)}px`,
    });
  }

  /** Ids of objects whose centre lands inside a screen rectangle (container pixels). */
  idsInRect(x0, y0, x1, y1) {
    const w = this.container.clientWidth; const h = this.container.clientHeight;
    const ids = [];
    const c = new THREE.Vector3();
    for (const [id, o] of this.objects) {
      computeBounds(o.model.root, new THREE.Box3()).getCenter(c);
      c.project(this.camera);
      if (c.z > 1) continue; // behind the camera
      const sx = ((c.x + 1) / 2) * w; const sy = ((1 - c.y) / 2) * h;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(id);
    }
    // Prefer fixtures: props (walls, crowd…) only when no fixture is inside.
    const fixtures = ids.filter((id) => this.objects.get(id).type === 'fixture');
    return fixtures.length ? fixtures : ids;
  }

  _onPointerUp(e) {
    if (this._objDrag) {
      const d = this._objDrag;
      this._objDrag = null;
      this.orbit.enabled = true;
      this.renderer.domElement.style.cursor = '';
      try { this.renderer.domElement.releasePointerCapture(d.pointerId); } catch (_) { /* not captured */ }
      if (d.started) {
        this._pointerDown = null;
        this.onGizmoInfo(null);
        this.onTransformEnd(this.selectedIds);
        return;
      }
    }
    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      m.div.remove();
      this.orbit.enabled = true;
      this._pointerDown = null;
      const x0 = Math.min(m.x0, m.x1 ?? m.x0); const x1 = Math.max(m.x0, m.x1 ?? m.x0);
      const y0 = Math.min(m.y0, m.y1 ?? m.y0); const y1 = Math.max(m.y0, m.y1 ?? m.y0);
      if (x1 - x0 > 4 || y1 - y0 > 4) { this.onMarquee(this.idsInRect(x0, y0, x1, y1), { add: m.add }); return; }
    }
    if (!this._pointerDown) return;
    const moved = Math.hypot(e.clientX - this._pointerDown.x, e.clientY - this._pointerDown.y);
    this._pointerDown = null;
    if (moved > 4 || this.transform.dragging || e.button !== 0) return;
    if (this._placing) {
      this._updatePlacementGhost(e);
      const at = this._placing.current;
      if (at) this._placing.onPlace(at);
      return;
    }
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    if (this._aim) {
      const targets = [...this.objects.values()].map((o) => o.model.root).concat(this.roomGroup.children);
      const hit = this.raycaster.intersectObjects(targets, true).find((h) => !this.selectedIds.includes(this._objectIdOf(h.object)));
      const cb = this._aim;
      this.cancelAim();
      if (hit) cb(hit.point.clone());
      return;
    }
    this.onPick(this._pickId(), { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey, single: e.altKey });
  }

  /** Object under the raycaster. Fixtures win over props: a fixture hanging on a truss is picked even when the ray touches the truss first. */
  _pickId() {
    const roots = [...this.objects.values()].map((o) => o.model.root);
    let id = null;
    for (const h of this.raycaster.intersectObjects(roots, true)) {
      const hitId = this._objectIdOf(h.object);
      if (!hitId) continue;
      if (this.objects.get(hitId)?.type === 'fixture') { id = hitId; break; }
      id ??= hitId;
    }
    return id;
  }

  /** Double-click: just this object, even inside a group. */
  _onDoubleClick(e) {
    if (this._placing || this._aim) return;
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const id = this._pickId();
    if (id) this.onPick(id, { single: true });
  }

  _updateHover(e) {
    if (!e || this._placing || this._marquee) { this._setHover(null); return; }
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const id = this._pickId();
    const info = id ? this.hoverInfo(id) : null;
    this._setHover(info, e);
  }

  /** White box around the object (or its whole group) under the mouse; red when locked. */
  _setHover(info, e) {
    const canvas = this.renderer.domElement;
    if (!info) {
      if (this._hover) { this._hover.helper.visible = false; this._hover.tip.style.display = 'none'; }
      canvas.style.cursor = '';
      return;
    }
    if (!this._hover) {
      const box = new THREE.Box3();
      const helper = new THREE.Box3Helper(box, 0xffffff);
      helper.raycast = () => {};
      helper.material.transparent = true;
      helper.material.depthTest = false;
      helper.renderOrder = 19;
      this.scene.add(helper);
      const tip = document.createElement('div');
      tip.className = 'hover-tip';
      this.container.appendChild(tip);
      this._hover = { box, helper, tip };
    }
    const h = this._hover;
    h.box.makeEmpty();
    for (const id of info.ids) {
      const o = this.objects.get(id);
      if (o) h.box.union(computeBounds(o.model.root, new THREE.Box3()));
    }
    h.box.expandByScalar(0.03);
    h.helper.material.color.set(info.locked ? 0xff4d5e : 0xffffff);
    h.helper.material.opacity = info.locked ? 0.95 : 0.7;
    h.helper.visible = !h.box.isEmpty();
    canvas.style.cursor = info.locked ? 'not-allowed' : 'pointer';
    const rect = this.container.getBoundingClientRect();
    h.tip.textContent = info.label;
    h.tip.classList.toggle('locked', info.locked);
    h.tip.style.display = 'block';
    h.tip.style.left = `${e.clientX - rect.left + 14}px`;
    h.tip.style.top = `${e.clientY - rect.top + 16}px`;
  }

  /**
   * More fixtures than lights: the brightest MAX_LIGHTS lights are on, re-chosen a few
   * times per second. The number of lights on stays the same, so shaders don't recompile.
   */
  _updateLightPool(dt) {
    this._poolTimer = (this._poolTimer || 0) - dt;
    const max = this.maxLights;
    if (this.lightPool.size <= max) {
      if (this._poolCapped) { for (const l of this.lightPool) l.visible = true; this._poolCapped = false; }
      return;
    }
    if (this._poolTimer > 0) return;
    this._poolTimer = 0.15;
    this._poolCapped = true;
    // Spot and point lights get fixed shares, so a strobe flash doesn't change the
    // number of each kind (that would recompile every material).
    const spots = []; const points = [];
    for (const l of this.lightPool) (l.isSpotLight ? spots : points).push(l);
    const pointQuota = points.length ? Math.min(points.length, Math.max(1, Math.round(max * points.length / this.lightPool.size))) : 0;
    const quotas = [[spots, Math.min(spots.length, max - pointQuota)], [points, pointQuota]];
    for (const [arr, quota] of quotas) {
      // A light that is on gets a small bonus so the choice doesn't flicker.
      const list = arr.map((l) => ({ l, k: l.intensity * (l.visible ? 1.15 : 1) }));
      list.sort((a, b) => b.k - a.k);
      list.forEach((e, i) => { e.l.visible = i < quota; });
    }
  }

  /** Spot lights that cast shadows this frame (after the pool and the gobo slots are decided). */
  _updateShadowCasters() {
    const atlas = this.shadowAtlas;
    if (!atlas.count) return;
    const candidates = [];
    for (const l of this.lightPool) if (l.isSpotLight && l.visible && l.parent) candidates.push(l);
    atlas.assign(chooseCasters(candidates, atlas.count));
  }

  /** How many fixture lights exist and how many can be on (for the settings / audit). */
  lightBudget() {
    return { lights: this.lightPool.size, max: this.maxLights, shadows: this.shadowAtlas.slots.filter(Boolean).length, quality: this.qualityName() };
  }

  _objectIdOf(obj) {
    let o = obj;
    while (o && !o.userData.objectId) o = o.parent;
    return o ? o.userData.objectId : null;
  }

  /** Where the beam of an object starts (world space). */
  emitterOrigin(id) {
    const o = this.objects.get(id);
    if (!o) return null;
    const src = o.model.beam ? o.model.beam.mesh : o.model.root;
    src.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(src.matrixWorld);
  }

  // ------------------------------------------------------------ camera
  setView(name) {
    const views = {
      perspective: [[0, 5.5, 15], [0, 1.8, 0]],
      front: [[0, 2.2, 16], [0, 2.2, 0]],
      top: [[0, 26, 0.01], [0, 0, 0]],
      side: [[17, 3.5, 0], [0, 2, 0]],
      dj: [[0, 1.75, (this.room?.depth || 24) / -2 + 3.2], [0, 1.6, 8]],
      crowd: [[2, 1.7, 7], [0, 2.8, -4]],
    };
    const v = views[name] || views.perspective;
    this._animateCamera(new THREE.Vector3(...v[0]), new THREE.Vector3(...v[1]));
  }

  focusSelected() {
    if (!this.selectedIds.length) return;
    const box = new THREE.Box3();
    for (const id of this.selectedIds) box.union(computeBounds(this.objects.get(id).model.root, new THREE.Box3()));
    const p = box.getCenter(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize().multiplyScalar(4);
    this._animateCamera(p.clone().add(dir), p);
  }

  _animateCamera(pos, target) {
    this._camAnim = { fromPos: this.camera.position.clone(), fromTarget: this.orbit.target.clone(), pos, target, t: 0 };
  }

  getCamera() {
    const p = this.camera.position; const t = this.orbit.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setCamera(c) {
    if (!c) return;
    this._camAnim = null;
    this.camera.position.set(...c.position);
    this.orbit.target.set(...c.target);
    this.orbit.update();
  }

  _collectEmitters() {
    const out = [];
    for (const o of this.objects.values()) {
      if (o.type === 'fixture' && o.model.emitter) {
        const e = o.model.emitter();
        if (e && e.intensity > 0.01) out.push(e);
      }
    }
    return out;
  }

  _countFps(dt) {
    const f = this._fps;
    f.frames++;
    f.time += dt;
    if (f.time < 0.5) return;
    const fps = f.frames / f.time;
    f.frames = 0; f.time = 0;
    this.fps = fps;
    if (this.settings.showFps) this.fpsDiv.textContent = `${Math.round(fps)} fps · ${qualityLabels()[this.qualityName()]}`;
  }

  // ------------------------------------------------------------ frame
  /**
   * @param states Map(id -> fixture state) computed from DMX
   */
  render(dt, time, states) {
    if (this._camAnim) {
      const a = this._camAnim;
      a.t = Math.min(1, a.t + dt * 2.2);
      const k = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
      this.camera.position.lerpVectors(a.fromPos, a.pos, k);
      this.orbit.target.lerpVectors(a.fromTarget, a.target, k);
      if (a.t >= 1) this._camAnim = null;
    }
    this.orbit.update();

    // Fog machines thicken the haze, which then slowly clears.
    let fogOut = 0;
    for (const o of this.objects.values()) {
      if (o.type === 'fixture' && o.profile.kind === 'fog') {
        const s = states.get(o.data.id);
        if (s) fogOut = Math.max(fogOut, s.fog);
      }
    }
    this.fogLevel = Math.min(1, Math.max(0, this.fogLevel + (fogOut > 0.05 ? dt * 0.25 * fogOut : -dt * 0.02)));
    // The hazer adds to the haze set by the slider, but never past the slider's maximum (more washes the picture out).
    const haze = Math.min(1, this.settings.haze + this.fogLevel * 0.6 * (1 - this.settings.haze * 0.5));
    // Average color of the show: tints low fog and other "lit by the room" effects.
    const show = [0, 0, 0];
    for (const o of this.objects.values()) {
      if (o.type !== 'fixture') continue;
      const s = states.get(o.data.id);
      if (!s || !s.intensity || o.profile.kind === 'fog' || o.profile.kind === 'lowfog' || o.profile.kind === 'spark') continue;
      show[0] += s.color[0] * s.intensity; show[1] += s.color[1] * s.intensity; show[2] += s.color[2] * s.intensity;
    }
    const showMax = Math.max(show[0], show[1], show[2]);
    const globals = {
      haze: haze * 0.16,
      rawHaze: haze,
      time,
      showColor: showMax > 0 ? show.map((v) => v / showMax) : [1, 1, 1],
      showLevel: Math.min(1, showMax / 3),
    };
    this.scene.fog.density = (0.006 + haze * 0.012) * (1 - this.houseLevel() * 0.6);

    for (const o of this.objects.values()) {
      if (o.type !== 'fixture') continue;
      const s = states.get(o.data.id);
      if (s) o.model.update(s, globals, dt);
    }
    // Props after fixtures: a mirror ball needs to know which beams hit it.
    let emitters = null;
    for (const o of this.objects.values()) {
      if (o.type !== 'prop') continue;
      if (o.model.needsEmitters && !emitters) emitters = this._collectEmitters();
      o.model.update(time, { dt, globals, emitters });
    }
    if (this.selectedIds.length) this._updateSelectionHelpers();
    this._syncPivot();
    this._updateAxisHints();
    this._updateLightPool(dt);
    this.ctx.goboLights.update(this.renderer);
    this._rescanShadows(dt);
    this._updateShadowCasters();
    // Shadows once per frame, before the first scene render (the floor reflection).
    this.shadowAtlas.beginFrame();
    this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
    // Matrices once per frame, not again in every render pass.
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    if (this.reflection.enabled) {
      const hide = [this.transform.getHelper(), this._placing?.ghost, this._hover?.helper, ...this.selHelpers.flatMap((h) => [h.helper, h.arrow])];
      this.reflection.render(this.renderer, this.scene, this.camera, hide);
    } else {
      this.reflection.uniforms.uReflectOn.value = 0;
    }
    this.composer.render(dt);
    this.scene.matrixWorldAutoUpdate = true;
    this._countFps(dt);
    if (this.onAfterRender) this.onAfterRender(dt);
    if (this.settings.showLabels) this.labels.render(this.scene, this.camera);
  }
}
