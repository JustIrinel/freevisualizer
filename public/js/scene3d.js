// Three.js scene: room, camera, post-processing, picking and gizmos.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildVenue } from './venue3d.js';
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
    this.selectedIds = [];
    this.onPick = () => {};        // (id | null, { toggle }) – click in the scene
    this.onMarquee = () => {};     // (ids, { add }) – Shift + drag rectangle
    this.onTransform = () => {};   // ([{ id, position, rotation }]) – while dragging the gizmo
    this.onTransformStart = () => {};
    this.onTransformEnd = () => {};
    this.onGizmoInfo = () => {};   // (text | null) – live position / rotation readout
    this.settings = { haze: 0.5, bloom: 0.9, ambient: 0.25, houseLight: 0.3, workLights: false, lightPower: 1, showLabels: false, snap: true };
    this.lightsUsed = 0;
    this.fogLevel = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
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

    // Our pointerdown runs in the capture phase so Shift+drag can switch the
    // orbit controls off before they start rotating the camera.
    renderer.domElement.addEventListener('pointerdown', (e) => this._onPointerDown(e), { capture: true });
    renderer.domElement.addEventListener('pointermove', (e) => this._onPointerMove(e));
    renderer.domElement.addEventListener('pointerup', (e) => this._onPointerUp(e));

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
          members: this.selectedIds.filter((id) => this.objects.has(id)).map((id) => ({ id, matrix: this.objects.get(id).model.root.matrix.clone() })),
        };
        this.onTransformStart(this.selectedIds);
      } else {
        this._dragStart = null;
        this.onGizmoInfo(null);
        this.onTransformEnd(this.selectedIds);
      }
    });
    this.transform.addEventListener('objectChange', () => this._onGizmoChange());
    this.scene.add(this.transform.getHelper());
    this.setSnap(true);

    this.hemi = new THREE.HemisphereLight(0xfff1dd, 0x3a3430, 0.25);
    this.scene.add(this.hemi);
    // "Work lights": an extra soft key light so the room is bright while placing fixtures.
    this.workLight = new THREE.DirectionalLight(0xfff4e6, 0);
    this.workLight.position.set(4, 10, 8);
    this.scene.add(this.workLight);
    // Image-based lighting so metal, plastic and glass reflect like real materials.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.2;
    pmrem.dispose();
    this.venue = null;

    this.ctx = {
      settings: this.settings,
      puffTexture: puffTexture(),
      allocateLight: () => { if (this.lightsUsed >= MAX_LIGHTS) return false; this.lightsUsed++; return true; },
      releaseLight: () => { this.lightsUsed = Math.max(0, this.lightsUsed - 1); },
      // World-space layer for effects that must not follow the fixture's rotation (sparks, low fog, reflections).
      world: new THREE.Group(),
      roomBox: new THREE.Box3(new THREE.Vector3(-12, 0, -10), new THREE.Vector3(12, 6, 10)),
      walls: true,
    };
    this.scene.add(this.ctx.world);

    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.5, 0.75);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // One outline box + one direction arrow per selected object.
    this.selHelpers = [];

    this.raycaster = new THREE.Raycaster();
    this._pointerDown = null;

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    new ResizeObserver(this._resize).observe(container);
    this.resize();
  }

  /** Render at a fixed resolution (video recording); null returns to the window size. */
  setRenderSize(size) {
    this.fixedSize = size;
    const ratio = size ? 1 : Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.resize();
  }

  resize() {
    const w = this.fixedSize ? this.fixedSize[0] : this.container.clientWidth || 1;
    const h = this.fixedSize ? this.fixedSize[1] : this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, !this.fixedSize);
    this.composer.setSize(w, h);
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
    this.bloom.strength = s.bloom * (1 - h * 0.4);
    this.bloom.threshold = 0.75 + h * 0.45;
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
  }

  // ------------------------------------------------------------ objects
  addFixture(fixture, profile) {
    this.removeObject(fixture.id);
    const model = createFixtureModel(fixture, profile, this.ctx);
    this.scene.add(model.root);
    this.objects.set(fixture.id, { type: 'fixture', model, data: fixture, profile });
    this._applyTransform(model.root, fixture);
    if (this.selectedIds.includes(fixture.id)) this.setSelection(this.selectedIds);
    return model;
  }

  addProp(prop) {
    this.removeObject(prop.id);
    const model = createPropModel(prop, this.ctx);
    this.scene.add(model.root);
    this.objects.set(prop.id, { type: 'prop', model, data: prop });
    this._applyTransform(model.root, prop);
    if (this.selectedIds.includes(prop.id)) this.setSelection(this.selectedIds);
    return model;
  }

  removeObject(id) {
    const o = this.objects.get(id);
    if (!o) return;
    if (this.transform.object === o.model.root) this.transform.detach();
    this.selectedIds = this.selectedIds.filter((x) => x !== id);
    this.scene.remove(o.model.root);
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
    this.selHelpers.forEach((h, i) => { h.helper.visible = i < this.selectedIds.length; h.arrow.visible = false; });
    this._updateSelectionHelpers();
    this._attachGizmo();
  }

  _attachGizmo() {
    const ids = this.selectedIds;
    if (!ids.length) { this.transform.detach(); return; }
    if (ids.length === 1) {
      this.transform.attach(this.objects.get(ids[0]).model.root);
    } else {
      const box = new THREE.Box3();
      for (const id of ids) box.union(computeBounds(this.objects.get(id).model.root, new THREE.Box3()));
      box.getCenter(this.pivot.position);
      this.pivot.quaternion.identity();
      this.pivot.scale.set(1, 1, 1);
      this.pivot.updateMatrix();
      this.pivot.updateMatrixWorld(true);
      this.transform.attach(this.pivot);
    }
    this._applySpace();
  }

  /** A single object rotates around its own axes; moving stays aligned with the room. */
  _applySpace() {
    this.transform.setSpace(this.transform.mode === 'rotate' && this.selectedIds.length === 1 ? 'local' : 'world');
  }

  _onGizmoChange() {
    const ids = this.selectedIds;
    if (!ids.length) return;
    if (ids.length > 1 && this._dragStart) {
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
        ? `Rotire grup · ${ids.length} obiecte`
        : `Înclinare ${Math.round(last.rotation.x)}° · Rotire ${Math.round(last.rotation.y)}° · Lateral ${Math.round(last.rotation.z)}°`);
    } else {
      this.onGizmoInfo(ids.length > 1
        ? `Mutare grup · ${ids.length} obiecte`
        : `X ${f(last.position.x)} m · Înălțime ${f(last.position.y)} m · Z ${f(last.position.z)} m`);
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
    this._applySpace();
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
    const show = this.selectedIds.length && this.transform.object && this.transform.mode === 'translate' && !this._placing;
    if (!show) { for (const d of this._hints) d.style.display = 'none'; return; }
    const origin = this.transform.object.getWorldPosition(new THREE.Vector3());
    const dist = origin.distanceTo(this.camera.position);
    const len = dist * 0.16;
    const labels = this.hintLabels || { x: '⟷ stânga / dreapta', y: '↕ sus / jos', z: '⤢ față / spate' };
    const w = this.container.clientWidth; const h = this.container.clientHeight;
    ['x', 'y', 'z'].forEach((axis, i) => {
      const p = origin.clone();
      p[axis] += len;
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

  _ndc(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  _onPointerDown(e) {
    this._pointerDown = { x: e.clientX, y: e.clientY };
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
    if (this._placing) { this._updatePlacementGhost(e); return; }
    const m = this._marquee;
    if (!m) return;
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
    const roots = [...this.objects.values()].map((o) => o.model.root);
    // Fixtures win over props: a fixture hanging on a truss is picked even
    // when the ray touches the truss first.
    let id = null;
    for (const h of this.raycaster.intersectObjects(roots, true)) {
      const hitId = this._objectIdOf(h.object);
      if (!hitId) continue;
      if (this.objects.get(hitId)?.type === 'fixture') { id = hitId; break; }
      id ??= hitId;
    }
    this.onPick(id, { toggle: e.ctrlKey || e.metaKey, shift: e.shiftKey });
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
    this._updateAxisHints();
    this.composer.render(dt);
    if (this.onAfterRender) this.onAfterRender(dt);
    if (this.settings.showLabels) this.labels.render(this.scene, this.camera);
  }
}
