// Lightweight CPU particle system drawn as instanced quads (sparks, low fog,
// mirror-ball dots). Quads face the camera, or lie flat on the floor (`flat`).
import * as THREE from 'three';

const vertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iColor;   // rgb + alpha
  attribute float iSize;   // world size (m)
  uniform float uFlat;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    vColor = iColor;
    vUv = uv;
    vec4 mv;
    if (uFlat > 0.5) {
      mv = modelViewMatrix * vec4(iPos + vec3(position.x, 0.0, position.y) * iSize, 1.0);
    } else {
      mv = modelViewMatrix * vec4(iPos, 1.0);
      mv.xy += position.xy * iSize;
    }
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

const textures = {};
/** Soft round sprite. `hard` gives a bright core for sparks. */
export function dotTexture(hard = false) {
  const key = hard ? 'hard' : 'soft';
  if (textures[key]) return textures[key];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hard) {
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grd.addColorStop(0, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  textures[key] = t;
  return t;
}

export class Particles {
  /**
   * @param max       maximum live particles
   * @param opts      { additive, hard }
   */
  constructor(max, opts = {}) {
    this.max = max;
    this.scalable = opts.scalable ?? max >= 500;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.base = new Float32Array(max * 4); // base rgb + base size

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iColor', this.aCol);
    geo.setAttribute('iSize', this.aSize);
    geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dotTexture(opts.hard) }, uFlat: { value: opts.flat ? 1 : 0 } },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Mesh(geo, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = opts.additive ? 12 : 11;
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b) {
    if (this.count >= this.max) return;
    // Quality preset: big emitters (sparks, low fog) spawn only a share of their particles.
    if (this.scalable && Particles.budget < 1 && Math.random() > Particles.budget) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = size;
  }

  /**
   * Advances every particle. `shade(i, t, out)` returns alpha and may scale
   * size/color through `out` ({ alpha, size, r, g, b }).
   */
  update(dt, { gravity = 0, drag = 0, floor = null, bounce = 0 }, shade) {
    const out = { alpha: 1, size: 1, r: 1, g: 1, b: 1 };
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this._kill(i);
        continue;
      }
      const k = i * 3;
      this.vel[k + 1] -= gravity * dt;
      const d = Math.max(0, 1 - drag * dt);
      this.vel[k] *= d; this.vel[k + 1] *= d; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (floor != null && this.pos[k + 1] < floor) {
        this.pos[k + 1] = floor;
        this.vel[k + 1] = -this.vel[k + 1] * bounce;
      }
      const t = this.age[i] / this.life[i];
      out.alpha = 1; out.size = 1; out.r = 1; out.g = 1; out.b = 1;
      shade(i, t, out);
      const c = i * 4;
      this.col[c] = this.base[c] * out.r;
      this.col[c + 1] = this.base[c + 1] * out.g;
      this.col[c + 2] = this.base[c + 2] * out.b;
      // Fewer particles (lower quality) each carry a little more, so the effect keeps its density.
      this.col[c + 3] = this.scalable && Particles.budget < 1 ? Math.min(1, out.alpha / Math.pow(Math.max(0.1, Particles.budget), 0.3)) : out.alpha;
      this.size[i] = this.base[c + 3] * out.size;
      i++;
    }
    this.points.geometry.instanceCount = this.count;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.base.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.life[i] = this.life[last];
    this.age[i] = this.age[last];
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Share of particles big emitters spawn (1 = all), set by the quality preset. */
Particles.budget = 1;
