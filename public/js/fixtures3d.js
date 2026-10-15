// 3D models of fixtures. Every model emits along its local +Y axis.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Particles } from './particles.js';
import { LASER_PATTERNS } from './fixture-state.js';
import {
  housing, trim, steel, alu, rubber, grille, glass, lens, setGlow, rbox, cyl, controlPanel, handle, feet,
  movingBase, yokeArms, roundHead, spotHead, parBracket, hexBody, reflector, isShared,
} from './fixture-parts.js';
import { applyModel } from './models3d.js';
import { ProjectionTexture, projectionLayout } from './gobos.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const BEAM_LENGTH = 22;
const PRISM_BEAMS = 16;
const GOBO_TYPES = new Set(['gobo', 'gobo2', 'goboRot', 'gobo2Rot', 'prism', 'prism2', 'prismRot', 'prism2Rot', 'frost']);

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
  varying vec3 vCamLocal;
  void main() {
    vLocal = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = -mv.xyz;
    vCamLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// With a gobo / prism the cone is ray-marched through the fixture's projection
// texture, so the pattern shows in the haze as real "fingers" of light.
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uUseMap;
  uniform sampler2D uMap;
  uniform mat4 uToLight;
  uniform float uFieldTan;
  uniform vec3 uRoomMin;
  uniform vec3 uRoomMax;
  varying vec3 vLocal;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying vec3 vWorld;
  varying vec3 vCamLocal;
  float sampleProj(vec3 p) {
    vec3 l = (uToLight * vec4(p, 1.0)).xyz;
    vec2 uv = 0.5 + 0.5 * vec2(l.x, l.z) / (max(l.y, 1e-4) * uFieldTan);
    return texture2D(uMap, uv).r;
  }
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
    if (uUseMap > 0.5) {
      // Chord of the view ray through the unit cone x² + z² = y², 0 < y < 1.
      vec3 ro = vCamLocal;
      vec3 rd = vLocal - vCamLocal; // the fragment is at t = 1
      float a = rd.x * rd.x + rd.z * rd.z - rd.y * rd.y;
      float c = ro.x * ro.x + ro.z * ro.z - ro.y * ro.y;
      bool camInside = c < 0.0 && ro.y > 0.0 && ro.y < 1.0;
      float t0 = 1.0; float t1 = 1.0;
      float tOther = abs(a) > 1e-6 ? c / a : 1.0;
      float tCap = abs(rd.y) > 1e-6 ? (1.0 - ro.y) / rd.y : 1e6;
      float tApex = abs(rd.y) > 1e-6 ? -ro.y / rd.y : 1e6;
      if (camInside) {
        if (gl_FrontFacing) discard;
        t0 = 0.0; t1 = 1.0;
      } else if (gl_FrontFacing) {
        t1 = 1e6;
        if (tOther > 1.0001) t1 = min(t1, tOther);
        if (tCap > 1.0001) t1 = min(t1, tCap);
        if (tApex > 1.0001) t1 = min(t1, tApex);
        if (t1 > 1e5) t1 = 1.0;
      } else {
        discard;
      }
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float sum = 0.0;
      for (int i = 0; i < 8; i++) {
        float t = mix(t0, t1, (float(i) + n) / 8.0);
        sum += sampleProj(ro + rd * t);
      }
      // One face instead of two: twice the old per-face brightness.
      g = 2.0 * sum / 8.0;
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

const _yAxis = new THREE.Vector3(0, 1, 0);

/** Volumetric-looking additive cone, apex at origin, pointing +Y. */
export class Beam {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uIntensity: { value: 0 },
        uUseMap: { value: 0 },
        uMap: { value: null },
        uToLight: { value: new THREE.Matrix4() },
        uFieldTan: { value: 1 },
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
    // The cone's own matrix maps it into the frame of the light that owns the projection.
    this.material.uniforms.uToLight.value = this.mesh.matrix;
  }

  set(color, intensity, angleDeg, length = BEAM_LENGTH) {
    const r = Math.tan(THREE.MathUtils.degToRad(Math.max(0.1, Math.min(170, angleDeg)) / 2)) * length;
    this.mesh.scale.set(r, length, r);
    this.material.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    this.material.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.002;
  }

  /** Sample a projection texture covering ±fieldTan around the parent's +Y (null = plain beam). */
  setMap(texture, fieldTan = 1) {
    const u = this.material.uniforms;
    u.uUseMap.value = texture ? 1 : 0;
    u.uMap.value = texture;
    u.uFieldTan.value = fieldTan;
  }

  /** Point the cone along (x, 1, y) of its parent (tan-space offset of a prism copy). */
  aim(x, y) {
    _v1.set(x, 1, y).normalize();
    this.mesh.quaternion.setFromUnitVectors(_yAxis, _v1);
  }

  dispose() {
    this.material.dispose();
  }
}

function bodyMaterial() {
  return housing();
}
function darkMaterial() {
  return rubber();
}

function lensMaterial(pattern = null) {
  return lens(pattern);
}

function setLens(mat, color, intensity, boost = 5) {
  setGlow(mat, color, intensity, boost);
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
    this.disposed = true;
    for (const b of this.beams) b.dispose();
    if (this.light) this.ctx.releaseLight();
    this.root.traverse((o) => {
      if (o.isMesh && o.material && !isShared(o.material) && !o.material.isShaderMaterial && !o.material.userData?.cached) o.material.dispose?.();
      if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    });
  }
}

// ------------------------------------------------------------------ Par
/** slim = flat LED par (most DJ uplights), can = classic PAR can, pin = pinspot. */
function parStyle(profile) {
  if (profile.kind === 'pinspot') return 'pin';
  if (profile.parStyle) return profile.parStyle;
  const text = `${profile.name} ${profile.manufacturer || ''}`.toLowerCase();
  if (/\bcan\b|halogen|par ?(56|64)|cp ?6[0-2]/.test(text)) return 'can';
  if (profile.channels.every((c) => c.type === 'dimmer' || c.type === 'none')) return 'can';
  return 'slim';
}

class ParModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const style = parStyle(profile);
    let faceY;
    if (style === 'slim') {
      // Flat LED par: square housing, LED matrix behind clear glass, U bracket.
      const size = 0.25; const thick = 0.075; const pivot = 0.16;
      this.root.add(parBracket(size, pivot));
      const body = new THREE.Group();
      body.position.y = pivot;
      const shell = rbox(size, thick, size, 0.022);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.7, size * 0.7), grille());
      back.rotation.x = Math.PI / 2;
      back.position.y = -thick / 2 - 0.001;
      const panel = controlPanel(size, fixture.address);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(0, -thick / 2 - 0.002, size * 0.3);
      panel.scale.setScalar(0.6);
      this.lensMat = lensMaterial([6, 6]);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.84, size * 0.84), this.lensMat);
      face.rotation.x = -Math.PI / 2;
      face.position.y = thick / 2 + 0.001;
      const cover = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.86, size * 0.86), glass());
      cover.rotation.x = -Math.PI / 2;
      cover.position.y = thick / 2 + 0.003;
      body.add(shell, back, panel, face, cover);
      this.root.add(body);
      faceY = pivot + thick / 2 + 0.003;
    } else {
      const pin = style === 'pin';
      const r = pin ? 0.055 : 0.11; const len = pin ? 0.14 : 0.26; const pivot = pin ? 0.09 : 0.17;
      this.root.add(parBracket(r * 2 + 0.02, pivot));
      const can = new THREE.Group();
      can.position.y = pivot;
      const shell = cyl(r, r * 1.04, len, pin ? alu() : housing(), 36);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.008, 10, 36), steel());
      rim.rotation.x = Math.PI / 2;
      rim.position.y = len / 2;
      const rear = cyl(r * 0.6, r * 0.9, 0.05, steel(), 24);
      rear.position.y = -len / 2 - 0.025;
      this.lensMat = lensMaterial('fresnel');
      const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.94, 36), this.lensMat);
      face.rotation.x = -Math.PI / 2;
      face.position.y = len / 2 + 0.001;
      can.add(shell, rim, rear, face);
      this.root.add(can);
      faceY = pivot + len / 2 + 0.002;
    }
    this.beam = new Beam();
    this.beam.mesh.position.y = faceY;
    this.beams.push(this.beam);
    this.root.add(this.beam.mesh);
    const light = this.createLight(profile.beamAngle[1]);
    if (light) { light.position.y = faceY; this.root.add(light); }
    this.addLabel();
    this.label.position.y = faceY + 0.25;
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
    // Real proportions: beam ≈ BeamZ Panther 60, spot ≈ Chauvet Intimidator Spot, wash = round LED head.
    const dims = {
      beam: { base: [0.21, 0.075, 0.18], arm: 0.17, span: 0.17 },
      spot: { base: [0.27, 0.09, 0.21], arm: 0.24, span: 0.19 },
      wash: { base: [0.29, 0.09, 0.23], arm: 0.22, span: 0.27 },
    }[style] || { base: [0.27, 0.09, 0.21], arm: 0.24, span: 0.19 };
    const [bw, bh, bd] = dims.base;
    this.root.add(movingBase(bw, bh, bd, fixture.address));

    this.yoke = new THREE.Group();
    this.yoke.position.y = 0.01 + bh + 0.018;
    this.yoke.add(yokeArms(dims.span, dims.arm, Math.min(0.12, bd * 0.62)));
    this.root.add(this.yoke);

    this.head = new THREE.Group();
    const pivotY = dims.arm - Math.min(0.12, bd * 0.62) * 0.42;
    this.head.position.y = pivotY;
    this.yoke.add(this.head);
    let built;
    if (style === 'wash') built = roundHead(0.125, 0.17, 0.105, [7, 7]);
    else if (style === 'beam') built = roundHead(0.078, 0.2, 0.058, 'fresnel');
    else built = spotHead(0.16, 0.27, 0.15, 0.052);
    this.head.add(built.group);
    // Tilt hubs where the head meets the arms.
    for (const sgn of [-1, 1]) {
      const hub = cyl(0.028, 0.028, 0.02, trim(), 20);
      hub.rotation.z = Math.PI / 2;
      hub.position.x = sgn * (dims.span / 2 - 0.006);
      this.head.add(hub);
    }
    this.lensMat = built.lensMat;
    const lensY = built.frontY;

    // Pool of beams: one per prism copy (the first one is the plain beam).
    this.beamOrigin = new THREE.Group();
    this.beamOrigin.position.y = lensY;
    this.head.add(this.beamOrigin);
    this.prismBeams = [];
    for (let i = 0; i < PRISM_BEAMS; i++) {
      const b = new Beam();
      this.prismBeams.push(b);
      this.beams.push(b);
      this.beamOrigin.add(b.mesh);
    }
    this.beam = this.prismBeams[0];
    const light = this.createLight(profile.beamAngle[1]);
    if (light) this.beamOrigin.add(light);
    // Gobo / prism / frost: projection texture shared by the beams and the spot light.
    this.goboCapable = profile.channels.some((c) => GOBO_TYPES.has(c.type));
    this.proj = null;
    this.projActive = false;
    if (this.goboCapable && light && ctx.goboLights) {
      light.shadow.camera.near = 0.05;
      light.shadow.focus = 1;
      ctx.goboLights.register(this);
    }
    this.addLabel();
    this.label.position.y = 0.55;
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
    const layout = this.goboCapable ? projectionLayout(s, this.profile) : null;
    this.projActive = !!(layout && layout.active && s.intensity > 0.002);
    if (this.projActive) {
      if (!this.proj) this.proj = new ProjectionTexture();
      this.proj.request(layout);
    }
    const copies = this.projActive ? layout.copies : [{ x: 0, y: 0, w: 1 }];
    const coneDeg = this.projActive ? THREE.MathUtils.radToDeg(Math.atan(layout.beamTan)) * 2 : s.beamAngle;
    this.prismBeams.forEach((b, i) => {
      const c = copies[i];
      if (!c) { b.set(s.color, 0, coneDeg); return; }
      b.aim(c.x, c.y);
      b.setMap(this.projActive ? this.proj.texture : null, this.projActive ? layout.fieldTan : 1);
      b.set(s.color, s.intensity * gain * c.w, coneDeg);
    });
    const angle = this.projActive ? THREE.MathUtils.radToDeg(Math.atan(layout.fieldTan)) * 2 : s.beamAngle;
    // A gobo blocks part of the light, and a projection must not burn out to a white blob.
    const share = !this.projActive ? 1 : layout.wheels.length ? 0.22 : layout.copies.length > 1 ? 0.45 : 0.6;
    this.updateLight(s.color, s.intensity * share, angle, this.profile.style === 'wash' ? 130 : 170);
    // The projection draws the edge itself; the cone must cover the whole texture.
    if (this.light && this.projActive) this.light.angle = Math.min(Math.PI / 2.2, Math.atan(layout.fieldTan));
  }

  dispose() {
    if (this.ctx.goboLights) this.ctx.goboLights.unregister(this);
    if (this.proj) this.proj.dispose();
    super.dispose();
  }
}

// ------------------------------------------------------------------ LED bar / blinder (pixels)
class PixelModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    const n = Math.max(1, profile.pixels || 1);
    const blinder = profile.kind === 'blinder';
    const cell = blinder ? 0.26 : 0.125;
    const length = Math.max(profile.dimensions ? profile.dimensions[0] : 0, n * cell + 0.06);
    const depth = blinder ? 0.3 : 0.09;
    const thick = blinder ? 0.12 : 0.075;
    // Aluminium profile with rounded edges, end caps and two mounting feet.
    const body = rbox(length, thick, depth, blinder ? 0.02 : 0.015);
    body.position.y = -thick / 2;
    this.root.add(body);
    for (const sx of [-1, 1]) {
      const cap = rbox(0.02, thick * 1.05, depth * 1.04, 0.006, trim());
      cap.position.set(sx * (length / 2 - 0.005), -thick / 2, 0);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, depth * 0.9), steel());
      foot.position.set(sx * (length / 2 - 0.12), -thick - 0.025, 0);
      this.root.add(cap, foot);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(length * 0.8, depth * 0.6), grille());
    back.rotation.x = Math.PI / 2;
    back.position.y = -thick - 0.001;
    this.root.add(back);
    this.cells = [];
    const pitch = (length - 0.06) / n;
    for (let i = 0; i < n; i++) {
      const mat = lensMaterial(blinder ? 'fresnel' : [3, 1]);
      const x = -length / 2 + 0.03 + pitch * (i + 0.5);
      let lensMesh;
      if (blinder) {
        lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), mat);
        const cup = reflector(0.11, 0.06, alu());
        cup.position.set(x, 0.002, 0);
        this.root.add(cup);
      } else {
        lensMesh = new THREE.Mesh(new THREE.PlaneGeometry(pitch * 0.88, depth * 0.62), mat);
      }
      lensMesh.rotation.x = -Math.PI / 2;
      lensMesh.position.set(x, 0.001, 0);
      this.root.add(lensMesh);
      const beam = new Beam();
      beam.mesh.position.set(x, 0, 0);
      this.root.add(beam.mesh);
      this.beams.push(beam);
      this.cells.push({ mat, beam });
    }
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(length - 0.04, depth * 0.8), glass());
    cover.rotation.x = -Math.PI / 2;
    cover.position.y = 0.003;
    this.root.add(cover);
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
    // Black hexagonal housing with bevelled edges, gold front rim, U bracket behind.
    const body = hexBody(0.285, 0.1);
    body.rotation.y = Math.PI / 6;
    body.position.y = -0.012;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 6, 1, true), retroGold());
    rim.rotation.y = Math.PI / 6;
    rim.position.y = -0.005;
    this.root.add(body, rim);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.2, 0.04), steel());
      arm.position.set(sx * 0.27, -0.16, 0);
      const knob = cyl(0.022, 0.022, 0.014, rubber(), 16);
      knob.rotation.z = Math.PI / 2;
      knob.position.set(sx * 0.278, -0.07, 0);
      this.root.add(arm, knob);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.008, 0.04), steel());
    bar.position.y = -0.26;
    this.root.add(bar);
    this.cells = [];
    const n = Math.max(1, profile.pixels || 7);
    hex7Layout(pitch).slice(0, n).forEach(([x, z]) => {
      // Gold parabolic reflector that glows with the bulb, a glass bulb and a hot filament.
      const cupMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.22, metalness: 0.9, side: THREE.DoubleSide, emissive: 0x000000 });
      const cup = reflector(0.074, 0.055, cupMat);
      cup.position.set(x, 0.0, z);
      const bulbGlass = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), glass());
      bulbGlass.position.set(x, -0.03, z);
      const mat = lensMaterial();
      const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.028, 8), mat);
      filament.rotation.z = Math.PI / 2;
      filament.position.set(x, -0.03, z);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), mat);
      glow.position.set(x, -0.03, z);
      const beam = new Beam();
      beam.mesh.position.set(x, 0, z);
      this.root.add(cup, bulbGlass, filament, glow, beam.mesh);
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
  if (!goldMat) {
    goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a050, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
    goldMat.userData.cached = true;
  }
  return goldMat;
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
    // Housing with a polished reflector channel and a xenon-style tube behind glass.
    const body = rbox(0.42, 0.12, 0.17, 0.02);
    body.position.y = -0.06;
    const channel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 24, 1, true, Math.PI / 2, Math.PI), alu());
    channel.rotation.z = Math.PI / 2;
    channel.position.y = -0.002;
    this.lensMat = lensMaterial();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 16), this.lensMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.y = -0.02;
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.13), glass());
    cover.rotation.x = -Math.PI / 2;
    cover.position.y = 0.002;
    this.root.add(body, channel, tube, cover, parBracket(0.44, 0.0, steel()).translateY(-0.2));
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
    const body = rbox(0.34, 0.24, 0.34, 0.025);
    body.position.y = 0.13;
    const top = cyl(0.045, 0.07, 0.05, alu(), 24);
    top.position.y = 0.275;
    const panel = controlPanel(0.34, fixture.address);
    panel.position.set(0, 0.13, 0.171);
    this.root.add(body, top, panel, feet(0.34, 0.34));
    for (const sx of [-1, 1]) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), grille());
      v.rotation.y = sx * Math.PI / 2;
      v.position.set(sx * 0.171, 0.13, 0);
      this.root.add(v);
    }
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
    const body = rbox(0.5, 0.36, 0.6, 0.03);
    body.position.y = 0.19;
    const nozzle = rbox(0.32, 0.08, 0.1, 0.02, trim());
    nozzle.position.set(0, 0.11, 0.33);
    const top = handle(0.3);
    top.position.y = 0.37;
    const panel = controlPanel(0.4, fixture.address);
    panel.position.set(0, 0.27, 0.301);
    this.root.add(body, nozzle, top, panel, feet(0.5, 0.6));
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
    const body = rbox(0.26, 0.2, 0.12, 0.015);
    body.position.y = -0.1;
    for (let i = 0; i < 7; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.16, 0.04), alu());
      fin.position.set(-0.09 + i * 0.03, -0.1, -0.08);
      this.root.add(fin);
    }
    this.lensMat = lensMaterial();
    const aperture = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03), this.lensMat);
    aperture.rotation.x = -Math.PI / 2;
    aperture.position.y = 0.001;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.06), glass());
    win.rotation.x = -Math.PI / 2;
    win.position.y = 0.002;
    this.root.add(body, aperture, win);
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
      b.set(s.color, gain, 0.35, 30);
    });
  }
}

// ------------------------------------------------------------------ Fog machine
class FogModel extends BaseModel {
  constructor(fixture, profile, ctx) {
    super(fixture, profile, ctx);
    // Hazer / fog machine (like ADJ Entour): rounded box, top handle, front fan + nozzle, LCD at the back.
    const body = rbox(0.27, 0.22, 0.42, 0.025);
    body.position.y = 0.12;
    const top = handle(0.2);
    top.rotation.y = Math.PI / 2;
    top.position.y = 0.23;
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), grille());
    fan.position.set(0.035, 0.12, 0.211);
    const nozzle = cyl(0.022, 0.03, 0.04, rubber(), 16);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(-0.08, 0.12, 0.225);
    const panel = controlPanel(0.27, fixture.address);
    panel.rotation.y = Math.PI;
    panel.position.set(0, 0.15, -0.211);
    this.root.add(body, top, fan, nozzle, panel, feet(0.27, 0.42));
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
  const model = createProcedural(fixture, profile, ctx);
  if (profile.model) applyModel(model, profile).catch((err) => console.warn('Model 3D:', err.message));
  return model;
}

function createProcedural(fixture, profile, ctx) {
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
