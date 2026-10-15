// Venue interiors: a banquet / wedding hall and a neutral empty room, with
// house lights (chandeliers, cove light) that can be dimmed.
import * as THREE from 'three';
import {
  parquetTexture, concreteTexture, plasterTexture, wainscotTexture, curtainTexture, windowTexture, cofferTexture, repeated,
} from './textures.js';

export const ROOM_STYLES = { banquet: 'Sală de evenimente (nuntă)', plain: 'Sală goală', dark: 'Club (întunecat)' };

const room = (mesh) => { mesh.userData.isRoom = true; return mesh; };

/** Wavy plane for curtains (folds along X). */
function curtain(width, height, color, folds = 10) {
  const geo = new THREE.PlaneGeometry(width, height, folds * 6, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / width) * Math.PI * 2 * folds) * 0.05);
  geo.computeVertexNormals();
  const tex = repeated(curtainTexture(), Math.max(1, width / 1.6), 1);
  const mat = new THREE.MeshStandardMaterial({ color, map: tex, roughness: 0.85, side: THREE.DoubleSide });
  return room(new THREE.Mesh(geo, mat));
}

/** A wall with plaster, wainscoting, rails and optional windows; built in local XY (facing +Z). */
function wall(len, hgt, color, windows) {
  const g = new THREE.Group();
  const plaster = room(new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), new THREE.MeshStandardMaterial({ color, map: repeated(plasterTexture(), len / 3, hgt / 3), roughness: 0.92 })));
  plaster.position.y = hgt / 2;
  g.add(plaster);
  const wh = 1.05;
  const wains = room(new THREE.Mesh(new THREE.PlaneGeometry(len, wh), new THREE.MeshStandardMaterial({ color: 0xf2eee6, map: repeated(wainscotTexture(), Math.round(len / 1.2), 1), roughness: 0.6 })));
  wains.position.set(0, wh / 2, 0.012);
  g.add(wains);
  const trim = new THREE.MeshStandardMaterial({ color: 0xf5f2ec, roughness: 0.5 });
  const rail = room(new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.05), trim));
  rail.position.set(0, wh, 0.025);
  const skirt = room(new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.03), trim));
  skirt.position.set(0, 0.07, 0.015);
  const crown = room(new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.12), trim));
  crown.position.set(0, hgt - 0.09, 0.06);
  g.add(rail, skirt, crown);
  for (const x of windows) {
    const win = room(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), new THREE.MeshBasicMaterial({ map: windowTexture() })));
    win.position.set(x, 2.55, 0.02);
    const frame = room(new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.8, 0.06), trim));
    frame.position.set(x, 2.55, 0.0);
    g.add(frame, win);
    for (const s of [-1, 1]) {
      const c = curtain(0.8, hgt - 0.5, 0x7a2232, 4);
      c.position.set(x + s * 1.05, (hgt - 0.5) / 2 + 0.1, 0.12);
      g.add(c);
    }
  }
  return g;
}

/** Crystal chandelier: gold frame, candle bulbs, crystal drops and one point light. */
function chandelier(scale = 1) {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8a25a, metalness: 0.9, roughness: 0.28 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8), gold);
  stem.position.y = 0.45;
  g.add(stem);
  const bulbs = [];
  const crystals = [];
  for (const [r, y, n] of [[0.55, 0, 10], [0.32, 0.28, 6]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 48), gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      bulbs.push(new THREE.Vector3(Math.cos(a) * r, y + 0.12, Math.sin(a) * r));
      crystals.push(new THREE.Vector3(Math.cos(a + 0.3) * r, y - 0.12, Math.sin(a + 0.3) * r));
      crystals.push(new THREE.Vector3(Math.cos(a) * r * 0.75, y - 0.2, Math.sin(a) * r * 0.75));
    }
  }
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gold);
  bowl.position.y = -0.02;
  g.add(bowl);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), bulbMat, bulbs.length);
  const m = new THREE.Matrix4();
  bulbs.forEach((p, i) => bulbMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.75, emissive: 0xffe6c0, emissiveIntensity: 0 });
  const crystalMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.035), crystalMat, crystals.length);
  crystals.forEach((p, i) => crystalMesh.setMatrixAt(i, m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1.8, 1))));
  g.add(bulbMesh, crystalMesh);
  const light = new THREE.PointLight(0xffc98a, 0, 0, 2);
  light.position.y = 0.05;
  g.add(light);
  g.scale.setScalar(scale);
  g.traverse((o) => { o.userData.isRoom = true; o.raycast = () => {}; });
  return { group: g, light, bulbMat, crystalMat };
}

/**
 * Build the interior into `group`.
 * @returns {{ setHouse(level: number): void }}
 */
export function buildVenue(r, group, ctx) {
  const w = r.width || 24; const d = r.depth || 20; const hgt = r.height || 6;
  const style = r.style;
  const floorTex = style === 'banquet' ? repeated(parquetTexture(), w / 2, d / 2) : repeated(concreteTexture(), w / 4, d / 4);
  const floor = room(new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({
    color: style === 'banquet' ? 0xffffff : (r.floorColor || '#9a9792'), map: floorTex, roughness: style === 'banquet' ? 0.4 : 0.7, metalness: 0,
  })));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  if (r.grid !== false && style !== 'banquet') {
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d), 0x55555c, 0x45454b);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    grid.raycast = () => {};
    group.add(grid);
  }
  const lamps = [];
  const coves = [];
  if (r.walls !== false) {
    const wallColor = r.wallColor || (style === 'banquet' ? '#d8cdbd' : '#bdbab4');
    const winsSide = style === 'banquet' ? range(-d / 2 + 3, d / 2 - 2, 4) : [];
    const back = style === 'banquet' ? wall(w, hgt, wallColor, []) : plainWall(w, hgt, wallColor);
    back.position.set(0, 0, -d / 2);
    const left = style === 'banquet' ? wall(d, hgt, wallColor, winsSide) : plainWall(d, hgt, wallColor);
    left.rotation.y = Math.PI / 2;
    left.position.set(-w / 2, 0, 0);
    const right = style === 'banquet' ? wall(d, hgt, wallColor, winsSide.map((z) => -z)) : plainWall(d, hgt, wallColor);
    right.rotation.y = -Math.PI / 2;
    right.position.set(w / 2, 0, 0);
    group.add(back, left, right);
    const ceilMat = style === 'banquet'
      ? new THREE.MeshStandardMaterial({ color: 0xf2eee6, map: repeated(cofferTexture(), w / 2, d / 2), roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ color: 0x8a8884, roughness: 0.95 });
    // Ceiling faces down only, so the top view still looks through it.
    const ceiling = room(new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = hgt;
    group.add(ceiling);

    if (style === 'banquet') {
      // Chiffon drape behind the DJ.
      const drape = curtain(Math.min(w * 0.55, 12), hgt - 0.3, 0xf3ece2, 16);
      drape.position.set(0, (hgt - 0.3) / 2, -d / 2 + 0.15);
      group.add(drape);
      // Warm cove light along the ceiling.
      const coveMat = new THREE.MeshBasicMaterial({ color: 0xffd7a0, toneMapped: false });
      for (const [len, x, z, ry] of [[w, 0, -d / 2 + 0.25, 0], [d, -w / 2 + 0.25, 0, Math.PI / 2], [d, w / 2 - 0.25, 0, Math.PI / 2]]) {
        const strip = room(new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), coveMat));
        strip.position.set(x, hgt - 0.22, z);
        strip.rotation.y = ry;
        strip.raycast = () => {};
        group.add(strip);
      }
      coves.push(coveMat);
      // Chandeliers over the guests, away from the mirror ball / dance floor.
      const spots = [[-w * 0.27, -d * 0.12], [w * 0.27, -d * 0.12], [-w * 0.27, d * 0.25], [w * 0.27, d * 0.25]];
      for (const [x, z] of spots) {
        const c = chandelier(1);
        c.group.position.set(x, hgt - 1.25, z);
        group.add(c.group);
        lamps.push(c);
      }
    }
  }
  return {
    setHouse(level) {
      for (const c of lamps) {
        c.light.intensity = level * 60;
        const k = 0.25 + level * 2.2;
        c.bulbMat.color.setRGB(k, k * 0.82, k * 0.55);
        c.crystalMat.emissiveIntensity = level * 0.6;
      }
      for (const m of coves) { const k = 0.1 + level * 1.8; m.color.setRGB(k, k * 0.82, k * 0.6); }
    },
  };
}

function plainWall(len, hgt, color) {
  const g = new THREE.Group();
  const m = room(new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), new THREE.MeshStandardMaterial({ color, map: repeated(plasterTexture(), len / 3, hgt / 3), roughness: 0.95 })));
  m.position.y = hgt / 2;
  g.add(m);
  return g;
}

function range(from, to, step) {
  const out = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}
