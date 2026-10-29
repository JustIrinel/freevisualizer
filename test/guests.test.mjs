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
