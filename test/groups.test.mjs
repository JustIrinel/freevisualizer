import test from 'node:test';
import assert from 'node:assert/strict';
import { expandToGroups, exactGroup, splitLocked, makeGroup, ungroup, pruneGroups, groupMembers, nextGroupName } from '../public/js/groups.js';

const project = () => ({
  groups: [],
  fixtures: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3', locked: true }],
  props: [{ id: 'p1' }, { id: 'p2', locked: true }],
});

test('makeGroup / expandToGroups / exactGroup', () => {
  const p = project();
  const g = makeGroup(p, ['f1', 'p1', 'p2'], null, 'g1');
  assert.equal(g.name, 'Grup 1');
  assert.deepEqual(groupMembers(p, 'g1'), ['f1', 'p1', 'p2']);
  assert.deepEqual(expandToGroups(p, ['p1']), ['f1', 'p1', 'p2']);
  assert.deepEqual(expandToGroups(p, ['f2', 'p2']), ['f2', 'f1', 'p1', 'p2']);
  assert.equal(exactGroup(p, ['p2', 'f1', 'p1']).id, 'g1');
  assert.equal(exactGroup(p, ['f1', 'p1']), null);
  assert.equal(nextGroupName(p), 'Grup 2');
  assert.equal(makeGroup(p, ['f2'], null, 'g9'), null, 'one item is not a group');
});

test('regrouping prunes the old group and ungroup clears ids', () => {
  const p = project();
  makeGroup(p, ['f1', 'f2'], 'A', 'g1');
  makeGroup(p, ['f2', 'f3'], 'B', 'g2');
  // g1 is left with only f1, so it disappears
  assert.deepEqual(p.groups.map((g) => g.id), ['g2']);
  assert.equal(p.fixtures[0].groupId, undefined);
  assert.equal(ungroup(p, ['f3']), 1);
  assert.deepEqual(p.groups, []);
  assert.ok(p.fixtures.every((f) => !f.groupId));
  p.fixtures[0].groupId = 'ghost';
  pruneGroups(p);
  assert.equal(p.fixtures[0].groupId, undefined);
});

test('splitLocked', () => {
  assert.deepEqual(splitLocked(project(), ['f1', 'f3', 'p2', 'p1']), { free: ['f1', 'p1'], locked: ['f3', 'p2'] });
});
