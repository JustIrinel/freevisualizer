// Stage elements: truss, DJ booth, speakers, risers, screens, crowd, walls.
import * as THREE from 'three';
import { Particles } from './particles.js';

export const PROP_TYPES = {
  truss: { label: 'Truss (orizontal)', params: { length: 6 } },
  column: { label: 'Stâlp truss (vertical)', params: { length: 3.5 } },
  booth: { label: 'Cabină DJ', params: { width: 2, height: 1.1, depth: 0.7 } },
  speaker: { label: 'Boxă', params: { width: 0.5, height: 1.0, depth: 0.45 } },
  sub: { label: 'Subwoofer', params: { width: 0.7, height: 0.6, depth: 0.7 } },
  platform: { label: 'Podium / scenă', params: { width: 4, height: 0.4, depth: 2 } },
  screen: { label: 'Ecran LED', params: { width: 3, height: 1.7 } },
  wall: { label: 'Perete / backdrop', params: { width: 8, height: 4 } },
  table: { label: 'Masă rotundă', params: { diameter: 1.6 } },
  headtable: { label: 'Masa mirilor', params: { width: 4, depth: 0.9 } },
  dancefloor: { label: 'Ring de dans', params: { width: 7, depth: 7 } },
  mirrorball: { label: 'Glob disco', params: { diameter: 0.5, drop: 0.8, rpm: 2 } },
  crowd: { label: 'Public (invitați)', params: { width: 8, depth: 6, count: 60 } },
};

const metal = () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85 });
const black = () => new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.7, metalness: 0.1 });

function trussSection(length) {
  const g = new THREE.Group();
  const size = 0.29;
  const h = size / 2;
  const mat = metal();
  const chordGeo = new THREE.CylinderGeometry(0.024, 0.024, length, 8);
  chordGeo.rotateZ(Math.PI / 2);
  for (const [y, z] of [[h, h], [h, -h], [-h, h], [-h, -h]]) {
    const m = new THREE.Mesh(chordGeo, mat);
    m.position.set(0, y, z);
    g.add(m);
  }
  // Diagonal lacing as line segments (cheap and reads well from a distance).
  const pts = [];
  const steps = Math.max(1, Math.round(length / size));
  const step = length / steps;
  for (let i = 0; i < steps; i++) {
    const x0 = -length / 2 + i * step;
    const x1 = x0 + step;
    const flip = i % 2 ? 1 : -1;
    pts.push(x0, h, h * flip, x1, h, -h * flip);
    pts.push(x0, -h, h * flip, x1, -h, -h * flip);
    pts.push(x0, h * flip, h, x1, -h * flip, h);
    pts.push(x0, h * flip, -h, x1, -h * flip, -h);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8a939c })));
  return g;
}

function speakerFront(w, h, d) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), black());
  box.position.y = h / 2;
  g.add(box);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.9 });
  const r = Math.min(w, h) * 0.32;
  const woofer = new THREE.Mesh(new THREE.CircleGeometry(r, 32), coneMat);
  woofer.position.set(0, h * 0.32, d / 2 + 0.002);
  g.add(woofer);
  if (h > w) {
    const tw = new THREE.Mesh(new THREE.CircleGeometry(r * 0.45, 24), coneMat);
    tw.position.set(0, h * 0.75, d / 2 + 0.002);
    g.add(tw);
  }
  return g;
}

let crowdGeo = null;
function personGeometry() {
  if (!crowdGeo) {
    const body = new THREE.CapsuleGeometry(0.2, 1.0, 4, 10);
    body.translate(0, 0.7, 0);
    const head = new THREE.SphereGeometry(0.12, 12, 8);
    head.translate(0, 1.55, 0);
    crowdGeo = mergeSimple([body, head]);
  }
  return crowdGeo;
}

function mergeSimple(geos) {
  const positions = []; const normals = []; const indices = [];
  let offset = 0;
  for (const g of geos) {
    const gi = g.index ? g : g.toNonIndexed();
    const p = gi.attributes.position.array; const n = gi.attributes.normal.array;
    positions.push(...p); normals.push(...n);
    if (gi.index) for (const i of gi.index.array) indices.push(i + offset);
    offset += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (indices.length) out.setIndex(indices);
  return out;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function createPropModel(prop, ctx) {
  const p = { ...(PROP_TYPES[prop.type] || {}).params, ...(prop.params || {}) };
  const root = new THREE.Group();
  root.userData.objectId = prop.id;
  const animated = [];
  let extra = null;

  switch (prop.type) {
    case 'truss': root.add(trussSection(p.length)); break;
    case 'column': {
      const t = trussSection(p.length);
      t.rotation.z = Math.PI / 2;
      t.position.y = p.length / 2;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.02, 0.6), metal());
      plate.position.y = 0.01;
      root.add(t, plate);
      break;
    }
    case 'booth': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, p.depth), black());
      body.position.y = p.height / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.08, 0.04, p.depth + 0.08), new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.3, metalness: 0.5 }));
      top.position.y = p.height + 0.02;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(p.width * 0.9, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      strip.position.set(0, p.height * 0.82, p.depth / 2 + 0.003);
      animated.push((t) => strip.material.color.setHSL((t * 0.05) % 1, 0.9, 0.3));
      const deck = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.4, p.width * 0.7), 0.07, 0.4), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.5 }));
      deck.position.set(0, p.height + 0.075, -0.05);
      root.add(body, top, strip, deck);
      break;
    }
    case 'speaker': case 'sub': root.add(speakerFront(p.width, p.height, p.depth)); break;
    case 'platform': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, p.depth), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6 }));
      m.position.y = p.height / 2;
      root.add(m);
      break;
    }
    case 'screen': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.06, p.height + 0.06, 0.08), black());
      frame.position.y = p.height / 2;
      const mat = new THREE.MeshBasicMaterial({ color: 0x080810, toneMapped: false });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), mat);
      face.position.set(0, p.height / 2, 0.041);
      animated.push((t) => {
        const h = (t * 0.03) % 1;
        mat.color.setHSL(h, 0.7, 0.08 + 0.04 * Math.sin(t * 2));
      });
      root.add(frame, face);
      break;
    }
    case 'wall': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.height), new THREE.MeshStandardMaterial({ color: prop.color || 0x2a2a30, roughness: 0.85, side: THREE.DoubleSide }));
      m.position.y = p.height / 2;
      root.add(m);
      break;
    }
    case 'table': {
      // Tablecloth down to the floor, a centerpiece and a candle glow.
      const r = p.diameter / 2;
      const cloth = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.06, 0.76, 40, 1), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.92 }));
      cloth.position.y = 0.38;
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.35, 16), new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 0.8, roughness: 0.3 }));
      vase.position.y = 0.76 + 0.175;
      const flowers = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf3d7dc, roughness: 0.8 }));
      flowers.position.y = 0.76 + 0.42;
      const candle = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false }));
      candle.position.set(r * 0.45, 0.82, 0);
      const flicker = Math.random() * 10;
      animated.push((tt) => {
        const f = 1.6 + 0.5 * Math.sin(tt * 13 + flicker) * Math.sin(tt * 7.3 + flicker);
        candle.material.color.setRGB(f, f * 0.62, f * 0.25);
      });
      root.add(cloth, vase, flowers, candle);
      break;
    }
    case 'crowd': {
      const rnd = seeded(prop.seed || 7);
      const count = Math.max(1, Math.min(600, Math.round(p.count)));
      const mesh = new THREE.InstancedMesh(personGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), count);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const colors = [0x4a4f5c, 0x5c5866, 0x383f52, 0x6a6270, 0x465266, 0x7a2e3a, 0x2e4a6a];
      for (let i = 0; i < count; i++) {
        const s = 0.9 + rnd() * 0.2;
        e.set(0, rnd() * Math.PI * 2, 0);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3((rnd() - 0.5) * p.width, 0, (rnd() - 0.5) * p.depth), q, new THREE.Vector3(s, s * (0.92 + rnd() * 0.16), s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      }
      root.add(mesh);
      // Little bounce so the room feels alive.
      const base = [];
      for (let i = 0; i < count; i++) { const mm = new THREE.Matrix4(); mesh.getMatrixAt(i, mm); base.push(mm); }
      const tmp = new THREE.Matrix4();
      animated.push((t) => {
        for (let i = 0; i < count; i += 1) {
          const b = base[i];
          tmp.copy(b);
          tmp.elements[13] = Math.max(0, Math.sin(t * 13.2 + i * 1.7)) * 0.05;
          mesh.setMatrixAt(i, tmp);
        }
        mesh.instanceMatrix.needsUpdate = true;
      });
      break;
    }
    case 'headtable': {
      const cloth = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.9 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.76, p.depth), cloth);
      top.position.y = 0.38;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.02, 0.6, 0.02), new THREE.MeshStandardMaterial({ color: 0xd8c7a8, roughness: 0.8 }));
      skirt.position.set(0, 0.42, p.depth / 2 + 0.01);
      root.add(top, skirt);
      break;
    }
    case 'dancefloor': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.width, 0.03, p.depth), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.12, metalness: 0.4 }));
      m.position.y = 0.015;
      root.add(m);
      break;
    }
    case 'mirrorball':
      extra = mirrorBall(root, p, ctx);
      break;
    default: break;
  }

  return {
    root,
    needsEmitters: !!(extra && extra.needsEmitters),
    update(t, env) {
      for (const fn of animated) fn(t);
      if (extra) extra.update(t, env);
    },
    dispose() {
      if (extra) extra.dispose();
      root.traverse((o) => {
        if (o.geometry && o.geometry !== crowdGeo) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };
}

// ------------------------------------------------------------------ Mirror ball
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Ray from inside the room box to its walls/floor/ceiling (null when it escapes). */
function hitRoom(o, d, box, walls) {
  let t = Infinity;
  const test = (num, den) => { if (Math.abs(den) > 1e-6) { const v = num / den; if (v > 0 && v < t) t = v; } };
  if (d.y < 0) test(box.min.y - o.y, d.y);
  if (walls) {
    if (d.y > 0) test(box.max.y - o.y, d.y);
    test((d.x > 0 ? box.max.x : box.min.x) - o.x, d.x);
    test((d.z > 0 ? box.max.z : box.min.z) - o.z, d.z);
  }
  return Number.isFinite(t) ? t : null;
}

function mirrorBall(root, p, ctx) {
  const r = p.diameter / 2;
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 3),
    new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.18, flatShading: true, emissive: 0x000000 }),
  );
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, p.drop, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  rod.position.y = r + p.drop / 2;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  motor.position.y = r + p.drop;
  root.add(ball, rod, motor);

  // Fixed reflection directions; the ball's rotation spins them around Y.
  const N = 220;
  const dirs = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    dirs.push(new THREE.Vector3(s * Math.cos(a), z * 0.85 - 0.15, s * Math.sin(a)).normalize());
  }
  const dots = new Particles(N, { additive: true, hard: true });
  const rayPos = new Float32Array(N * 6);
  const rayCol = new Float32Array(N * 6);
  const rayGeo = new THREE.BufferGeometry();
  rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3).setUsage(THREE.DynamicDrawUsage));
  rayGeo.setAttribute('color', new THREE.BufferAttribute(rayCol, 3).setUsage(THREE.DynamicDrawUsage));
  const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  rays.frustumCulled = false;
  rays.raycast = () => {};
  ctx.world.add(dots.points, rays);
  const light = [0, 0, 0];

  return {
    needsEmitters: true,
    update(t, env) {
      ball.rotation.y = t * (p.rpm / 60) * Math.PI * 2;
      // Light reaching the ball from fixtures whose beam cone contains it.
      ball.getWorldPosition(_c);
      light[0] = light[1] = light[2] = 0;
      for (const e of (env && env.emitters) || []) {
        _d.copy(_c).sub(e.pos).normalize();
        if (_d.dot(e.dir) < e.cosHalf) continue;
        light[0] += e.color[0] * e.intensity; light[1] += e.color[1] * e.intensity; light[2] += e.color[2] * e.intensity;
      }
      const lvl = Math.min(1.5, Math.max(light[0], light[1], light[2]));
      ball.material.emissive.setRGB(light[0] * 0.25, light[1] * 0.25, light[2] * 0.25);
      dots.count = 0;
      let n = 0;
      if (lvl > 0.01) {
        const haze = env ? env.globals.rawHaze : 0.5;
        _q.setFromAxisAngle(_up, ball.rotation.y);
        for (const d0 of dirs) {
          _d.copy(d0).applyQuaternion(_q);
          const hitT = hitRoom(_c, _d, ctx.roomBox, ctx.walls);
          if (hitT == null) continue;
          const hx = _c.x + _d.x * hitT; const hy = _c.y + _d.y * hitT; const hz = _c.z + _d.z * hitT;
          dots.spawn(hx, hy, hz, 0, 0, 0, 1, 0.05 + hitT * 0.006, light[0] * 1.6, light[1] * 1.6, light[2] * 1.6);
          const k = n * 6;
          rayPos[k] = _c.x; rayPos[k + 1] = _c.y; rayPos[k + 2] = _c.z;
          rayPos[k + 3] = hx; rayPos[k + 4] = hy; rayPos[k + 5] = hz;
          const rc = 0.07 * haze;
          for (let j = 0; j < 2; j++) { rayCol[k + j * 3] = light[0] * rc; rayCol[k + j * 3 + 1] = light[1] * rc; rayCol[k + j * 3 + 2] = light[2] * rc; }
          n++;
        }
      }
      rayGeo.setDrawRange(0, n * 2);
      rayGeo.attributes.position.needsUpdate = true;
      rayGeo.attributes.color.needsUpdate = true;
      dots.update(0, {}, (i, tt, o) => { o.alpha = 1; });
    },
    dispose() {
      ctx.world.remove(dots.points, rays);
      dots.dispose();
      rayGeo.dispose();
      rays.material.dispose();
    },
  };
}
