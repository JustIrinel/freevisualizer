import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../public/js/project.js';

test('old or hand-edited projects load with sane values', () => {
  const p = normalizeProject({
    name: 'Vechi',
    room: { width: 20, depth: 16, height: 5 }, // before room styles
    fixtures: [
      { id: 'a', name: 'Spot', profileId: 'gen-mh-spot-11', position: { x: 2 }, rotation: null, universe: '2', address: 0 },
      { name: 'Fara id', profileId: 'gen-par-rgb-3', address: 600 },
      null,
    ],
    props: [{ type: 'truss', position: { x: 1, y: '3.5' } }, { name: 'fara tip' }],
  });
  assert.equal(p.fixtures.length, 2);
  assert.deepEqual(p.fixtures[0].position, { x: 2, y: 0, z: 0 });
  assert.deepEqual(p.fixtures[0].rotation, { x: 0, y: 0, z: 0 });
  assert.equal(p.fixtures[0].universe, 2);
  assert.equal(p.fixtures[0].address, 1);
  assert.equal(p.fixtures[1].address, 512);
  assert.ok(p.fixtures[1].id);
  assert.equal(p.props.length, 1);
  assert.deepEqual(p.props[0].position, { x: 1, y: 3.5, z: 0 });
  assert.equal(p.room.style, 'dark');
  assert.deepEqual(p.groups, []);
});
