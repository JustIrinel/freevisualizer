// Three.js scene: room, camera, post-processing, picking and gizmos.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createFixtureModel, roomUniforms } from './fixtures3d.js';
import { createPropModel } from './props3d.js';

const MAX_LIGHTS = 40;
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
    this.selectedId = null;
    this.onSelect = () => {};
    this.onTransform = () => {};
    this.onTransformStart = () => {};
    this.onTransformEnd = () => {};
    this.settings = { haze: 0.5, bloom: 0.9, ambient: 0.25, lightPower: 1, showLabels: false, snap: true };
    this.lightsUsed = 0;
    this.fogLevel = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030305);
    this.scene.fog = new THREE.FogExp2(0x030305, 0.012);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
    this.camera.position.set(0, 5, 15);

    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.target.set(0, 1.8, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, renderer.domElement);
    this.transform.setSize(0.8);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (!this.selectedId) return;
      if (e.value) this.onTransformStart(this.selectedId);
      else this.onTransformEnd(this.selectedId);
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.selectedId) this.onTransform(this.selectedId, this._readTransform(this.selectedId));
    });
    this.scene.add(this.transform.getHelper());
    this.setSnap(true);

    this.hemi = new THREE.HemisphereLight(0x8890a0, 0x202024, 0.25);
    this.scene.add(this.hemi);

    this.ctx = {
      settings: this.settings,
      puffTexture: puffTexture(),
      allocateLight: () => { if (this.lightsUsed >= MAX_LIGHTS) return false; this.lightsUsed++; return true; },
      releaseLight: () => { this.lightsUsed = Math.max(0, this.lightsUsed - 1); },
    };

    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.5, 0.75);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.selBounds = new THREE.Box3();
    this.selectionBox = new THREE.Box3Helper(this.selBounds, 0x4da3ff);
    this.selectionBox.visible = false;
    this.selectionBox.raycast = () => {};
    this.scene.add(this.selectionBox);

    this.raycaster = new THREE.Raycaster();
    this._pointerDown = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { this._pointerDown = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => this._onPointerUp(e));

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  // ------------------------------------------------------------ room
  buildRoom(room) {
    for (const c of [...this.roomGroup.children]) {
      this.roomGroup.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    const w = room.width || 24;
    const d = room.depth || 24;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: room.floorColor || '#1b1b1f', roughness: room.floorRoughness ?? 0.55, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.userData.isRoom = true;
    this.roomGroup.add(floor);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x2a2a33, 0x18181e);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = room.grid === false ? 0 : 0.35;
    grid.raycast = () => {};
    this.roomGroup.add(grid);
    const wallMat = () => new THREE.MeshStandardMaterial({ color: room.wallColor || '#16161a', roughness: 0.9 });
    const hgt = room.height || 6;
    if (room.walls !== false) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), wallMat());
      back.position.set(0, hgt / 2, -d / 2);
      const left = new THREE.Mesh(new THREE.PlaneGeometry(d, hgt), wallMat());
      left.rotation.y = Math.PI / 2;
      left.position.set(-w / 2, hgt / 2, 0);
      const right = left.clone();
      right.material = wallMat();
      right.rotation.y = -Math.PI / 2;
      right.position.x = w / 2;
      // Ceiling faces down only, so the top view still looks through it.
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.95 }));
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = hgt;
      for (const m of [back, left, right, ceiling]) { m.userData.isRoom = true; this.roomGroup.add(m); }
    }
    if (room.walls !== false) {
      roomUniforms.uRoomMin.value.set(-w / 2, 0, -d / 2);
      roomUniforms.uRoomMax.value.set(w / 2, hgt, d / 2 + 50);
    } else {
      roomUniforms.uRoomMin.value.set(-1000, 0, -1000);
      roomUniforms.uRoomMax.value.set(1000, 1000, 1000);
    }
    this.room = room;
  }

  applySettings() {
    const s = this.settings;
    this.bloom.strength = s.bloom;
    this.bloom.enabled = s.bloom > 0.01;
    this.hemi.intensity = s.ambient;
    this.labels.domElement.style.display = s.showLabels ? '' : 'none';
  }

  // ------------------------------------------------------------ objects
  addFixture(fixture, profile) {
    this.removeObject(fixture.id);
    const model = createFixtureModel(fixture, profile, this.ctx);
    this.scene.add(model.root);
    this.objects.set(fixture.id, { type: 'fixture', model, data: fixture, profile });
    this._applyTransform(model.root, fixture);
    if (this.selectedId === fixture.id) this.select(fixture.id);
    return model;
  }

  addProp(prop) {
    this.removeObject(prop.id);
    const model = createPropModel(prop);
    this.scene.add(model.root);
    this.objects.set(prop.id, { type: 'prop', model, data: prop });
    this._applyTransform(model.root, prop);
    if (this.selectedId === prop.id) this.select(prop.id);
    return model;
  }

  removeObject(id) {
    const o = this.objects.get(id);
    if (!o) return;
    if (this.transform.object === o.model.root) this.transform.detach();
    this.scene.remove(o.model.root);
    o.model.dispose();
    this.objects.delete(id);
  }

  clear() {
    for (const id of [...this.objects.keys()]) this.removeObject(id);
    this.select(null);
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
    const o = this.objects.get(id);
    const root = o.model.root;
    const round = (v, n = 1000) => Math.round(v * n) / n;
    return {
      position: { x: round(root.position.x), y: round(root.position.y), z: round(root.position.z) },
      rotation: { x: round(R2D(root.rotation.x), 10), y: round(R2D(root.rotation.y), 10), z: round(R2D(root.rotation.z), 10) },
    };
  }

  // ------------------------------------------------------------ selection
  select(id) {
    this.selectedId = id && this.objects.has(id) ? id : null;
    if (this.selectedId) {
      const root = this.objects.get(this.selectedId).model.root;
      this.transform.attach(root);
      computeBounds(root, this.selBounds);
      this.selectionBox.visible = true;
    } else {
      this.transform.detach();
      this.selectionBox.visible = false;
    }
  }

  setTransformMode(mode) {
    this.transform.setMode(mode);
  }

  setSnap(on) {
    this.settings.snap = on;
    this.transform.setTranslationSnap(on ? 0.25 : null);
    this.transform.setRotationSnap(on ? D2R(15) : null);
  }

  _onPointerUp(e) {
    if (!this._pointerDown) return;
    const moved = Math.hypot(e.clientX - this._pointerDown.x, e.clientY - this._pointerDown.y);
    this._pointerDown = null;
    if (moved > 4 || this.transform.dragging || e.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots = [...this.objects.values()].map((o) => o.model.root);
    const hits = this.raycaster.intersectObjects(roots, true);
    let id = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.objectId) o = o.parent;
      if (o) { id = o.userData.objectId; break; }
    }
    this.select(id);
    this.onSelect(id);
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
    if (!this.selectedId) return;
    const root = this.objects.get(this.selectedId).model.root;
    const p = new THREE.Vector3();
    root.getWorldPosition(p);
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
    this.camera.position.set(...c.position);
    this.orbit.target.set(...c.target);
    this.orbit.update();
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
    const haze = Math.min(1.2, this.settings.haze + this.fogLevel * 0.6);
    const globals = { haze: haze * 0.16, time };
    this.scene.fog.density = 0.006 + haze * 0.012;

    for (const o of this.objects.values()) {
      if (o.type === 'fixture') {
        const s = states.get(o.data.id);
        if (s) o.model.update(s, globals, dt);
      } else {
        o.model.update(time);
      }
    }
    if (this.selectionBox.visible && this.selectedId) {
      computeBounds(this.objects.get(this.selectedId).model.root, this.selBounds);
    }
    this.composer.render(dt);
    if (this.settings.showLabels) this.labels.render(this.scene, this.camera);
  }
}
