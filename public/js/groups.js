// Groups and locks on the project data (pure, no DOM – tested in test/groups.test.mjs).
//   project.groups = [{ id, name }]; fixtures and props carry `groupId` and `locked`.
import { tr } from './i18n.js';

const items = (project) => [...project.fixtures, ...project.props];

export function findGroup(project, groupId) {
  return groupId ? (project.groups || []).find((g) => g.id === groupId) || null : null;
}

/** Ids of every fixture and prop in a group. */
export function groupMembers(project, groupId) {
  return groupId ? items(project).filter((it) => it.groupId === groupId).map((it) => it.id) : [];
}

/** Add the other members of every group touched by `ids` (order kept, no duplicates). */
export function expandToGroups(project, ids) {
  const byId = new Map(items(project).map((it) => [it.id, it]));
  const out = [];
  const seen = new Set();
  const push = (id) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  for (const id of ids) {
    const it = byId.get(id);
    if (!it) continue;
    if (it.groupId && findGroup(project, it.groupId)) groupMembers(project, it.groupId).forEach(push);
    else push(id);
  }
  return out;
}

/** The group the ids make up exactly (all members, nothing else), or null. */
export function exactGroup(project, ids) {
  if (!ids.length) return null;
  const first = items(project).find((it) => it.id === ids[0]);
  const g = first && findGroup(project, first.groupId);
  if (!g) return null;
  const members = groupMembers(project, g.id);
  return members.length === ids.length && members.every((id) => ids.includes(id)) ? g : null;
}

export function lockedIds(project) {
  return new Set(items(project).filter((it) => it.locked).map((it) => it.id));
}

/** Split ids into the ones that may move and the locked ones. */
export function splitLocked(project, ids) {
  const locked = lockedIds(project);
  return { free: ids.filter((id) => !locked.has(id)), locked: ids.filter((id) => locked.has(id)) };
}

export function nextGroupName(project) {
  const names = new Set((project.groups || []).map((g) => g.name));
  for (let n = 1; ; n++) {
    const name = tr('Grup {n}', { n });
    if (!names.has(name)) return name;
  }
}

/** Remove groups with fewer than 2 members and clear dangling groupIds. */
export function pruneGroups(project) {
  project.groups = (project.groups || []).filter((g) => groupMembers(project, g.id).length >= 2);
  const valid = new Set(project.groups.map((g) => g.id));
  for (const it of items(project)) if (it.groupId && !valid.has(it.groupId)) delete it.groupId;
}

/** Put `ids` in a new group (they leave their old groups). Returns the group or null. */
export function makeGroup(project, ids, name, id) {
  const members = items(project).filter((it) => ids.includes(it.id));
  if (members.length < 2) return null;
  const group = { id, name: name || nextGroupName(project) };
  project.groups = [...(project.groups || []), group];
  for (const it of members) it.groupId = group.id;
  pruneGroups(project);
  return group;
}

/** Take every group touched by `ids` apart. Returns how many groups were removed. */
export function ungroup(project, ids) {
  const touched = new Set(items(project).filter((it) => ids.includes(it.id) && it.groupId).map((it) => it.groupId));
  for (const it of items(project)) if (touched.has(it.groupId)) delete it.groupId;
  project.groups = (project.groups || []).filter((g) => !touched.has(g.id));
  return touched.size;
}
