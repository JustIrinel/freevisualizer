// Assistant scene tools (get_scene, set_room, add/update/remove_props, totem placement)
// on a fake app, and the server side of photos (validation, prompt caching).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runTool, placementFor } from '../public/js/assistant.js';
import { weddingProject } from '../public/js/project.js';
import { BUILTIN_PROFILES } from '../public/js/profiles.js';
import { PROP_TYPES } from '../public/js/props3d.js';

const require = createRequire(import.meta.url);
const server = require('../server/assistant.js');

/** Just enough of App (main.js) for the tools: same lock / batch rules. */
function fakeApp() {
  const project = weddingProject();
  const builtins = BUILTIN_PROFILES;
  const byId = Object.fromEntries([...builtins, ...project.profiles].map((p) => [p.id, p]));
  const log = { checkpoints: 0, added: [], removed: [], rebuilt: [], room: [] };
  const app = {
    project, builtins, profilesById: byId, propTypes: PROP_TYPES, log,
    profile: (id) => byId[id] || builtins[0],
    vis: { addProp: (p) => log.added.push(p.id), removeObject: (id) => log.removed.push(id), updateTransform() {}, refreshLabel() {}, setSelection() {} },
    checkpoint() { log.checkpoints++; },
    saveSoon() {},
    findItem: (id) => project.fixtures.find((f) => f.id === id) || project.props.find((p) => p.id === id),
    isLocked: (id) => !!app.findItem(id)?.locked,
    updateItems(ids, patchFor, { rebuild = false } = {}) {
      app.checkpoint();
      for (const id of ids) {
        const it = app.findItem(id);
        if (!it) continue;
        Object.assign(it, patchFor(it));
        if (rebuild) log.rebuilt.push(id);
      }
    },
    removeItems(ids) {
      const gone = new Set(ids.filter((id) => !app.isLocked(id)));
      app.checkpoint();
      project.props = project.props.filter((p) => !gone.has(p.id));
      project.fixtures = project.fixtures.filter((f) => !gone.has(f.id));
      for (const id of gone) log.removed.push(id);
    },
    updateRoom(patch) { app.checkpoint(); Object.assign(project.room, patch); log.room.push(patch); },
  };
  return app;
}

test('get_scene: room, props with lock / group, fixtures and the profiles in use', async () => {
  const app = fakeApp();
  app.project.props[0].locked = true;
  const scene = await runTool(app, 'get_scene', {});
  assert.equal(scene.room.style, 'banquet');
  assert.equal(scene.room.back_wall_z, -app.project.room.depth / 2);
  assert.equal(scene.props.length, app.project.props.length);
  assert.equal(scene.props[0].locked, true);
  assert.equal(scene.fixtures.length, app.project.fixtures.length);
  assert.ok(scene.profiles.length > 0 && scene.profiles.every((p) => p.profile_id && p.kind));
  assert.ok(scene.profiles.some((p) => p.in_use > 0));
  // Older conversations still call get_rig.
  assert.deepEqual(Object.keys(await runTool(app, 'get_rig', {})), Object.keys(scene));
});

test('set_room: only valid fields change, sizes are clamped', async () => {
  const app = fakeApp();
  const out = await runTool(app, 'set_room', { style: 'dark', width: 500, height: 4.2, floor_finish: 'gloss', wall_color: 'red' });
  assert.deepEqual(app.log.room[0], { style: 'dark', width: 200, height: 4.2, floorFinish: 'gloss' });
  assert.equal(out.room.floor_finish, 'gloss');
  await assert.rejects(runTool(app, 'set_room', { style: 'castle' }));
  await assert.rejects(runTool(app, 'set_room', {}));
});

test('add_props: new types with clamped params, defaults kept, unknown types refused', async () => {
  const app = fakeApp();
  const before = app.project.props.length;
  const out = await runTool(app, 'add_props', {
    props: [
      { type: 'totem', position: { x: -3, y: 0, z: -4 }, params: { height: 9, cover: 2, wheels: 1 } },
      { type: 'speakerstand', name: 'Boxă stânga', position: { x: -2, y: -1, z: -5 }, rotation: { x: 0, y: 15, z: 0 }, params: { height: 1.9, size: 15 } },
      { type: 'booth', position: { x: 0, y: 0, z: -6 }, params: { dj: 1, djLook: 2 } },
      { type: 'speakerstand', position: { x: 2, y: 0, z: -5 }, params: { size: 11 } },
    ],
  });
  assert.equal(out.added.length, 4);
  assert.equal(app.project.props.length, before + 4);
  assert.deepEqual(app.log.added, out.added.map((a) => a.id));
  const [totem, stand, booth, stand2] = out.added.map((a) => app.project.props.find((p) => p.id === a.id));
  assert.deepEqual(totem.params, { height: 3.5, plate: 0.5, cover: 2 });
  assert.equal(stand.name, 'Boxă stânga');
  assert.equal(stand.position.y, 0, 'never under the floor');
  assert.deepEqual(stand.rotation, { x: 0, y: 15, z: 0 });
  assert.equal(stand.params.size, 15);
  assert.equal(booth.params.djLook, 2);
  assert.equal(stand2.params.size, 12, 'a size that is not a choice keeps the default');
  assert.deepEqual(out.ignored_params.sort(), ['size', 'wheels']);
  assert.ok(totem.id.startsWith('pr'));
  await assert.rejects(runTool(app, 'add_props', { props: [{ type: 'spaceship', position: { x: 0, y: 0, z: 0 } }] }), /Unknown prop type/);
});

test('update_props / remove_props: locked objects are skipped, params rebuild the prop', async () => {
  const app = fakeApp();
  const [a, b] = app.project.props;
  b.locked = true;
  const up = await runTool(app, 'update_props', { props: [
    { id: a.id, position: { x: 1, y: 0, z: 2 }, params: { width: 3 } },
    { id: b.id, position: { x: 9, y: 0, z: 9 } },
    { id: 'nope', name: 'x' },
  ] });
  assert.equal(up.updated, 1);
  assert.deepEqual(up.locked_not_changed, [b.id]);
  assert.deepEqual(up.not_found, ['nope']);
  assert.deepEqual(a.position, { x: 1, y: 0, z: 2 });
  if ('width' in (PROP_TYPES[a.type].params || {})) assert.deepEqual(app.log.rebuilt, [a.id]);
  assert.notDeepEqual(b.position, { x: 9, y: 0, z: 9 });
  const rm = await runTool(app, 'remove_props', { ids: [a.id, b.id, 'ghost'] });
  assert.equal(rm.removed, 1);
  assert.deepEqual(rm.locked_not_removed, [b.id]);
  assert.ok(!app.project.props.some((p) => p.id === a.id));
  await assert.rejects(runTool(app, 'remove_props', { ids: [b.id] }), /locked/);
});

test('add_fixtures surface "totem": on the top plates, left to right', async () => {
  const app = fakeApp();
  assert.throws(() => placementFor(app, 1, { surface: 'totem', truss_id: null, position: null, spacing: null }), /totem/);
  await runTool(app, 'add_props', { props: [
    { type: 'totem', position: { x: 3, y: 0, z: -4 }, params: { height: 2.2 } },
    { type: 'totem', position: { x: -3, y: 0, z: -4 }, params: { height: 2.2 } },
  ] });
  const spots = placementFor(app, 4, { surface: 'totem', truss_id: null, position: null, spacing: null });
  assert.equal(spots.length, 4);
  assert.ok(spots.every((s) => s.position.y === 2.2 && s.rotation.x === 0));
  assert.ok(spots[0].position.x < -2 && spots[1].position.x < -2 && spots[3].position.x > 2);
  assert.ok(spots.every((s) => Math.abs(Math.abs(s.position.x) - 3) <= 0.13), 'stays on the plate');
});

const jpeg = (n = 100) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A'.repeat(n) } });

test('server: photos are validated (type, size)', () => {
  const ok = [{ role: 'user', content: [jpeg(), { type: 'text', text: 'refă sala' }] }];
  server.validateImages(ok, 'ro');
  const gif = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/gif', data: 'AAAA' } }] }];
  assert.throws(() => server.validateImages(gif, 'ro'), (e) => e.status === 400 && /JPEG/.test(e.message));
  const url = [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.jpg' } }] }];
  assert.throws(() => server.validateImages(url, 'en'), /JPEG, PNG or WebP/);
  const big = [{ role: 'user', content: [jpeg(5 * 1024 * 1024 + 1)] }];
  assert.throws(() => server.validateImages(big, 'ro'), /5 MB/);
});

test('server: the last photo is cached, the page messages are not changed, strict budget respected', () => {
  const messages = [
    { role: 'user', content: [jpeg(), { type: 'text', text: 'prima' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: [jpeg(), jpeg(), { type: 'text', text: 'a doua' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_scene', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
  ];
  const copy = JSON.parse(JSON.stringify(messages));
  const params = server.buildParams('claude-opus-5-5', messages);
  assert.deepEqual(messages, copy, 'the history from the page stays as it was');
  const marks = [];
  params.messages.forEach((m, i) => Array.isArray(m.content) && m.content.forEach((b, j) => { if (b.cache_control) marks.push([i, j]); }));
  assert.deepEqual(marks, [[2, 1]]);
  assert.equal(params.system[0].cache_control.type, 'ephemeral');
  assert.equal(params.model, 'claude-opus-5-5');
  // Strict schemas share 16 union parameters and 24 optional ones per request.
  let unions = 0; let optional = 0;
  const walk = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.anyOf) { unions++; s.anyOf.forEach(walk); return; }
    if (s.type === 'object' && s.properties) {
      optional += Object.keys(s.properties).filter((k) => !(s.required || []).includes(k)).length;
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  const strict = params.tools.filter((t) => t.strict);
  strict.forEach((t) => walk(t.input_schema));
  assert.ok(strict.length <= 20);
  assert.ok(unions <= 16, `${unions} union parameters in strict tools`);
  assert.ok(optional <= 24, `${optional} optional parameters in strict tools`);
  for (const name of ['get_scene', 'set_room', 'add_props', 'update_props', 'remove_props']) {
    assert.ok(params.tools.some((t) => t.name === name && t.strict === false), name);
  }
  assert.ok(params.tools.every((t) => !('strict' in t) || typeof t.strict === 'boolean'));
  assert.deepEqual([...server.PROP_TYPE_IDS].sort(), Object.keys(PROP_TYPES).sort(), 'the tool enum lists every prop type');
});
