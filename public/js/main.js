// FreeVisualizer – app core: project state, scene sync, render loop, shortcuts.
import { Visualizer } from './scene3d.js';
import { DmxStore } from './dmx.js';
import { computeState, createRuntime } from './fixture-state.js';
import { renderDemo } from './demo.js';
import { BUILTIN_PROFILES, normalizeProfile, uid, cloneProfile } from './profiles.js';
import {
  demoProject, weddingProject, emptyProject, normalizeProject, autosave, AUTOSAVE_KEY, loadAutosave, saveServerProject, downloadJson, findConflicts, nextName, nextFreeAddress,
} from './project.js';
import { PROP_TYPES } from './props3d.js';
import { caseTop } from './prop-layout.js';
import { toast, pickFile } from './dom.js';
import * as ui from './ui.js';
import * as dialogs from './dialogs.js';
import { AssistantPanel } from './assistant.js';
import { DmxMonitor } from './dmx-monitor.js';
import { ClipRecorder } from './recorder.js';
import { aimRotation } from './aim.js';
import { translatePage, tr, tp } from './i18n.js';
import { expandToGroups, splitLocked, lockedIds, makeGroup, ungroup as ungroupItems, findGroup, groupMembers, pruneGroups } from './groups.js';

const round2 = (v) => Math.round(v * 100) / 100;
const wrapDeg = (d) => { let v = ((d + 180) % 360 + 360) % 360 - 180; if (v === -180) v = 180; return Math.round(v * 10) / 10; };

const MISSING_PROFILE = normalizeProfile({ id: '__missing', name: tr('Profil lipsă'), kind: 'par', channels: [{ type: 'dimmer' }] });

class App {
  constructor() {
    this.dmx = new DmxStore();
    this.vis = new Visualizer(document.getElementById('viewport'));
    this.runtimes = new Map();
    this.states = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedIds = [];
    this.builtins = BUILTIN_PROFILES.map(normalizeProfile);
    this._profileCache = null;
    this.startedAt = performance.now();
    this.time = 0;
    this.demoBpm = 126;
    this.recorder = new ClipRecorder(this);
    this.assistant = new AssistantPanel(this);

    // A click selects the whole group; Alt+click or double-click selects one object.
    this.vis.onPick = (id, { toggle, single }) => {
      const ids = id ? (single ? [id] : expandToGroups(this.project, [id])) : [];
      if (toggle) {
        if (!ids.length) return;
        const on = ids.every((x) => this.selectedIds.includes(x));
        this.setSelection(on ? this.selectedIds.filter((x) => !ids.includes(x)) : [...this.selectedIds, ...ids]);
      } else this.setSelection(ids);
    };
    this.vis.onMarquee = (ids, { add }) => this.setSelection(expandToGroups(this.project, add ? [...this.selectedIds, ...ids] : ids));
    // Hover: the object (or its whole group), whether it is locked, and a short label.
    this.vis.hoverInfo = (id) => this.hoverInfo(id);
    this.vis.onTransformStart = () => this.checkpoint();
    this.vis.onTransform = (changes) => {
      for (const t of changes) {
        const item = this.findItem(t.id);
        if (!item || item.locked) continue;
        item.position = t.position;
        item.rotation = t.rotation;
      }
      ui.updateInspectorTransform(this);
    };
    this.vis.onTransformEnd = () => this.saveSoon();
    this.vis.onGizmoInfo = (text) => ui.showGizmoInfo(text);

    // Presentation window (desktop app, 2nd monitor): no panels, follows the main window's project.
    this.presentMode = new URLSearchParams(location.search).has('present');
    if (this.presentMode) document.body.classList.add('ui-hidden', 'present');

    const restored = loadAutosave();
    this.loadProject(restored || weddingProject(), { keepHistory: false });
    if (!restored && !this.presentMode) toast(tr('Bine ai venit! Am încărcat un rig demo – apasă ▶ Demo ca să-l vezi în acțiune.'), 'info', 6000);
    if (this.presentMode) {
      window.addEventListener('storage', (e) => {
        if (e.key !== AUTOSAVE_KEY || !e.newValue) return;
        const camera = this.vis.getCamera();
        try { this.loadProject({ ...JSON.parse(e.newValue), camera }, { keepHistory: false }); } catch (_) { /* ignore */ }
      });
      window.addEventListener('storage', (e) => { if (e.key === 'freevis.demo') this.toggleDemo(e.newValue === '1'); });
      try { if (localStorage.getItem('freevis.demo') === '1') this.dmx.useDemo = true; } catch (_) { /* ignore */ }
    }

    this.dmx.connect();
    this.monitor = new DmxMonitor(this);
    ui.bindStatic(this);
    this._bindKeys();
    requestAnimationFrame((t) => this._loop(t));
    setInterval(() => ui.updateStatus(this), 250);
  }

  // ------------------------------------------------------------------ profiles
  get profilesById() {
    if (!this._profileCache) {
      const map = {};
      for (const p of this.builtins) map[p.id] = p;
      for (const p of this.project.profiles) map[p.id] = p;
      this._profileCache = map;
    }
    return this._profileCache;
  }

  profile(id) {
    return this.profilesById[id] || MISSING_PROFILE;
  }

  allProfiles() {
    return [...this.project.profiles, ...this.builtins];
  }

  /** Add or replace a profile stored in the project, then rebuild fixtures using it. */
  saveProfile(profile) {
    this.checkpoint();
    const p = normalizeProfile(cloneProfile(profile));
    if (p.source === 'builtin') { p.source = 'custom'; p.id = uid('prof'); }
    const idx = this.project.profiles.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.project.profiles[idx] = p; else this.project.profiles.push(p);
    this._profileCache = null;
    for (const f of this.project.fixtures) if (f.profileId === p.id) this._addFixtureToScene(f);
    this.saveSoon();
    ui.renderAll(this);
    return p;
  }

  deleteProfile(id) {
    const used = this.project.fixtures.filter((f) => f.profileId === id).length;
    if (used) { toast(tp(used, 'Profilul este folosit de o fixtură. Șterge-o sau schimbă-i profilul întâi.', 'Profilul este folosit de {n} fixturi. Șterge-le sau schimbă-le profilul întâi.'), 'error'); return false; }
    this.checkpoint();
    this.project.profiles = this.project.profiles.filter((p) => p.id !== id);
    this._profileCache = null;
    this.saveSoon();
    ui.renderAll(this);
    return true;
  }

  // ------------------------------------------------------------------ project
  loadProject(p, { keepHistory = true } = {}) {
    if (!keepHistory) { this.undoStack = []; this.redoStack = []; }
    this.project = normalizeProject(p);
    this.project.profiles = this.project.profiles.map(normalizeProfile);
    this._profileCache = null;
    this._applySettings();
    this.vis.buildRoom(this.project.room);
    this._rebuildScene();
    if (this.project.camera) this.vis.setCamera(this.project.camera);
    else this.vis.setView('perspective');
    this.select(null);
    ui.renderAll(this);
  }

  _applySettings() {
    const s = this.project.settings;
    Object.assign(this.vis.settings, {
      haze: s.haze, bloom: s.bloom, ambient: s.ambient, houseLight: s.houseLight, workLights: !!s.workLights, lightPower: s.lightPower, showLabels: s.showLabels,
      quality: s.quality, showFps: !!s.showFps,
    });
    this.vis.applySettings();
    if (this.dmx.artnetOffset !== s.artnetOffset) this.dmx.setArtnetOffset(s.artnetOffset);
  }

  setSetting(key, value) {
    this.project.settings[key] = value;
    this._applySettings();
    this.saveSoon();
  }

  _rebuildScene() {
    this.vis.clear();
    this.runtimes.clear();
    for (const f of this.project.fixtures) this._addFixtureToScene(f);
    for (const pr of this.project.props) this.vis.addProp(pr);
  }

  _addFixtureToScene(f) {
    this.vis.addFixture(f, this.profile(f.profileId));
    this.runtimes.set(f.id, createRuntime());
  }

  findItem(id) {
    return this.project.fixtures.find((f) => f.id === id) || this.project.props.find((p) => p.id === id) || null;
  }

  isFixture(id) {
    return this.project.fixtures.some((f) => f.id === id);
  }

  conflicts() {
    return findConflicts(this.project, this.profilesById);
  }

  // ------------------------------------------------------------------ history
  _snapshot() {
    const { camera, ...rest } = this.project;
    return JSON.stringify(rest);
  }

  /** Group many edits (e.g. one assistant message) into a single undo step. */
  beginBatch() {
    this.checkpoint();
    this._batching = true;
  }

  endBatch() {
    this._batching = false;
  }

  checkpoint() {
    if (this._batching) return;
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  _restore(json) {
    const camera = this.vis.getCamera();
    const sel = this.selectedIds;
    this.project = normalizeProject({ ...JSON.parse(json), camera });
    this._profileCache = null;
    this._applySettings();
    this.vis.buildRoom(this.project.room);
    this._rebuildScene();
    this.setSelection(sel);
    ui.renderAll(this);
    this.saveSoon();
  }

  undo() {
    if (!this.undoStack.length) { toast(tr('Nimic de anulat')); return; }
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) { toast(tr('Nimic de refăcut')); return; }
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
  }

  saveSoon() {
    if (this.presentMode) return; // the presentation window only mirrors
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.project.camera = this.vis.getCamera();
      autosave(this.project);
    }, 400);
  }

  async saveToServer() {
    this.project.camera = this.vis.getCamera();
    try {
      await saveServerProject(this.project);
      autosave(this.project);
      toast(tr('Proiect salvat: „{name}”', { name: this.project.name }));
    } catch (err) {
      toast(tr('Nu am putut salva pe server ({err}). Folosește Export.', { err: err.message }), 'error');
    }
  }

  exportProject() {
    this.project.camera = this.vis.getCamera();
    const name = (this.project.name || 'proiect').replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'proiect';
    downloadJson(this.project, `${name}.freevis.json`);
  }

  async importProject() {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.fixtures)) throw new Error(tr('fișierul nu este un proiect FreeVisualizer'));
      this.checkpoint();
      this.loadProject(data);
      toast(tr('Proiect importat: „{name}”', { name: this.project.name }));
    } catch (err) {
      toast(tr('Import eșuat: {err}', { err: err.message }), 'error');
    }
  }

  /** @param template 'wedding' | 'club' | 'empty' */
  newProject(template) {
    this.checkpoint();
    const make = { wedding: weddingProject, club: demoProject }[template] || emptyProject;
    this.loadProject(make());
  }

  // ------------------------------------------------------------------ selection
  /** The last selected object (shown in the inspector when only one is selected). */
  get selectedId() {
    return this.selectedIds[this.selectedIds.length - 1] || null;
  }

  setSelection(ids) {
    const seen = new Set();
    this.selectedIds = (ids || []).filter((id) => id && !seen.has(id) && seen.add(id) && this.findItem(id));
    this.vis.setLocked(lockedIds(this.project));
    this.vis.setSelection(this.selectedIds);
    ui.renderSelection(this);
  }

  select(id) {
    this.setSelection(id ? [id] : []);
  }

  toggleSelect(id) {
    if (this.selectedIds.includes(id)) this.setSelection(this.selectedIds.filter((x) => x !== id));
    else this.setSelection([...this.selectedIds, id]);
  }

  /** Shift+click in a list: everything between the last selected item and `id`. */
  selectRange(id, orderedIds) {
    const anchor = this.selectedId;
    const a = orderedIds.indexOf(anchor);
    const b = orderedIds.indexOf(id);
    if (a < 0 || b < 0) { this.select(id); return; }
    const range = orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1);
    this.setSelection([...this.selectedIds.filter((x) => !range.includes(x)), ...(a <= b ? range : range.reverse())]);
  }

  selectAll() {
    this.setSelection(this.project.fixtures.map((f) => f.id));
  }

  selectedItems() {
    return this.selectedIds.map((id) => this.findItem(id)).filter(Boolean);
  }

  selectedFixtures() {
    return this.selectedIds.filter((id) => this.isFixture(id)).map((id) => this.findItem(id));
  }

  // ------------------------------------------------------------------ edits
  addFixtures(list) {
    this.checkpoint();
    for (const f of list) {
      this.project.fixtures.push(f);
      this._addFixtureToScene(f);
    }
    this.saveSoon();
    ui.renderAll(this);
    if (list.length) this.setSelection(list.map((f) => f.id));
  }

  updateItem(id, patch, opts = {}) {
    this.updateItems([id], () => patch, opts);
  }

  /** Apply `patchFor(item, index)` to several items with one undo step. */
  updateItems(ids, patchFor, { rebuild = false, record = true, quiet = false } = {}) {
    const items = ids.map((id) => this.findItem(id)).filter(Boolean);
    if (!items.length) return;
    // Everything locked and only moves asked: nothing changes, no undo step.
    if (record && !items.some((it) => !it.locked)) {
      const probe = items.map((it, i) => patchFor(it, i)).filter(Boolean);
      if (probe.length && probe.every((p) => Object.keys(p).every((k) => k === 'position' || k === 'rotation'))) {
        this.lockedNotice(items.length);
        return;
      }
    }
    if (record) this.checkpoint();
    let blocked = 0;
    items.forEach((item, i) => {
      let patch = patchFor(item, i);
      if (!patch) return;
      // Locked objects keep their place: drop position / rotation changes.
      if (item.locked && (patch.position || patch.rotation)) {
        const { position, rotation, ...rest } = patch;
        blocked++;
        patch = rest;
        if (!Object.keys(patch).length) return;
      }
      Object.assign(item, patch);
      const fixture = this.isFixture(item.id);
      if (rebuild) {
        if (fixture) this._addFixtureToScene(item);
        else this.vis.addProp(item);
      } else {
        this.vis.updateTransform(item);
        if (fixture) this.vis.refreshLabel(item.id);
      }
    });
    this.vis.setSelection(this.selectedIds);
    this.saveSoon();
    if (!quiet) ui.renderLists(this);
    ui.updateInspectorTransform(this);
    if (blocked) this.lockedNotice(blocked);
  }

  lockedNotice(n) {
    const now = performance.now();
    if (now - (this._lockToastAt || 0) < 1500) return;
    this._lockToastAt = now;
    toast(tp(n, '🔒 Un obiect blocat nu a fost mutat. Deblochează-l cu K sau din inspector.', '🔒 {n} obiecte blocate nu au fost mutate. Deblochează-le cu K sau din inspector.'));
  }

  // ------------------------------------------------------------------ lock & groups
  isLocked(id) {
    return !!this.findItem(id)?.locked;
  }

  /** Lock or unlock; with no value: unlock if all are locked, else lock all. */
  setLocked(ids, value) {
    const items = ids.map((id) => this.findItem(id)).filter(Boolean);
    if (!items.length) return;
    const on = value ?? !items.every((it) => it.locked);
    this.checkpoint();
    for (const it of items) { if (on) it.locked = true; else delete it.locked; }
    this.vis.setLocked(lockedIds(this.project));
    this.vis.setSelection(this.selectedIds);
    this.saveSoon();
    ui.renderAll(this);
    toast(on ? tp(items.length, '🔒 Blocat: nu se mai poate muta din greșeală.', '🔒 {n} obiecte blocate: nu se mai pot muta din greșeală.')
      : tp(items.length, '🔓 Deblocat.', '🔓 {n} obiecte deblocate.'));
  }

  groupSelection(name) {
    if (this.selectedIds.length < 2) { toast(tr('Selectează cel puțin 2 obiecte ca să faci un grup.')); return null; }
    this.checkpoint();
    const g = makeGroup(this.project, this.selectedIds, name, uid('gr'));
    this.saveSoon();
    ui.renderAll(this);
    this.setSelection(groupMembers(this.project, g.id));
    toast(tr('Grupul „{name}” e gata. Click pe oricare obiect din el selectează tot grupul (Alt+click = doar obiectul).', { name: g.name }), 'info', 5000);
    return g;
  }

  ungroupSelection() {
    const n = ungroupItems(JSON.parse(JSON.stringify(this.project)), this.selectedIds);
    if (!n) { toast(tr('Selecția nu face parte dintr-un grup.')); return; }
    this.checkpoint();
    ungroupItems(this.project, this.selectedIds);
    this.saveSoon();
    ui.renderAll(this);
    ui.renderSelection(this);
    toast(tp(n, 'Grupul a fost desfăcut.', '{n} grupuri desfăcute.'));
  }

  selectGroup(groupId) {
    this.setSelection(groupMembers(this.project, groupId));
  }

  renameGroup(groupId, name) {
    const g = findGroup(this.project, groupId);
    if (!g || !name || g.name === name) return;
    this.checkpoint();
    g.name = name;
    this.saveSoon();
    ui.renderLists(this);
  }

  /** Move the selection so the middle of its positions lands on `axis = value`. */
  moveSelectionCenterTo(axis, value) {
    const items = this.selectedItems();
    if (!items.length) return;
    const vals = items.map((it) => it.position[axis]);
    const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
    this.moveSelection({ [axis]: value - mid });
  }

  hoverInfo(id) {
    const item = this.findItem(id);
    if (!item) return null;
    const g = findGroup(this.project, item.groupId);
    const ids = g ? groupMembers(this.project, g.id) : [id];
    const locked = ids.some((x) => this.isLocked(x));
    const label = `${locked ? '🔒 ' : ''}${g ? `${g.name} · ` : ''}${item.name}`;
    return { ids, locked, label };
  }

  /** Move relative to the view: 'left' | 'right' | 'toward' | 'away' | 'up' | 'down'. */
  nudge(dir, amount, opts = {}) {
    const { right, toward } = this.vis.cameraAxes();
    const d = { x: 0, y: 0, z: 0 };
    const add = (v, k) => { d.x += v.x * k; d.z += v.z * k; };
    if (dir === 'left') add(right, -amount);
    else if (dir === 'right') add(right, amount);
    else if (dir === 'toward') add(toward, amount);
    else if (dir === 'away') add(toward, -amount);
    else if (dir === 'up') d.y = amount;
    else if (dir === 'down') d.y = -amount;
    this.moveSelection(d, opts);
  }

  moveSelection(delta, opts = {}) {
    this.updateItems(this.selectedIds, (it) => ({
      position: {
        x: round2(it.position.x + (delta.x || 0)),
        y: round2(Math.max(0, it.position.y + (delta.y || 0))),
        z: round2(it.position.z + (delta.z || 0)),
      },
    }), opts);
  }

  rotateSelection(axis, deg, opts = {}) {
    this.updateItems(this.selectedIds, (it) => ({ rotation: { ...it.rotation, [axis]: wrapDeg(it.rotation[axis] + deg) } }), opts);
  }

  /**
   * Place fixtures one by one with the mouse (see Visualizer.startPlacement).
   * `list` = fixture objects without a final position yet.
   */
  placeFixtures(list) {
    if (!list.length) return;
    let i = 0;
    const next = () => toast(tr('Plasează {name} ({i} din {n}): click pe podea, truss, stativ, case, perete sau tavan (Alt = agățat sub bara stativului). Esc = gata.', { name: list[i].name, i: i + 1, n: list.length }), 'info', 60000);
    next();
    this.vis.startPlacement((at) => {
      const f = { ...list[i], position: at.position, rotation: at.rotation };
      this.addFixtures([f]);
      i++;
      if (i >= list.length) {
        this.vis.cancelPlacement(false);
        this.setSelection(list.map((x) => x.id));
        toast(tp(list.length, 'Am plasat o fixtură.', 'Am plasat {n} fixturi.'));
      } else {
        this.setSelection([]);
        next();
      }
    }, () => toast(i ? tr('Am plasat {i} din {n} fixturi.', { i, n: list.length }) : tr('Plasare anulată.')));
  }

  /** Point every selected fixture's beam at a world point. */
  aimSelectionAt(point) {
    const ids = this.selectedIds.filter((id) => this.isFixture(id));
    if (!ids.length) return;
    this.updateItems(ids, (it) => {
      const from = this.vis.emitterOrigin(it.id) || it.position;
      return { rotation: aimRotation(from, point) };
    });
    toast(ids.length > 1 ? tr('Am îndreptat {n} fixturi spre punctul ales.', { n: ids.length }) : tr('Fixtura bate acum spre punctul ales.'));
  }

  /** Same value on one axis for all selected (taken from the last selected). */
  alignSelection(axis) {
    const ref = this.findItem(this.selectedId);
    if (!ref) return;
    this.updateItems(this.selectedIds, (it) => ({ position: { ...it.position, [axis]: ref.position[axis] } }));
  }

  /** Even spacing along an axis between the two outermost selected items. */
  distributeSelection(axis) {
    const items = this.selectedItems().sort((a, b) => a.position[axis] - b.position[axis]);
    if (items.length < 3) { toast(tr('Selectează cel puțin 3 elemente pentru distribuire.')); return; }
    const min = items[0].position[axis];
    const max = items[items.length - 1].position[axis];
    const order = new Map(items.map((it, i) => [it.id, i]));
    this.updateItems(items.map((it) => it.id), (it) => ({
      position: { ...it.position, [axis]: round2(min + ((max - min) * order.get(it.id)) / (items.length - 1)) },
    }));
  }

  /** Consecutive DMX addresses for the selected fixtures, left to right. */
  readdressSelection(universe, start) {
    const fixtures = this.selectedFixtures().sort((a, b) => a.position.x - b.position.x || a.position.z - b.position.z);
    let u = universe;
    let a = start;
    const plan = new Map();
    for (const f of fixtures) {
      const ch = this.profile(f.profileId).channels.length;
      if (a + ch - 1 > 512) { u += 1; a = 1; }
      plan.set(f.id, { universe: u, address: a });
      a += ch;
    }
    this.updateItems(fixtures.map((f) => f.id), (f) => plan.get(f.id));
    toast(tp(fixtures.length, 'Am re-adresat o fixtură începând cu {a}.', 'Am re-adresat {n} fixturi începând cu {a}.', { a: `${universe}.${start}` }));
  }

  removeItem(id) {
    this.removeItems([id]);
  }

  removeItems(ids, { force = false } = {}) {
    let list = ids.filter((id) => this.findItem(id));
    if (!force) {
      const { free, locked } = splitLocked(this.project, list);
      if (locked.length) toast(tp(locked.length, '🔒 Un obiect blocat nu a fost șters. Deblochează-l întâi.', '🔒 {n} obiecte blocate nu au fost șterse. Deblochează-le întâi.'));
      list = free;
    }
    if (!list.length) return;
    this.checkpoint();
    const gone = new Set(list);
    this.project.fixtures = this.project.fixtures.filter((f) => !gone.has(f.id));
    this.project.props = this.project.props.filter((p) => !gone.has(p.id));
    pruneGroups(this.project);
    for (const id of list) {
      this.vis.removeObject(id);
      this.runtimes.delete(id);
      this.states.delete(id);
    }
    this.setSelection(this.selectedIds.filter((id) => !gone.has(id)));
    this.saveSoon();
    ui.renderAll(this);
  }

  duplicate(id) {
    this.duplicateMany([id]);
  }

  /** Copies sit 0.5 m to the right; fixtures get the next free addresses after the originals. */
  duplicateMany(ids) {
    const items = ids.map((id) => this.findItem(id)).filter(Boolean);
    if (!items.length) return;
    this.checkpoint();
    const copies = [];
    const fixtureNames = this.project.fixtures.map((f) => f.name);
    const propNames = this.project.props.map((p) => p.name);
    const nextAddr = new Map();
    const newGroups = new Map();
    for (const item of items) {
      const copy = JSON.parse(JSON.stringify(item));
      delete copy.locked;
      if (copy.groupId) {
        // A copy of a whole group becomes a new group; a copied single member joins none.
        const g = findGroup(this.project, copy.groupId);
        const whole = g && groupMembers(this.project, g.id).every((id) => ids.includes(id));
        if (whole) {
          if (!newGroups.has(g.id)) {
            const ng = { id: uid('gr'), name: nextName(g.name, this.project.groups.map((x) => x.name)) };
            this.project.groups.push(ng);
            newGroups.set(g.id, ng.id);
          }
          copy.groupId = newGroups.get(g.id);
        } else delete copy.groupId;
      }
      copy.position = { ...copy.position, x: round2(copy.position.x + 0.5) };
      if (this.isFixture(item.id)) {
        copy.id = uid('fx');
        const ch = this.profile(item.profileId).channels.length;
        // Each copy stays in its own universe, after the last used address there
        // (or in the first free gap, or the next universe when it is full).
        let u = item.universe;
        let addr = nextAddr.get(u) ?? this.project.fixtures.filter((f) => f.universe === u)
          .reduce((m, f) => Math.max(m, f.address + this.profile(f.profileId).channels.length), 1);
        if (addr + ch - 1 > 512) {
          addr = nextFreeAddress(this.project, this.profilesById, u, ch);
          while (addr == null) { u += 1; addr = nextFreeAddress(this.project, this.profilesById, u, ch); }
        }
        copy.universe = u;
        copy.address = addr;
        nextAddr.set(u, addr + ch);
        copy.name = nextName(item.name, fixtureNames);
        fixtureNames.push(copy.name);
        this.project.fixtures.push(copy);
        this._addFixtureToScene(copy);
      } else {
        copy.id = uid('pr');
        copy.name = nextName(item.name, propNames);
        propNames.push(copy.name);
        this.project.props.push(copy);
        this.vis.addProp(copy);
      }
      copies.push(copy.id);
    }
    this.saveSoon();
    ui.renderAll(this);
    this.setSelection(copies);
  }

  addProp(type) {
    const def = PROP_TYPES[type];
    if (!def) return;
    this.checkpoint();
    const room = this.project.room;
    const y = type === 'truss' ? 3.75 : type === 'mirrorball' ? Math.max(2.2, (room.height || 6) - 1.1) : 0; // case / tripod / others: on the floor
    const prop = { id: uid('pr'), type, name: def.label, position: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, params: { ...def.params } };
    // A new case with one case selected goes on top of it (stack).
    const under = this.selectedIds.length === 1 && type === 'case' ? this.findItem(this.selectedIds[0]) : null;
    if (under && under.type === 'case') {
      prop.position = { ...under.position, y: caseTop(under) };
      prop.rotation = { ...under.rotation };
      prop.params = { ...prop.params, width: under.params?.width ?? prop.params.width, depth: under.params?.depth ?? prop.params.depth, wheels: 0 };
    }
    this.project.props.push(prop);
    this.vis.addProp(prop);
    this.saveSoon();
    ui.renderAll(this);
    this.select(prop.id);
  }

  updateRoom(patch) {
    this.checkpoint();
    Object.assign(this.project.room, patch);
    this.vis.buildRoom(this.project.room);
    this.saveSoon();
  }

  // ------------------------------------------------------------------ loop
  _loop(now) {
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000);
    this._last = now;
    this.time += dt;
    const fixtures = this.project.fixtures;
    // Guests dance on this tempo (the demo's BPM; live DMX has no tempo, so the same default).
    this.vis.ctx.bpm = this.demoBpm;
    if (this.dmx.useDemo) {
      renderDemo(fixtures.map((fixture, index) => ({ fixture, profile: this.profile(fixture.profileId), index })), this.dmx, this.time, this.demoBpm);
    }
    this.dmx.beginFrame();
    for (const f of fixtures) {
      let rt = this.runtimes.get(f.id);
      if (!rt) { rt = createRuntime(); this.runtimes.set(f.id, rt); }
      this.states.set(f.id, computeState(this.profile(f.profileId), this.dmx.get(f.universe), f.address, rt, dt, this.time, f));
    }
    this.vis.render(dt, this.time, this.states);
    requestAnimationFrame((t) => this._loop(t));
  }

  toggleDemo(on = !this.dmx.useDemo) {
    this.dmx.useDemo = on;
    try { if (!this.presentMode) localStorage.setItem('freevis.demo', on ? '1' : '0'); } catch (_) { /* ignore */ }
    if (!on) for (const b of this.dmx.demo.values()) b.fill(0);
    ui.updateStatus(this);
  }

  // ------------------------------------------------------------------ keyboard
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveToServer(); return; }
      if (typing || document.getElementById('modal').open) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateMany(this.selectedIds); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); return; }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) this.ungroupSelection(); else this.groupSelection(); return; }
      if (mod) return;
      const fine = e.shiftKey;
      const step = fine ? 0.05 : 0.25;
      const turn = fine ? 5 : 15;
      switch (e.key) {
        case 'Delete': case 'Backspace': this.removeItems(this.selectedIds); break;
        case 'Escape': this.vis.cancelAim(); this.vis.cancelPlacement(); this.select(null); break;
        // Arrows move relative to the view: left/right on screen, up = away from you.
        case 'ArrowLeft': this.nudge('left', step); break;
        case 'ArrowRight': this.nudge('right', step); break;
        case 'ArrowUp': this.nudge('away', step); break;
        case 'ArrowDown': this.nudge('toward', step); break;
        case 'PageUp': this.nudge('up', step); break;
        case 'PageDown': this.nudge('down', step); break;
        case '[': case '{': this.rotateSelection('y', -turn); break;
        case ']': case '}': this.rotateSelection('y', turn); break;
        case 'w': case 'W': ui.setTransformMode(this, 'translate'); break;
        case 'e': case 'E': ui.setTransformMode(this, 'rotate'); break;
        case 'f': case 'F': this.vis.focusSelected(); break;
        case 'k': case 'K': this.setLocked(this.selectedIds); break;
        case 'h': case 'H': document.body.classList.toggle('ui-hidden'); this.vis.resize(); break;
        case 'd': case 'D': this.toggleDemo(); break;
        case 'l': case 'L': ui.toggleLabels(this); break;
        case '1': this.vis.setView('perspective'); break;
        case '2': this.vis.setView('front'); break;
        case '3': this.vis.setView('top'); break;
        case '4': this.vis.setView('side'); break;
        case '5': this.vis.setView('dj'); break;
        case '6': this.vis.setView('crowd'); break;
        default: return;
      }
      e.preventDefault();
    });
    window.addEventListener('beforeunload', () => {
      if (this.presentMode) return;
      this.project.camera = this.vis.getCamera();
      autosave(this.project);
    });
  }
}

let app = null;
translatePage();
try {
  app = new App();
  window.freevis = app; // handy for debugging from the console
} catch (err) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = `<h2>${tr('Vizualizatorul 3D nu a putut porni')}</h2>`
    + `<p>${tr('Placa video sau browserul nu permite WebGL. Încearcă Chrome / Safari actualizat, pornește accelerarea hardware sau repornește calculatorul.')}</p>`;
  const detail = document.createElement('code');
  detail.textContent = err.message;
  box.appendChild(detail);
  document.body.appendChild(box);
}
export { app, dialogs };
