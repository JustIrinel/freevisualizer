// 3D models of fixtures. Every model emits along its local +Y axis.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Particles } from './particles.js';
import { LASER_PATTERNS } from './fixture-state.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const BEAM_LENGTH = 22;

// Room bounds shared by every beam so beams fade out at walls and ceiling.
export const roomUniforms = {
  uRoomMin: { value: new THREE.Vector3(-1000, 0, -1000) },
  uRoomMax: { value: new THREE.Vector3(1000, 1000, 1000) },
};

const beamVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uGobo;
  uniform float uGoboRot;
  uniform vec3 uRoomMin;
  uniform vec3 uRoomMax;
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vWorld;
  void main() {
    vec3 lo = smoothstep(uRoomMin, uRoomMin + vec3(0.35, 0.02, 0.35), vWorld);
    vec3 hi = smoothstep(uRoomMax, uRoomMax - vec3(0.35, 0.8, 0.35), vWorld);
    float clip = lo.x * lo.y * lo.z * hi.x * hi.y * hi.z;
    if (clip <= 0.0) discard;
    float along = clamp(vLocal.y, 0.0, 1.0);
    float fall = pow(1.0 - along, 1.7);
    float start = smoothstep(0.0, 0.015, along);
    float edge = abs(dot(normalize(vNormalV), normalize(vViewPos)));
    edge = pow(edge, 1.6);
    float g = 1.0;
    if (uGobo > 0.5) {
      float a = atan(vLocal.z, vLocal.x) + uGoboRot;
      g = 0.35 + 0.65 * smoothstep(-0.25, 0.25, sin(a * (2.0 + uGobo)));
    }
    vec3 col = uColor * uIntensity * fall * start * edge * g * clip;
    gl_FragColor = vec4(col, 1.0);
  }
`;

let unitCone = null;
function getUnitCone() {
  if (!unitCone) {
    unitCone = new THREE.ConeGeometry(1, 1, 40, 1, true);
    unitCone.translate(0, -0.5, 0);
    unitCone.rotateX(Math.PI);
  }
  return unitCone;
}

/** Volumetric-looking additive cone, apex at origin, pointing +Y. */
export class Beam {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
        uGobo: { value: 0 },
        uGoboRot: { value: 0 },
        ...roomUniforms,
      },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(getUnitCone(), this.material);
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  set(color, intensity, angleDeg, gobo = 0, goboRot = 0, length = BEAM_LENGTH) {
    const r = Math.tan(THREE.MathUtils.degToRad(Math.max(0.1, Math.min(170, angleDeg)) / 2)) * length;
    this.mesh.scale.set(r, length, r);
    this.material.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    this.material.uniforms.uIntensity.value = intensity;
    this.material.uniforms.uGobo.value = gobo;
    this.material.uniforms.uGoboRot.value = goboRot;
    this.mesh.visible = intensity > 0.002;
  }

  dispose() {
    this.material.dispose();
  }
}

const mats = {};
function bodyMaterial() {
  return mats.body || (mats.body = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.6 }));
}
function darkMaterial() {
  return mats.dark || (mats.dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.8, metalness: 0.2 }));
}

function lensMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
}

function setLens(mat, color, intensity, boost = 5) {
  const k = intensity * boost;
  mat.color.setRGB(0.05 + color[0] * k, 0.05 + color[1] * k, 0.05 + color[2] * k);
}

/** Beam brightness tuned per beam angle: narrow beams look denser. */
function beamGain(angle, haze) {
  return haze * Math.min(3, Math.max(0.3, 9 / Math.max(1, angle)));
}

class BaseModel {
  constructor(fixture, profile, ctx) {
    this.fixture = fixture;
    this.profile = profile;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.userData.objectId = fixture.id;
    this.beams = [];
    this.light = null;
    this.label = null;
  }

  createLight(angleDeg) {
    if (!this.ctx.allocateLight()) return null;
    const light = new THREE.SpotLight(0xffffff, 0, 0, THREE.MathUtils.degToRad(Math.min(80, angleDeg / 2)), 0.45, 1.4);
    light.castShadow = false;
    light.position.set(0, 0, 0); // lights default to (0, 1, 0)
    const target = new THREE.Object3D();
    target.position.set(0, 1, 0);
    light.add(target);
    light.target = target;
    this.light = light;
    return light;
  }

  updateLight(color, intensity, angleDeg, power = 60) {
    if (!this.light) return;
    this.light.color.setRGB(color[0], color[1], color[2]);
    this.light.intensity = intensity * power * 6 * this.ctx.settings.lightPower;
    this.light.angle = THREE.MathUtils.degToRad(Math.min(80, Math.max(2, angleDeg / 2 + 1.5)));
  }

  /** Where the main beam starts and points (used by the mirror ball). */
  emitter() {
    if (!this.beam || !this.lastState) return null;
    const m = this.beam.mesh;
    m.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
    const dir = new THREE.Vector3().setFromMatrixColumn(m.matrixWorld, 1).normalize();
    const s = this.lastState;
    return { pos, dir, cosHalf: Math.cos(THREE.MathUtils.degToRad(Math.min(80, s.beamAngle / 2 + 1))), color: s.color, intensity: s.intensity };
  }

  addLabel() {
    const div = document.createElement('div');
    div.className = 'fx-label';
    this.labelDiv = div;
    this.label = new CSS2DObject(div);
    this.label.position.set(0, 0.45, 0);
    this.root.add(this.label);
    this.refreshLabel();
  }

  refreshLabel() {
    if (!this.labelDiv) return;
    const f = this.fixture;
    this.labelDiv.textContent = `${f.name} · ${f.universe}.${f.address}`;
  }

  dispose() {
    for (const b of this.beams) b.dispose();
    if (this.light) this.ctx.releaseLight();
    this.root.traverse((o) => {
      if (o.isMesh && o.material && o.material !== bodyMaterial() && o.material !== darkMaterial() && !o.material.isShaderMaterial) o.material.dispose?.();
      if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    });
  }
}

// ------------------------------------------------------------------ Par
class ParModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.2, 24), bodyMaterial());
    can.position.y = 0;
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.04), darkMaterial());
    yoke.position.y = -0.1;
    const ears = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.03), darkMaterial());
    ears.position.y = -0.04;
    this.lensMat = lensMaterial();
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.095, 24), this.lensMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.101;
    this.root.add(can, yoke, ears, lens);
    this.beam = new Beam();
    this.beam.mesh.position.y = 0.1;
    this.beams.push(this.beam);
    this.root.add(this.beam.mesh);
    const light = this.createLight(profile.beamAngle[1]);
    if (light) { light.position.y = 0.1; this.root.add(light); }
    this.addLabel();
  }

  update(s, g) {
    this.lastState = s;
    setLens(this.lensMat, s.color, s.intensity);
    this.beam.set(s.color, s.intensity * beamGain(s.beamAngle, g.haze) * 0.8, s.beamAngle);
    this.updateLight(s.color, s.intensity, s.beamAngle, 22);
  }
}

// ------------------------------------------------------------------ Moving head
class MovingHeadModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const style = profile.style || 'spot';
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.28), bodyMaterial());
    base.position.y = 0.06;
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    display.position.set(0, 0.07, 0.141);
    this.root.add(base, display);

    this.yoke = new THREE.Group();
    this.yoke.position.y = 0.12;
    const armGeo = new THREE.BoxGeometry(0.05, 0.3, 0.1);
    const armL = new THREE.Mesh(armGeo, bodyMaterial());
    armL.position.set(-0.16, 0.15, 0);
    const armR = armL.clone();
    armR.position.x = 0.16;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.04, 0.12), bodyMaterial());
    bridge.position.y = 0.02;
    this.yoke.add(armL, armR, bridge);
    this.root.add(this.yoke);

    this.head = new THREE.Group();
    this.head.position.y = 0.26;
    this.yoke.add(this.head);
    let headMesh; let lensR; let lensY;
    if (style === 'wash') {
      headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.26, 28), bodyMaterial());
      lensR = 0.125; lensY = 0.131;
    } else if (style === 'beam') {
      headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 24), bodyMaterial());
      headMesh.position.y = 0.02;
      lensR = 0.085; lensY = 0.191;
    } else {
      headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.32, 24), bodyMaterial());
      headMesh.position.y = 0.01;
      lensR = 0.09; lensY = 0.171;
    }
    this.head.add(headMesh);
    this.lensMat = lensMaterial();
    const lens = new THREE.Mesh(new THREE.CircleGeometry(lensR, 28), this.lensMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = lensY;
    this.head.add(lens);

    // Main beam + 8 extra beams used by the prism effect.
    this.beamOrigin = new THREE.Group();
    this.beamOrigin.position.y = lensY;
    this.head.add(this.beamOrigin);
    this.beam = new Beam();
    this.beamOrigin.add(this.beam.mesh);
    this.beams.push(this.beam);
    this.prismBeams = [];
    for (let i = 0; i < 8; i++) {
      const b = new Beam();
      this.prismBeams.push(b);
      this.beams.push(b);
      this.beamOrigin.add(b.mesh);
    }
    const light = this.createLight(profile.beamAngle[1]);
    if (light) this.beamOrigin.add(light);
    this.addLabel();
    this.label.position.y = 0.7;
    this.curPan = 0;
    this.curTilt = 0;
  }

  update(s, g, dt) {
    this.lastState = s;
    // Fixtures do not move instantly: follow DMX with a fast motor-like easing.
    const k = 1 - Math.exp(-dt * 14);
    this.curPan += (s.pan - this.curPan) * k;
    this.curTilt += (s.tilt - this.curTilt) * k;
    this.yoke.rotation.y = THREE.MathUtils.degToRad(this.curPan);
    this.head.rotation.x = THREE.MathUtils.degToRad(this.curTilt);
    setLens(this.lensMat, s.color, s.intensity, 6);
    const gain = beamGain(s.beamAngle, g.haze) * (this.profile.style === 'beam' ? 1.4 : 1);
    const facets = s.prism || 0;
    const mainShare = facets ? 0.35 : 1;
    this.beam.set(s.color, s.intensity * gain * mainShare, s.beamAngle, s.gobo, s.goboRotation);
    const spread = Math.max(4, s.beamAngle * 1.6);
    this.prismBeams.forEach((b, i) => {
      if (i >= facets) { b.set(s.color, 0, s.beamAngle); return; }
      const a = (i / facets) * Math.PI * 2 + s.goboRotation;
      b.mesh.rotation.set(THREE.MathUtils.degToRad(spread) * Math.cos(a), 0, THREE.MathUtils.degToRad(spread) * Math.sin(a));
      b.set(s.color, s.intensity * gain * (0.8 / Math.max(1, facets / 3)), s.beamAngle, s.gobo, s.goboRotation);
    });
    this.updateLight(s.color, s.intensity, facets ? s.beamAngle + spread * 2 : s.beamAngle, this.profile.style === 'wash' ? 130 : 170);
  }
}

// ------------------------------------------------------------------ LED bar / blinder (pixels)
class PixelModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const n = Math.max(1, profile.pixels || 1);
    const blinder = profile.kind === 'blinder';
    const cell = blinder ? 0.26 : 0.125;
    const length = Math.max(profile.dimensions ? profile.dimensions[0] : 0, n * cell + 0.04);
    const height = blinder ? 0.3 : 0.08;
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, height), bodyMaterial());
    body.position.y = -0.05;
    this.root.add(body);
    this.cells = [];
    const pitch = (length - 0.04) / n;
    for (let i = 0; i < n; i++) {
      const mat = lensMaterial();
      const geo = blinder ? new THREE.CircleGeometry(0.1, 24) : new THREE.PlaneGeometry(pitch * 0.8, 0.05);
      const lens = new THREE.Mesh(geo, mat);
      lens.rotation.x = -Math.PI / 2;
      const x = -length / 2 + 0.02 + pitch * (i + 0.5);
      lens.position.set(x, 0.001, 0);
      this.root.add(lens);
      const beam = new Beam();
      beam.mesh.position.set(x, 0, 0);
      this.root.add(beam.mesh);
      this.beams.push(beam);
      this.cells.push({ mat, beam });
    }
    const light = this.createLight(profile.beamAngle[1] + 10);
    if (light) this.root.add(light);
    this.addLabel();
    this.label.position.y = 0.3;
  }

  update(s, g) {
    const pixels = s.pixels || this.cells.map(() => ({ color: s.color, intensity: s.intensity }));
    const gain = beamGain(s.beamAngle, g.haze) * (this.profile.kind === 'blinder' ? 0.6 : 0.55);
    this.cells.forEach((c, i) => {
      const p = pixels[i] || pixels[pixels.length - 1];
      setLens(c.mat, p.color, p.intensity, this.profile.kind === 'blinder' ? 8 : 5);
      c.beam.set(p.color, p.intensity * gain, s.beamAngle);
    });
    this.updateLight(s.color, s.intensity, s.beamAngle + 10, this.profile.kind === 'blinder' ? 120 : 30);
  }
}

// ------------------------------------------------------------------ Retro hexagonal 7 heads
/** Head positions: rows of 2-3-2 (numbered left→right, top→bottom), in the face plane. */
export function hex7Layout(pitch = 0.17) {
  const h = pitch * Math.sqrt(3) / 2;
  return [
    [-pitch / 2, -h], [pitch / 2, -h],
    [-pitch, 0], [0, 0], [pitch, 0],
    [-pitch / 2, h], [pitch / 2, h],
  ];
}

class RetroModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const pitch = 0.17;
    // Hexagonal housing (flat sides left/right) with a brushed gold rim.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.11, 6), bodyMaterial());
    body.rotation.y = Math.PI / 6;
    body.position.y = -0.116; // back housing; the cups sit in front of it
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 6, 1, true), retroGold());
    rim.rotation.y = Math.PI / 6;
    rim.position.y = -0.03;
    this.root.add(body, rim);
    this.cells = [];
    const n = Math.max(1, profile.pixels || 7);
    hex7Layout(pitch).slice(0, n).forEach(([x, z]) => {
      // Gold reflector cup that glows with the bulb, plus a small hot filament.
      const cupMat = new THREE.MeshStandardMaterial({ color: 0xb08a40, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide, emissive: 0x000000 });
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.03, 0.06, 28, 1, true), cupMat);
      cup.position.set(x, -0.03, z);
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), cupMat);
      back.rotation.x = -Math.PI / 2;
      back.position.set(x, -0.059, z);
      const mat = lensMaterial();
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 10), mat);
      bulb.position.set(x, -0.03, z);
      const beam = new Beam();
      beam.mesh.position.set(x, 0, z);
      this.root.add(cup, back, bulb, beam.mesh);
      this.beams.push(beam);
      this.cells.push({ mat, cupMat, beam, level: 0 });
    });
    const light = this.createLight(profile.beamAngle[1] + 15);
    if (light) this.root.add(light);
    this.addLabel();
    this.label.position.y = 0.4;
  }

  update(s, g, dt) {
    const pixels = s.pixels || this.cells.map(() => ({ color: s.color, intensity: s.intensity }));
    const tungsten = this.profile.tungsten !== false;
    const gain = beamGain(s.beamAngle, g.haze) * 0.5;
    const avg = [0, 0, 0];
    let max = 0;
    this.cells.forEach((c, i) => {
      const p = pixels[i] || pixels[pixels.length - 1];
      // Incandescent look: filaments heat up fast and cool down slowly,
      // and glow deep orange when dimmed.
      if (tungsten) {
        const k = p.intensity > c.level ? 14 : 5;
        c.level += (p.intensity - c.level) * Math.min(1, dt * k);
      } else {
        c.level = p.intensity;
      }
      const lvl = c.level;
      const color = tungsten ? warmShift(p.color, lvl) : p.color;
      setLens(c.mat, color, lvl, 9);
      c.cupMat.emissive.setRGB(color[0] * lvl * 0.55, color[1] * lvl * 0.55, color[2] * lvl * 0.55);
      c.beam.set(color, lvl * gain, s.beamAngle);
      avg[0] += color[0] * lvl; avg[1] += color[1] * lvl; avg[2] += color[2] * lvl;
      max = Math.max(max, lvl);
    });
    const m = Math.max(avg[0], avg[1], avg[2]) || 1;
    this.updateLight([avg[0] / m, avg[1] / m, avg[2] / m], max, s.beamAngle + 15, 45);
  }
}

let goldMat = null;
function retroGold() {
  return goldMat || (goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a050, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }));
}

/** Dimmed filaments shift towards deep orange/red. */
function warmShift(color, level) {
  const t = 1 - Math.min(1, level * 1.4);
  return [color[0], color[1] * (1 - 0.55 * t), color[2] * (1 - 0.85 * t)];
}

// ------------------------------------------------------------------ Strobe
class StrobeModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.16), bodyMaterial());
    body.position.y = -0.06;
    this.lensMat = lensMaterial();
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.12), this.lensMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.001;
    this.root.add(body, lens);
    this.flash = new THREE.PointLight(0xffffff, 0, 0, 1.6);
    this.flash.position.y = 0.3;
    if (ctx.allocateLight()) { this.root.add(this.flash); this.hasFlash = true; }
    this.addLabel();
  }

  update(s) {
    setLens(this.lensMat, s.color, s.intensity, 12);
    this.flash.color.setRGB(s.color[0], s.color[1], s.color[2]);
    this.flash.intensity = s.intensity * 1500 * this.ctx.settings.lightPower;
  }

  dispose() {
    super.dispose();
    if (this.hasFlash) this.ctx.releaseLight();
  }
}

// ------------------------------------------------------------------ Cold spark machine
class SparkModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), bodyMaterial());
    body.position.y = 0.12;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.05, 16), darkMaterial());
    top.position.y = 0.265;
    this.root.add(body, top);
    this.sparks = new Particles(2500, { additive: true, hard: true });
    ctx.world.add(this.sparks.points);
    this.carry = 0;
    if (ctx.allocateLight()) {
      this.glow = new THREE.PointLight(0xffb060, 0, 0, 1.6);
      this.glow.position.y = 1;
      this.root.add(this.glow);
    }
    this.addLabel();
    this.label.position.y = 0.5;
  }

  update(s, g, dt) {
    const level = s.spark;
    const nozzle = this.root.localToWorld(_v1.set(0, 0.29, 0));
    if (level > 0.02) {
      const height = 0.6 + level * 4.4;
      const grav = 7;
      const v0 = Math.sqrt(2 * grav * height);
      this.carry += dt * 900;
      while (this.carry >= 1) {
        this.carry -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.35;
        const v = v0 * (0.85 + Math.random() * 0.2);
        this.sparks.spawn(nozzle.x, nozzle.y, nozzle.z, Math.cos(a) * r, v, Math.sin(a) * r, (v / grav) * (0.75 + Math.random() * 0.5), 0.03 + Math.random() * 0.025, 3.2, 2.4, 1.3);
      }
    } else {
      this.carry = 0;
    }
    this.sparks.update(dt, { gravity: 7, drag: 0.4, floor: 0 }, (i, t, o) => {
      o.alpha = t < 0.8 ? 1 : (1 - t) / 0.2;
      o.size = 1 - t * 0.5;
      o.b = 1 - t * 0.6;
      o.g = 1 - t * 0.25;
    });
    if (this.glow) this.glow.intensity = level > 0.02 ? (6 + Math.random() * 4) * level * this.ctx.settings.lightPower * 6 : 0;
  }

  dispose() {
    super.dispose();
    this.ctx.world.remove(this.sparks.points);
    this.sparks.dispose();
    if (this.glow) this.ctx.releaseLight();
  }
}

// ------------------------------------------------------------------ Low fog / dry ice
class LowFogModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.6), bodyMaterial());
    body.position.y = 0.175;
    const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), darkMaterial());
    nozzle.position.set(0, 0.1, 0.33);
    this.root.add(body, nozzle);
    this.cloud = new Particles(700, { additive: false, flat: true });
    ctx.world.add(this.cloud.points);
    this.carry = 0;
    this.output = 0;
    this.addLabel();
    this.label.position.y = 0.6;
  }

  update(s, g, dt) {
    this.output += (s.fog - this.output) * Math.min(1, dt * 2);
    const out = this.output;
    if (out > 0.03) {
      const p = this.root.localToWorld(_v1.set(0, 0.1, 0.4));
      const fwd = this.root.localToWorld(_v2.set(0, 0.1, 1.4)).sub(p).normalize();
      this.carry += dt * 60 * out;
      while (this.carry >= 1) {
        this.carry -= 1;
        const side = (Math.random() - 0.5) * 1.2;
        const speed = 0.9 + Math.random() * 1.1;
        this.cloud.spawn(p.x, 0.08 + Math.random() * 0.25, p.z,
          fwd.x * speed - fwd.z * side, 0.02 + Math.random() * 0.03, fwd.z * speed + fwd.x * side,
          9 + Math.random() * 6, 0.9 + Math.random() * 0.5, 1, 1, 1);
      }
    }
    // Lit by the room: neutral grey mixed with the current color of the show.
    const sc = g.showColor;
    const lit = 0.6 + g.showLevel * 0.8;
    const tint = [(0.45 + sc[0] * 0.55) * lit, (0.45 + sc[1] * 0.55) * lit, (0.45 + sc[2] * 0.55) * lit];
    this.cloud.update(dt, { drag: 0.35, floor: 0.05 }, (i, t, o) => {
      o.alpha = Math.min(1, t * 8) * (1 - t) * 0.3;
      o.size = 1 + t * 2.6;
      o.r = tint[0]; o.g = tint[1]; o.b = tint[2];
    });
  }

  dispose() {
    super.dispose();
    this.ctx.world.remove(this.cloud.points);
    this.cloud.dispose();
  }
}

// ------------------------------------------------------------------ Laser
class LaserModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.12), bodyMaterial());
    body.position.y = -0.1;
    this.lensMat = lensMaterial();
    const aperture = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), this.lensMat);
    aperture.rotation.x = -Math.PI / 2;
    aperture.position.y = 0.001;
    this.root.add(body, aperture);
    this.lasers = [];
    for (let i = 0; i < 24; i++) {
      const b = new Beam();
      b.mesh.rotation.order = 'YXZ';
      this.root.add(b.mesh);
      this.beams.push(b);
      this.lasers.push(b);
    }
    this.phase = 0;
    this.addLabel();
    this.label.position.y = 0.3;
  }

  update(s, g, dt) {
    this.phase += dt * (0.6 + s.laserSpin);
    const on = s.intensity;
    setLens(this.lensMat, s.color, on, 10);
    const spread = THREE.MathUtils.degToRad(Math.max(5, s.beamAngle));
    const gain = on * (0.25 + g.rawHaze * 2.2);
    const ph = this.phase;
    const pattern = s.laserPattern % LASER_PATTERNS;
    const count = [16, 24, 18, 12, 1][pattern];
    this.lasers.forEach((b, i) => {
      if (i >= count || on < 0.01) { b.set(s.color, 0, 0.3); return; }
      const k = count > 1 ? i / (count - 1) : 0.5;
      const r = b.mesh.rotation;
      switch (pattern) {
        case 0: // scanning fan
          r.set(Math.sin(ph * 1.3) * spread * 0.35, 0, (k - 0.5) * spread);
          break;
        case 1: // liquid sky: wavy sheet
          r.set(Math.sin(ph * 2 + i * 0.45) * 0.06, 0, (k - 0.5) * spread);
          break;
        case 2: // rotating cone
          r.set(spread * 0.5, (i / count) * Math.PI * 2 + ph, 0);
          break;
        case 3: // pulsing tunnel
          r.set(spread * (0.15 + 0.12 * Math.sin(ph * 3)), (i / count) * Math.PI * 2 - ph * 1.5, 0);
          break;
        default: // single beam drawing a figure-8
          r.set(Math.sin(ph * 1.7) * spread * 0.5, 0, Math.sin(ph * 0.85) * spread * 0.5);
      }
      b.set(s.color, gain, 0.35, 0, 0, 30);
    });
  }
}

// ------------------------------------------------------------------ Fog machine
class FogModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.25), bodyMaterial());
    body.position.y = 0.11;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 12), darkMaterial());
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0.13, 0.16);
    this.root.add(body, nozzle);
    // Puffs: soft sprites that grow and fade while the machine is firing.
    this.puffs = [];
    const tex = ctx.puffTexture;
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0x9aa0aa });
      const sp = new THREE.Sprite(mat);
      sp.raycast = () => {};
      sp.userData.t = i / 14;
      this.root.add(sp);
      this.puffs.push(sp);
    }
    this.output = 0;
    this.addLabel();
  }

  update(s, g, dt) {
    this.output += (s.fog - this.output) * Math.min(1, dt * 3);
    for (const p of this.puffs) {
      p.userData.t += dt * 0.35;
      if (p.userData.t > 1) p.userData.t -= 1;
      const t = p.userData.t;
      p.position.set(Math.sin(t * 9 + p.id) * 0.15 * t, 0.15 + t * 0.6, 0.2 + t * 2.4);
      const size = 0.2 + t * 2.2;
      p.scale.set(size, size, 1);
      p.material.opacity = this.output * 0.35 * Math.sin(Math.PI * t);
    }
  }
}

export function createFixtureModel(fixture, profile, ctx) {
  switch (profile.kind) {
    case 'moving': return new MovingHeadModel(fixture, profile, ctx);
    case 'bar': case 'blinder': return new PixelModel(fixture, profile, ctx);
    case 'retro': return new RetroModel(fixture, profile, ctx);
    case 'spark': return new SparkModel(fixture, profile, ctx);
    case 'lowfog': return new LowFogModel(fixture, profile, ctx);
    case 'laser': return new LaserModel(fixture, profile, ctx);
    case 'strobe': return new StrobeModel(fixture, profile, ctx);
    case 'fog': return new FogModel(fixture, profile, ctx);
    default: return new ParModel(fixture, profile, ctx);
  }
}
