// FreeVisualizer – app core: project state, scene sync, render loop, shortcuts.
import { Visualizer } from './scene3d.js';
import { DmxStore } from './dmx.js';
import { computeState, createRuntime } from './fixture-state.js';
import { renderDemo } from './demo.js';
import { BUILTIN_PROFILES, normalizeProfile, uid, cloneProfile } from './profiles.js';
import {
  demoProject, emptyProject, normalizeProject, autosave, AUTOSAVE_KEY, loadAutosave, saveServerProject, downloadJson, findConflicts, nextName,
} from './project.js';
import { PROP_TYPES } from './props3d.js';
import { toast, pickFile } from './dom.js';
import * as ui from './ui.js';
import * as dialogs from './dialogs.js';
import { DmxMonitor } from './dmx-monitor.js';

const MISSING_PROFILE = normalizeProfile({ id: '__missing', name: 'Profil lipsă', kind: 'par', channels: [{ type: 'dimmer' }] });

class App {
  constructor() {
    this.dmx = new DmxStore();
    this.vis = new Visualizer(document.getElementById('viewport'));
    this.runtimes = new Map();
    this.states = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.builtins = BUILTIN_PROFILES.map(normalizeProfile);
    this._profileCache = null;
    this.startedAt = performance.now();
    this.time = 0;

    this.vis.onSelect = (id) => this.select(id, { fromScene: true });
    this.vis.onTransformStart = () => this.checkpoint();
    this.vis.onTransform = (id, t) => {
      const item = this.findItem(id);
      if (!item) return;
      item.position = t.position;
      item.rotation = t.rotation;
      ui.updateInspectorTransform(this, id);
    };
    this.vis.onTransformEnd = () => this.saveSoon();

    // Presentation window (desktop app, 2nd monitor): no panels, follows the main window's project.
    this.presentMode = new URLSearchParams(location.search).has('present');
    if (this.presentMode) document.body.classList.add('ui-hidden', 'present');

    const restored = loadAutosave();
    this.loadProject(restored || demoProject(), { keepHistory: false });
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
      haze: s.haze, bloom: s.bloom, ambient: s.ambient, lightPower: s.lightPower, showLabels: s.showLabels,
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

  checkpoint() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
  }

  _restore(json) {
    const camera = this.vis.getCamera();
    const sel = this.selectedId;
    this.project = normalizeProject({ ...JSON.parse(json), camera });
    this._profileCache = null;
    this._applySettings();
    this.vis.buildRoom(this.project.room);
    this._rebuildScene();
    this.select(this.findItem(sel) ? sel : null);
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

  newProject(withDemo) {
    this.checkpoint();
    this.loadProject(withDemo ? demoProject() : emptyProject());
  }

  // ------------------------------------------------------------------ selection & edits
  select(id, { fromScene = false } = {}) {
    this.selectedId = id && this.findItem(id) ? id : null;
    if (!fromScene) this.vis.select(this.selectedId);
    ui.renderSelection(this);
  }

  addFixtures(list) {
    this.checkpoint();
    for (const f of list) {
      this.project.fixtures.push(f);
      this._addFixtureToScene(f);
    }
    this.saveSoon();
    ui.renderAll(this);
    if (list.length) this.select(list[list.length - 1].id);
  }

  updateItem(id, patch, { rebuild = false, record = true } = {}) {
    const item = this.findItem(id);
    if (!item) return;
    if (record) this.checkpoint();
    Object.assign(item, patch);
    const fixture = this.isFixture(id);
    if (rebuild) {
      if (fixture) this._addFixtureToScene(item);
      else this.vis.addProp(item);
    } else {
      this.vis.updateTransform(item);
      if (fixture) this.vis.refreshLabel(id);
    }
    if (this.selectedId === id) this.vis.select(id);
    this.saveSoon();
    ui.renderLists(this);
  }

  removeItem(id) {
    if (!this.findItem(id)) return;
    this.checkpoint();
    this.project.fixtures = this.project.fixtures.filter((f) => f.id !== id);
    this.project.props = this.project.props.filter((p) => p.id !== id);
    this.vis.removeObject(id);
    this.runtimes.delete(id);
    this.states.delete(id);
    if (this.selectedId === id) this.select(null);
    this.saveSoon();
    ui.renderAll(this);
  }

  duplicate(id) {
    const item = this.findItem(id);
    if (!item) return;
    const copy = JSON.parse(JSON.stringify(item));
    copy.position = { ...copy.position, x: copy.position.x + 0.5 };
    if (this.isFixture(id)) {
      copy.id = uid('fx');
      const prof = this.profile(item.profileId);
      copy.address = item.address + prof.channels.length;
      if (copy.address + prof.channels.length - 1 > 512) { copy.universe += 1; copy.address = 1; }
      copy.name = nextName(item.name, this.project.fixtures.map((f) => f.name));
      this.addFixtures([copy]);
    } else {
      copy.id = uid('pr');
      copy.name = nextName(item.name, this.project.props.map((p) => p.name));
      this.checkpoint();
      this.project.props.push(copy);
      this.vis.addProp(copy);
      this.saveSoon();
      ui.renderAll(this);
      this.select(copy.id);
    }
  }

  addProp(type) {
    const def = PROP_TYPES[type];
    if (!def) return;
    this.checkpoint();
    const y = type === 'truss' ? 3.75 : 0;
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
      renderDemo(fixtures.map((fixture, index) => ({ fixture, profile: this.profile(fixture.profileId), index })), this.dmx, this.time);
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
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (this.selectedId) this.duplicate(this.selectedId); return; }
      if (mod) return;
      switch (e.key) {
        case 'Delete': case 'Backspace': if (this.selectedId) this.removeItem(this.selectedId); break;
        case 'Escape': this.select(null); break;
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
