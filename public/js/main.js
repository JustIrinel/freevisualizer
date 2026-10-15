// FreeVisualizer – app core: project state, scene sync, render loop, shortcuts.
import { Visualizer } from './scene3d.js';
import { DmxStore } from './dmx.js';
import { computeState, createRuntime } from './fixture-state.js';
import { renderDemo } from './demo.js';
import { BUILTIN_PROFILES, normalizeProfile, uid, cloneProfile } from './profiles.js';
import {
  demoProject, weddingProject, emptyProject, normalizeProject, autosave, AUTOSAVE_KEY, loadAutosave, saveServerProject, downloadJson, findConflicts, nextName,
} from './project.js';
import { PROP_TYPES } from './props3d.js';
import { toast, pickFile } from './dom.js';
import * as ui from './ui.js';
import * as dialogs from './dialogs.js';
import { AssistantPanel } from './assistant.js';
import { DmxMonitor } from './dmx-monitor.js';
import { ClipRecorder } from './recorder.js';
import { aimRotation } from './aim.js';

const round2 = (v) => Math.round(v * 100) / 100;
const wrapDeg = (d) => { let v = ((d + 180) % 360 + 360) % 360 - 180; if (v === -180) v = 180; return Math.round(v * 10) / 10; };

const MISSING_PROFILE = normalizeProfile({ id: '__missing', name: 'Profil lipsă', kind: 'par', channels: [{ type: 'dimmer' }] });

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

    this.vis.onPick = (id, { toggle }) => {
      if (toggle) { if (id) this.toggleSelect(id); }
      else this.select(id);
    };
    this.vis.onMarquee = (ids, { add }) => this.setSelection(add ? [...this.selectedIds, ...ids] : ids);
    this.vis.onTransformStart = () => this.checkpoint();
    this.vis.onTransform = (changes) => {
      for (const t of changes) {
        const item = this.findItem(t.id);
        if (!item) continue;
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
    if (!restored && !this.presentMode) toast('Bine ai venit! Am încărcat un rig demo – apasă ▶ Demo ca să-l vezi în acțiune.', 'info', 6000);
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
    if (used) { toast(`Profilul este folosit de ${used} fixturi. Șterge-le sau schimbă-le profilul întâi.`, 'error'); return false; }
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
    if (!this.undoStack.length) { toast('Nimic de anulat'); return; }
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) { toast('Nimic de refăcut'); return; }
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
      toast(`Proiect salvat: „${this.project.name}”`);
    } catch (err) {
      toast(`Nu am putut salva pe server (${err.message}). Folosește Export.`, 'error');
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
      if (!Array.isArray(data.fixtures)) throw new Error('fișierul nu este un proiect FreeVisualizer');
      this.checkpoint();
      this.loadProject(data);
      toast(`Proiect importat: „${this.project.name}”`);
    } catch (err) {
      toast(`Import eșuat: ${err.message}`, 'error');
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
    if (record) this.checkpoint();
    items.forEach((item, i) => {
      const patch = patchFor(item, i);
      if (!patch) return;
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
    const next = () => toast(`Plasează ${list[i].name} (${i + 1} din ${list.length}): click pe podea, truss, perete sau tavan. Esc = gata.`, 'info', 60000);
    next();
    this.vis.startPlacement((at) => {
      const f = { ...list[i], position: at.position, rotation: at.rotation };
      this.addFixtures([f]);
      i++;
      if (i >= list.length) {
        this.vis.cancelPlacement(false);
        this.setSelection(list.map((x) => x.id));
        toast(`Am plasat ${list.length} fixturi.`);
      } else {
        this.setSelection([]);
        next();
      }
    }, () => toast(i ? `Am plasat ${i} din ${list.length} fixturi.` : 'Plasare anulată.'));
  }

  /** Point every selected fixture's beam at a world point. */
  aimSelectionAt(point) {
    const ids = this.selectedIds.filter((id) => this.isFixture(id));
    if (!ids.length) return;
    this.updateItems(ids, (it) => {
      const from = this.vis.emitterOrigin(it.id) || it.position;
      return { rotation: aimRotation(from, point) };
    });
    toast(ids.length > 1 ? `Am îndreptat ${ids.length} fixturi spre punctul ales.` : 'Fixtura bate acum spre punctul ales.');
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
    if (items.length < 3) { toast('Selectează cel puțin 3 elemente pentru distribuire.'); return; }
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
    toast(`Am re-adresat ${fixtures.length} fixturi începând cu ${universe}.${start}.`);
  }

  removeItem(id) {
    this.removeItems([id]);
  }

  removeItems(ids) {
    const list = ids.filter((id) => this.findItem(id));
    if (!list.length) return;
    this.checkpoint();
    const gone = new Set(list);
    this.project.fixtures = this.project.fixtures.filter((f) => !gone.has(f.id));
    this.project.props = this.project.props.filter((p) => !gone.has(p.id));
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
    let nextAddr = null;
    for (const item of items) {
      const copy = JSON.parse(JSON.stringify(item));
      copy.position = { ...copy.position, x: round2(copy.position.x + 0.5) };
      if (this.isFixture(item.id)) {
        copy.id = uid('fx');
        const ch = this.profile(item.profileId).channels.length;
        if (!nextAddr) {
          const last = this.project.fixtures.filter((f) => f.universe === item.universe)
            .reduce((m, f) => Math.max(m, f.address + this.profile(f.profileId).channels.length), 1);
          nextAddr = { universe: item.universe, address: last };
        }
        if (nextAddr.address + ch - 1 > 512) { nextAddr = { universe: nextAddr.universe + 1, address: 1 }; }
        copy.universe = nextAddr.universe;
        copy.address = nextAddr.address;
        nextAddr.address += ch;
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
    const y = type === 'truss' ? 3.75 : type === 'mirrorball' ? Math.max(2.2, (room.height || 6) - 1.1) : 0;
    const prop = { id: uid('pr'), type, name: def.label, position: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, params: { ...def.params } };
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
try {
  app = new App();
  window.freevis = app; // handy for debugging from the console
} catch (err) {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = '<h2>Vizualizatorul 3D nu a putut porni</h2>'
    + '<p>Placa video sau browserul nu permite WebGL. Încearcă Chrome / Safari actualizat, '
    + 'pornește accelerarea hardware sau repornește calculatorul.</p>';
  const detail = document.createElement('code');
  detail.textContent = err.message;
  box.appendChild(detail);
  document.body.appendChild(box);
}
export { app, dialogs };
