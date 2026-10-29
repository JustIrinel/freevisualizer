// Animated guests: outfits, clips on the beat, seats at the tables, the baked asset,
// and the PBR texture sets (procedural stand-ins in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Minimal DOM for canvas textures.
const any = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), set: () => true });
globalThis.document ??= {
  documentElement: {},
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, style: {}, getContext: () => any() }
    : { style: {}, className: '', classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, textContent: '' }),
};

const G = await import('../public/js/guest-layout.js');
const { crowdLayout } = await import('../public/js/prop-layout.js');
const { parseGuests } = await import('../public/js/guests3d.js');
const { pbrSet, PBR_TILE } = await import('../public/js/textures.js');

const R = G.GUEST_REGIONS;
const visible = (p, r) => p[r][1] >= 0;

test('every guest gets a full outfit; dresses have exactly one skirt length', () => {
  const people = crowdLayout({ width: 8, depth: 6, count: 60, density: 2, size: 1 }, 3);
  const dressed = G.dressCrowd(people, { seed: 3 });
  assert.equal(dressed.length, people.length);
  for (const d of dressed) {
    assert.equal(d.palette.length, G.REGION_COUNT);
    assert.ok(visible(d.palette, R.skin) && visible(d.palette, R.top) && visible(d.palette, R.shoes));
    if (d.body === 'female') {
      assert.equal(visible(d.palette, R.bottom) + visible(d.palette, R.skirtShort), 1, 'long or short skirt');
      assert.ok(!(visible(d.palette, R.bun) && visible(d.palette, R.hairLong)), 'one hair style');
    } else {
      assert.ok(visible(d.palette, R.bottom), 'trousers');
    }
    assert.ok(d.height > 1.4 && d.height < 2.0);
  }
  const women = dressed.filter((d) => d.body === 'female').length;
  assert.ok(women > 10 && women < 50, `mixed crowd (${women} women)`);
  // Same seed → same crowd.
  assert.deepEqual(G.dressCrowd(people, { seed: 3 }), dressed);
});

test('bride and groom in the middle; activity decides who dances', () => {
  const people = crowdLayout({ width: 6.5, depth: 5.5, count: 24, density: 2, size: 1 }, 7);
  const d = G.dressCrowd(people, { seed: 7, couple: true });
  const bride = d.findIndex((g) => g.role === 'bride');
  const groom = d.findIndex((g) => g.role === 'groom');
  assert.ok(bride >= 0 && groom >= 0 && bride !== groom);
  assert.equal(d[bride].body, 'female');
  assert.equal(d[groom].body, 'male');
  assert.ok(visible(d[bride].palette, R.bottom), 'bride in a long gown');
  assert.equal(d[bride].palette[R.top][0], 0xf6f3ec, 'white');
  const dist = (i) => Math.hypot(people[i].x, people[i].z);
  const others = people.map((_, i) => i).filter((i) => i !== bride && i !== groom);
  assert.ok(Math.max(dist(bride), dist(groom)) <= Math.min(...others.map(dist)) + 1e-9, 'nearest the middle');
  const danceClips = new Set(['dance', 'danceUp', 'dancePump', 'sway']);
  const stand = G.dressCrowd(people, { seed: 7, activity: 3 });
  assert.ok(stand.every((g) => !danceClips.has(g.clip)), 'stand and talk: nobody dances');
  const dance = G.dressCrowd(people, { seed: 7, activity: 1 });
  assert.ok(dance.filter((g) => danceClips.has(g.clip)).length >= 15, 'dance floor: most dance');
  assert.ok(dance.every((g) => !danceClips.has(g.rest)), 'everyone has a resting clip');
});

test('beat-locked clips land the beat on the same pose; offsets match the shader', () => {
  const clip = { beats: 2, hit: 8 / 30, seconds: 1 };
  for (const b of [0, 1, 2, 7, 15]) {
    const u = G.loopPosition(clip, { beat: b });
    assert.ok(Math.abs(((u - clip.hit) * 2 + 2) % 1) < 1e-9 || Math.abs(((u - clip.hit) * 2 + 2) % 1 - 1) < 1e-9, `beat ${b} on a hit`);
  }
  // Shader: fract(offset + beat / beats) must equal loopPosition.
  for (const [beat, off] of [[0.3, 0], [5.25, 1], [9.9, 3]]) {
    const z = G.loopOffset(clip, off);
    const shader = (z + beat / clip.beats) % 1;
    assert.ok(Math.abs(shader - G.loopPosition(clip, { beat, beatOffset: off })) < 1e-9);
  }
  const free = { beats: 0, seconds: 2.5 };
  const z = G.loopOffset(free, 0, 0.4);
  assert.ok(Math.abs((z + 3.1 / 2.5) % 1 - G.loopPosition(free, { time: 3.1, phase: 0.4 })) < 1e-9);
});

test('guests start dancing when the show runs and stop a few seconds after it ends', () => {
  let s = null;
  s = G.showState(s, 0, 0.1);
  assert.equal(s.on, false);
  for (let i = 0; i < 5; i++) s = G.showState(s, 0.5, 0.1);
  assert.equal(s.on, false, 'not on the first frames');
  for (let i = 0; i < 3; i++) s = G.showState(s, 0.5, 0.1);
  assert.equal(s.on, true);
  for (let i = 0; i < 10; i++) s = G.showState(s, 0, 0.1); // a blackout of one second
  assert.equal(s.on, true, 'short blackouts do not stop the dancing');
  for (let i = 0; i < 40; i++) s = G.showState(s, 0, 0.1);
  assert.equal(s.on, false);
});

test('seated guests face the table, one per chair, at most every chair', () => {
  const dia = 1.8;
  const chairs = G.chairCount(dia);
  assert.equal(chairs, 9);
  const seats = G.seatLayout(dia, 6, 42);
  assert.equal(seats.length, 6);
  assert.equal(new Set(seats.map((s) => s.chair)).size, 6);
  const rr = dia / 2 + G.CHAIR_OFFSET - G.SIT_BACK;
  for (const s of seats) {
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - rr) < 1e-9);
    // Facing (sin h, cos h) points at the centre.
    const f = [Math.sin(s.heading), Math.cos(s.heading)];
    const toC = [-s.x / rr, -s.z / rr];
    assert.ok(f[0] * toC[0] + f[1] * toC[1] > 0.999);
  }
  assert.equal(G.seatLayout(dia, 50, 1).length, chairs);
  assert.equal(G.seatLayout(dia, 0, 1).length, 0);
  assert.deepEqual(G.seatLayout(dia, 6, 42), seats, 'same chairs every rebuild');
  const d = G.dressSeated(seats, 42);
  assert.ok(d.every((g) => g.clip.startsWith('sit')));
  assert.ok(d.filter((g) => g.body === 'female').every((g) => !visible(g.palette, R.bottom) && visible(g.palette, R.skirtShort)));
});

test('baked guests: both bodies with every clip, valid skinning and regions', () => {
  const buf = fs.readFileSync(new URL('../public/models/guests.bin', import.meta.url));
  const asset = parseGuests(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const needed = new Set([...Object.values(G.DANCE_CLIPS).flat().map(([c]) => c), ...G.REST_CLIPS.map(([c]) => c), 'sit', 'sitTalk', 'idle']);
  for (const name of ['male', 'female']) {
    const b = asset.bodies[name];
    assert.ok(b, name);
    const g = b.geometry;
    const n = g.attributes.position.count;
    assert.ok(n > 1000 && n < 65536);
    assert.ok(b.triangles < 14000, `${name}: ${b.triangles} triangles`);
    for (const c of needed) {
      const clip = b.clips[c];
      assert.ok(clip, `${name}: clip ${c}`);
      assert.ok(clip.row + clip.frames <= b.bones.image.height);
      if (clip.beats) assert.equal(clip.frames, clip.beats * 15, 'beat clips: 30 fps at 120 BPM');
    }
    const reg = g.attributes.fvRegion.array;
    assert.ok(reg.every((r) => r < G.REGION_COUNT));
    const j = g.attributes.fvJoint.array; const w = g.attributes.fvWeight.array;
    for (let i = 0; i < n; i++) {
      const sum = w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3];
      assert.ok(Math.abs(sum - 255) <= 2, 'weights sum to 1');
      for (let c = 0; c < 4; c++) assert.ok(j[i * 4 + c] < asset.header.bones);
    }
    assert.equal(b.bones.image.width, asset.header.bones * 3);
    assert.ok(b.height > 1.7 && b.height < 1.95);
  }
  for (const name of ['maleLo', 'femaleLo']) {
    const lo = asset.bodies[name];
    assert.ok(lo && lo.triangles < 4000, `${name} low detail`);
    assert.equal(lo.bones, asset.bodies[name.replace('Lo', '')].bones, 'shares the bone texture');
  }
  // Region sets: dresses only on the female body, shirt and tie only on the male.
  const has = (name, r) => asset.bodies[name].geometry.attributes.fvRegion.array.includes(r);
  assert.ok(has('female', R.skirtShort) && has('female', R.bun) && has('female', R.hairLong));
  assert.ok(!has('male', R.skirtShort) && has('male', R.shirt) && has('male', R.tie));
});

test('DJ: dark outfit per look, mostly mixing with a hand up or on the headphones', () => {
  const man = G.dressDj(1, 4); const woman = G.dressDj(2, 4);
  assert.equal(man.body, 'male'); assert.equal(woman.body, 'female');
  assert.equal(man.height, G.DJ_HEIGHT.male); assert.equal(woman.height, G.DJ_HEIGHT.female);
  for (const d of [man, woman]) {
    assert.equal(d.palette.length, G.REGION_COUNT);
    assert.equal(d.palette[R.top][0], 0x121215, 'black top');
    assert.ok(visible(d.palette, R.skin) && visible(d.palette, R.shoes));
    assert.equal(d.turn, 0, 'stays facing the audience');
  }
  assert.equal(visible(woman.palette, R.bottom) + visible(woman.palette, R.skirtShort), 1, 'one skirt length');
  assert.ok(visible(man.palette, R.bottom) && !visible(man.palette, R.hem), 'jeans, no jacket');
  // Schedule: 4-beat slots, deterministic, starts mixing, specials never back to back.
  const slots = Array.from({ length: 400 }, (_, k) => G.djClipAt(k * 4 + 1.5, 7));
  assert.deepEqual(slots, Array.from({ length: 400 }, (_, k) => G.djClipAt(k * 4 + 0.2, 7)), 'same clip for the whole slot');
  assert.equal(slots[0], 'djMix');
  assert.ok(slots.every((c) => G.DJ_CLIPS.includes(c)));
  const mix = slots.filter((c) => c === 'djMix').length / slots.length;
  assert.ok(mix > 0.6 && mix < 0.9, `mostly mixing (${mix})`);
  assert.ok(slots.includes('djHand') && slots.includes('djHeadphone'));
  for (let k = 1; k < slots.length; k++) assert.ok(slots[k] === 'djMix' || slots[k - 1] === 'djMix', `slot ${k}`);
  assert.notDeepEqual(slots, Array.from({ length: 400 }, (_, k) => G.djClipAt(k * 4 + 1, 8)), 'seed changes the routine');
});

test('DJ: baked clips on both bodies, beat-locked, loop back onto the mixing pose', () => {
  const buf = fs.readFileSync(new URL('../public/models/guests.bin', import.meta.url));
  const asset = parseGuests(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  for (const name of ['male', 'female']) {
    const { clips, bones } = asset.bodies[name];
    for (const c of G.DJ_CLIPS) {
      assert.ok(clips[c], `${name}: ${c}`);
      assert.ok(clips[c].beats > 0 && clips[c].row + clips[c].frames <= bones.image.height);
    }
    // A hand up / headphone slot starts and ends on the mixing pose (no pop when switching).
    const row = (r) => Array.from(new Uint16Array(bones.image.data.buffer, bones.image.data.byteOffset + r * bones.image.width * 8, bones.image.width * 4));
    const mix0 = row(clips.djMix.row);
    for (const c of ['djHand', 'djHeadphone']) assert.deepEqual(row(clips[c].row), mix0, `${name}: ${c} starts like djMix`);
  }
});

test('DJ figure: silhouette until the animated mannequin is there, behind the booth', async () => {
  const THREE = await import('three');
  const { djFigure, DJ_BEHIND } = await import('../public/js/dj3d.js');
  const root = new THREE.Group();
  const animated = [];
  const dj = djFigure(root, { x: 0, z: -(0.35 + DJ_BEHIND), heading: 0, look: 1, desk: 1.1 }, animated, { quality: 'high', bpm: 124 });
  assert.equal(animated.length, 1);
  animated[0](1, {});
  const box = new THREE.Box3().setFromObject(root);
  assert.ok(box.max.y > 1.6 && box.max.y < 1.9, `height ${box.max.y}`);
  assert.ok(box.min.z < -0.6 && box.max.z > -0.15 && box.max.z < 0.1, `hands reach the controller (${box.min.z}..${box.max.z})`);
  dj.dispose();
  assert.equal(root.children.length, 0);
});

test('PBR sets: own repeat per material, stand-ins without the browser', () => {
  const a = pbrSet('parquet', 13, 10);
  const b = pbrSet('parquet', 2, 2);
  assert.ok(a.map && a.normalMap && a.roughnessMap);
  assert.equal(a.map.repeat.x, 13);
  assert.equal(b.map.repeat.x, 2);
  assert.equal(a.map.source, b.map.source, 'one image for all floors');
  assert.equal(a.map.colorSpace, 'srgb');
  assert.notEqual(a.normalMap.colorSpace, 'srgb');
  for (const name of ['plaster', 'velvet', 'metal', 'carpet', 'linen', 'dancefloor', 'wainscot']) {
    const s = pbrSet(name, 1, 1);
    assert.ok(s.normalMap, `${name} has a normal map`);
    assert.ok(PBR_TILE[name] > 0);
  }
  for (const name of ['parquet', 'plaster', 'velvet', 'metal', 'carpet', 'linen']) {
    for (const k of ['albedo', 'normal', 'rough']) assert.ok(fs.existsSync(new URL(`../public/textures/${name}_${k}.jpg`, import.meta.url)), `${name}_${k}.jpg`);
  }
});
