// The DJ behind the booth: one animated mannequin (guests3d.js) mixing on the beat, a hand in
// the air or on the headphones now and then. At Scăzută (or until the guests load) a simple
// static silhouette with the hands on the decks.
import * as THREE from 'three';
import { loadGuests, guestsReady, createAnimatedCrowd } from './guests3d.js';
import { dressDj, djClipAt, idSeed, DJ_DESK, DJ_BEHIND } from './guest-layout.js';

export { DJ_BEHIND };

/** Simple silhouette (dark clothes, hands forward on the desk), for the low quality level. */
function silhouette(look, skinHex) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.6 });
  const h = look === 2 ? 1.68 : 1.78;
  const k = h / 1.78;
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y * k, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.06, 0.05, 0.86 * k, 8), cloth, s * 0.09, 0.43, 0);
  const torso = add(new THREE.CylinderGeometry(0.17, 0.14, 0.62 * k, 12), cloth, 0, 1.2, 0.02, 0.12);
  torso.scale.z = 0.62;
  add(new THREE.SphereGeometry(0.1, 14, 10), skin, 0, 1.63, 0.07);
  // Arms reaching forward and down to the controller.
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Vector3(s * 0.17, 1.42 * k, 0.03);
    const hand = new THREE.Vector3(s * 0.19, 1.25, 0.46);
    const dir = hand.clone().sub(shoulder);
    const arm = add(new THREE.CylinderGeometry(0.04, 0.034, dir.length(), 8), cloth, 0, 0, 0);
    arm.position.copy(shoulder).addScaledVector(dir, 0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    add(new THREE.SphereGeometry(0.045, 8, 6), skin, hand.x, hand.y / k, hand.z);
  }
  return g;
}

/**
 * Add the DJ to `root` (booth-local: x, z, heading 0 = facing +z, the audience).
 * `desk`: booth height; the clips are made for DJ_DESK, a different booth scales the DJ a
 * little so the hands stay on the decks. Returns { update(), dispose() }.
 */
export function djFigure(root, { x = 0, z = 0, heading = 0, look = 1, desk = DJ_DESK, seed } = {}, animated, ctx) {
  const s0 = seed ?? idSeed(`dj${x}${z}`);
  const dressed = [dressDj(look, s0)];
  const scale = THREE.MathUtils.clamp(desk / DJ_DESK, 0.9, 1.1);
  dressed[0].height *= scale;
  const people = [{ x, z, heading, height: dressed[0].height, girth: 1 }];
  const holder = new THREE.Group();
  root.add(holder);
  const simple = silhouette(Number(look) === 2 ? 2 : 1, dressed[0].palette[0][0]);
  simple.position.set(x, 0, z);
  simple.rotation.y = heading;
  simple.scale.setScalar(scale);
  holder.add(simple);
  let live = null;
  loadGuests();
  animated.push((t) => {
    const quality = (ctx && (ctx.quality || (ctx.settings && ctx.settings.quality))) || 'high';
    const asset = quality !== 'low' ? guestsReady() : null;
    // Older guests.bin without the DJ clips: keep the silhouette.
    const ok = asset && asset.bodies[dressed[0].body]?.clips?.djMix;
    if (ok && !live) { live = createAnimatedCrowd(people, dressed, asset); holder.add(live.group); }
    simple.visible = !ok;
    if (!live) return;
    live.group.visible = !!ok;
    if (!ok) return;
    const beat = (t * ((ctx && ctx.bpm) || 124)) / 60;
    live.setClip(0, djClipAt(beat, s0));
    live.update(t, beat, true);
  });
  return {
    update() {},
    dispose() {
      if (live) live.dispose();
      simple.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      root.remove(holder);
    },
  };
}
