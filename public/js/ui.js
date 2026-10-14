// Side panels, inspector and status bar.
import { h, toast, numberInput, field, rgbCss } from './dom.js';
import { KINDS, MOVING_STYLES, channelLabel } from './profiles.js';
import { PROP_TYPES } from './props3d.js';
import { fixtureEnd } from './project.js';
import * as dialogs from './dialogs.js';
import * as ssDialog from './ss-dialog.js';
import { recordDialog } from './recorder.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ static bindings
export function bindStatic(app) {
  const actions = {
    new: () => dialogs.newProjectDialog(app),
    open: () => dialogs.openProjectDialog(app),
    save: () => app.saveToServer(),
    export: () => app.exportProject(),
    import: () => app.importProject(),
    undo: () => app.undo(),
    redo: () => app.redo(),
    settings: () => dialogs.settingsDialog(app),
    help: () => dialogs.helpDialog(app),
    'add-fixture': () => dialogs.addFixturesDialog(app),
    'import-soundswitch': () => ssDialog.soundSwitchImportDialog(app),
    'ofl-search': () => dialogs.oflDialog(app),
    'open-fixture-id': () => dialogs.openFixtureId(),
    'new-profile': () => dialogs.profileEditor(app, null),
    'import-profile': () => dialogs.importProfileFile(app),
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    'hide-ui': () => { document.body.classList.toggle('ui-hidden'); app.vis.resize(); if (document.body.classList.contains('ui-hidden')) toast('Apasă H ca să revii la panouri.'); },
    demo: () => app.toggleDemo(),
    record: () => recordDialog(app),
    present: () => window.freevisDesktop && window.freevisDesktop.togglePresent(),
  };
  app.actions = actions;
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !actions[btn.dataset.action]) return;
    if (btn.tagName === 'A') e.preventDefault();
    actions[btn.dataset.action]();
  });
  // Drag & drop fixture files (.d4 / .gdtf / .zip / .json) or a SoundSwitch project anywhere on the window.
  const overlay = $('dropOverlay');
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; overlay.classList.remove('hidden'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.classList.add('hidden'); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.add('hidden');
    // A SoundSwitch project folder (.ssproj) dropped as a whole.
    const entries = [...(e.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    const dirs = entries.filter((en) => en.isDirectory);
    if (dirs.length) {
      try {
        const source = await ssDialog.venuesFromEntry(dirs[0]);
        if (!source) throw new Error('Folderul nu e un proiect SoundSwitch (.ssproj)');
        await ssDialog.importSoundSwitch(app, source);
      } catch (err) {
        toast(err.message, 'error', 8000);
      }
      return;
    }
    for (const file of e.dataTransfer.files) await dialogs.importFixtureFile(app, file);
  });

  // Native menu of the desktop app (macOS / Windows).
  if (window.freevisDesktop) {
    document.body.classList.add('desktop');
    window.freevisDesktop.onMenu((action) => { if (actions[action]) actions[action](); });
    // Files downloaded in the Fixture.ID window.
    window.freevisDesktop.onFixtureFile?.((f) => {
      toast(`Am primit „${f.name}” de pe Fixture.ID`);
      dialogs.importFixtureFile(app, new File([f.data], f.name));
    });
  }

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'dmx') app.monitor.refreshUniverses();
  }));

  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => app.vis.setView(b.dataset.view)));
  document.querySelectorAll('[data-tmode]').forEach((b) => b.addEventListener('click', () => setTransformMode(app, b.dataset.tmode)));
  $('snapBtn').addEventListener('click', () => { app.vis.setSnap(!app.vis.settings.snap); $('snapBtn').classList.toggle('active', app.vis.settings.snap); });
  $('labelsBtn').addEventListener('click', () => toggleLabels(app));
  $('labelsBtn').classList.toggle('active', !!app.project.settings.showLabels);

  const haze = $('hazeSlider');
  haze.value = app.project.settings.haze;
  haze.addEventListener('input', () => app.setSetting('haze', parseFloat(haze.value)));
  const bloom = $('bloomSlider');
  bloom.value = app.project.settings.bloom;
  bloom.addEventListener('input', () => app.setSetting('bloom', parseFloat(bloom.value)));

  $('demoBtn').addEventListener('click', () => app.toggleDemo());
  $('projectName').addEventListener('change', (e) => { app.project.name = e.target.value.trim() || 'Proiect nou'; app.saveSoon(); });
  $('fixtureFilter').addEventListener('input', () => renderFixtureList(app));
  $('profileFilter').addEventListener('input', () => renderProfileList(app));

  const pb = $('propButtons');
  for (const [type, def] of Object.entries(PROP_TYPES)) pb.append(h('button', { onclick: () => app.addProp(type) }, def.label));
}

let rotateHintShown = false;
export function setTransformMode(app, mode) {
  app.vis.setTransformMode(mode);
  if (mode === 'rotate' && !rotateHintShown) {
    rotateHintShown = true;
    toast('Rotire: trage de cercuri – roșu = înclinare față/spate, verde = rotire stânga/dreapta, albastru = înclinare laterală. Mai simplu: sliderele din dreapta sau 🎯 Țintește.', 'info', 9000);
  }
  document.querySelectorAll('[data-tmode]').forEach((b) => b.classList.toggle('active', b.dataset.tmode === mode));
}

export function toggleLabels(app) {
  app.setSetting('showLabels', !app.project.settings.showLabels);
  $('labelsBtn').classList.toggle('active', app.project.settings.showLabels);
}

// ------------------------------------------------------------------ render
export function renderAll(app) {
  $('projectName').value = app.project.name;
  $('hazeSlider').value = app.project.settings.haze;
  $('bloomSlider').value = app.project.settings.bloom;
  $('labelsBtn').classList.toggle('active', !!app.project.settings.showLabels);
  renderLists(app);
  renderRoomForm(app);
  renderInspector(app);
}

export function renderLists(app) {
  renderFixtureList(app);
  renderPropList(app);
  renderProfileList(app);
  if (app.monitor) app.monitor.refreshUniverses();
}

export function renderSelection(app) {
  const set = new Set(app.selectedIds);
  document.querySelectorAll('.item[data-id]').forEach((el) => el.classList.toggle('selected', set.has(el.dataset.id)));
  const sel = document.querySelector(`.item[data-id="${app.selectedId}"]`);
  if (sel) sel.scrollIntoView({ block: 'nearest' });
  renderInspector(app);
}

/** Click in a list: Ctrl/Cmd toggles, Shift selects a range, plain click selects one. */
function listClick(app, id, e, order) {
  if (e.ctrlKey || e.metaKey) app.toggleSelect(id);
  else if (e.shiftKey) app.selectRange(id, order());
  else app.select(id);
}

/** Live readout while dragging the gizmo. */
export function showGizmoInfo(text) {
  let el = document.getElementById('gizmoInfo');
  if (!el) {
    el = h('div', { id: 'gizmoInfo', class: 'gizmo-info hidden' });
    document.getElementById('viewport').appendChild(el);
  }
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function renderFixtureList(app) {
  const list = $('fixtureList');
  const q = $('fixtureFilter').value.toLowerCase().trim();
  const conflicts = app.conflicts();
  const fixtures = [...app.project.fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address);
  list.innerHTML = '';
  let lastU = null;
  let shown = 0;
  for (const f of fixtures) {
    const p = app.profile(f.profileId);
    const hay = `${f.name} ${p.name} ${f.universe}.${f.address}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (f.universe !== lastU) {
      list.append(h('div', { class: 'group-title' }, `Univers ${f.universe}`));
      lastU = f.universe;
    }
    shown++;
    const end = fixtureEnd(f, p);
    list.append(h('div', {
      class: `item ${app.selectedIds.includes(f.id) ? 'selected' : ''} ${conflicts.has(f.id) ? 'conflict' : ''}`,
      'data-id': f.id,
      title: `${p.name}${conflicts.has(f.id) ? '\n⚠ Adrese suprapuse!' : ''}\nCtrl/Cmd+click: adaugă la selecție · Shift+click: interval`,
      onclick: (e) => listClick(app, f.id, e, () => [...document.querySelectorAll('#fixtureList .item[data-id]')].map((x) => x.dataset.id)),
      ondblclick: () => app.vis.focusSelected(),
    },
    h('span', { class: 'swatch', 'data-swatch': f.id }),
    h('span', { class: 'name' }, f.name),
    h('span', { class: 'meta' }, `${f.address}–${end}`)));
  }
  if (!app.project.fixtures.length) {
    list.append(h('div', { class: 'muted', style: { padding: '16px 6px' } }, 'Nicio fixtură încă. Apasă „+ Adaugă fixturi” și alege din bibliotecă (sau caută modelul tău exact în Open Fixture Library).'));
  } else if (!shown) {
    list.append(h('div', { class: 'muted', style: { padding: '8px' } }, 'Niciun rezultat.'));
  }
  const universes = new Set(app.project.fixtures.map((f) => f.universe));
  const channels = app.project.fixtures.reduce((s, f) => s + app.profile(f.profileId).channels.length, 0);
  $('patchSummary').textContent = `${app.project.fixtures.length} fixturi · ${channels} canale · ${universes.size} univers(uri)${conflicts.size ? ` · ⚠ ${conflicts.size} conflicte de adresă` : ''}`;
}

function renderPropList(app) {
  const list = $('propList');
  list.innerHTML = '';
  for (const p of app.project.props) {
    list.append(h('div', {
      class: `item ${app.selectedIds.includes(p.id) ? 'selected' : ''}`,
      'data-id': p.id,
      onclick: (e) => listClick(app, p.id, e, () => app.project.props.map((x) => x.id)),
    }, h('span', { class: 'name' }, p.name), h('span', { class: 'tag' }, (PROP_TYPES[p.type] || {}).label || p.type)));
  }
  if (!app.project.props.length) list.append(h('div', { class: 'muted small' }, 'Nimic adăugat.'));
}

export function renderProfileList(app) {
  const list = $('profileList');
  const q = $('profileFilter').value.toLowerCase().trim();
  list.innerHTML = '';
  const groups = [
    ['Profilele proiectului', app.project.profiles],
    ['Generice (incluse)', app.builtins],
  ];
  for (const [title, profiles] of groups) {
    const items = profiles.filter((p) => !q || `${p.manufacturer} ${p.name} ${KINDS[p.kind]}`.toLowerCase().includes(q));
    if (!items.length) continue;
    list.append(h('div', { class: 'group-title' }, title));
    for (const p of items) {
      const used = app.project.fixtures.filter((f) => f.profileId === p.id).length;
      list.append(h('div', { class: 'item', title: `${p.manufacturer ? p.manufacturer + ' · ' : ''}${p.name}\n${p.channels.length} canale · ${KINDS[p.kind]}`, onclick: () => dialogs.profileActions(app, p) },
        h('span', { class: 'name' }, p.manufacturer && p.source !== 'builtin' ? `${p.manufacturer} ${p.name}` : p.name),
        used ? h('span', { class: 'tag' }, `×${used}`) : null,
        h('span', { class: 'meta' }, `${p.channels.length}ch`)));
    }
  }
}

function renderRoomForm(app) {
  const r = app.project.room;
  const form = $('roomForm');
  form.innerHTML = '';
  form.append(
    h('div', { class: 'grid3' },
      field('Lățime (m)', numberInput(r.width, (v) => app.updateRoom({ width: v }), { min: 4, max: 200, step: 1 })),
      field('Adâncime (m)', numberInput(r.depth, (v) => app.updateRoom({ depth: v }), { min: 4, max: 200, step: 1 })),
      field('Înălțime (m)', numberInput(r.height, (v) => app.updateRoom({ height: v }), { min: 2, max: 40, step: 0.5 }))),
    h('div', { class: 'grid2' },
      field('Podea', colorInput(r.floorColor, (v) => app.updateRoom({ floorColor: v }))),
      field('Pereți', colorInput(r.wallColor, (v) => app.updateRoom({ wallColor: v })))),
    h('label', { class: 'inline' }, checkbox(r.walls !== false, (v) => app.updateRoom({ walls: v })), 'Pereți'),
    h('label', { class: 'inline' }, checkbox(r.grid !== false, (v) => app.updateRoom({ grid: v })), 'Grilă pe podea'),
  );
}

function colorInput(value, onChange) {
  const el = h('input', { type: 'color', value: value || '#222222', style: { height: '30px', padding: '2px' } });
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function checkbox(value, onChange) {
  const el = h('input', { type: 'checkbox', checked: value });
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

// ------------------------------------------------------------------ inspector
function positionInputs(app, id) {
  const item = app.findItem(id);
  const names = { x: 'Stânga ↔ dreapta', y: 'Înălțime', z: 'Spate ↕ față' };
  const wrap = h('div', { class: 'xyz', 'data-xyz': 'position' });
  for (const axis of ['x', 'y', 'z']) {
    const input = numberInput(item.position[axis], (v) => app.updateItem(id, { position: { ...app.findItem(id).position, [axis]: v } }), { step: 0.05 });
    input.dataset.axis = axis;
    wrap.append(h('label', { title: names[axis] }, names[axis], input));
  }
  return wrap;
}

const ROT_AXES = [
  ['x', 'Înclinare față / spate', 'Apleacă fixtura înainte sau înapoi'],
  ['y', 'Rotire stânga / dreapta', 'Rotește fixtura în jurul axei verticale'],
  ['z', 'Înclinare laterală', 'Apleacă fixtura spre stânga sau spre dreapta'],
];

/** One slider per axis with a numeric field and ±15° buttons. */
function rotationControls(app, id) {
  const wrap = h('div', { class: 'rot-controls', 'data-xyz': 'rotation' });
  for (const [axis, label, title] of ROT_AXES) {
    const item = app.findItem(id);
    const range = h('input', { type: 'range', min: -180, max: 180, step: 1, value: item.rotation[axis] });
    const num = h('input', { type: 'number', min: -180, max: 180, step: 1, value: item.rotation[axis] });
    range.dataset.axis = axis;
    num.dataset.axis = axis;
    const set = (v, record) => {
      const val = Math.max(-180, Math.min(180, Number(v) || 0));
      app.updateItem(id, { rotation: { ...app.findItem(id).rotation, [axis]: val } }, { record, quiet: !record });
    };
    range.addEventListener('pointerdown', () => app.checkpoint());
    range.addEventListener('input', () => { num.value = range.value; set(range.value, false); });
    range.addEventListener('change', () => app.saveSoon());
    num.addEventListener('change', () => { range.value = num.value; set(num.value, true); });
    const nudge = (d) => { const v = wrapDeg180(app.findItem(id).rotation[axis] + d); set(v, true); };
    wrap.append(h('div', { class: 'rot-row', title },
      h('div', { class: 'rot-label' }, label),
      h('div', { class: 'rot-line' },
        h('button', { class: 'icon', title: '−15°', onclick: () => nudge(-15) }, '−'),
        range,
        h('button', { class: 'icon', title: '+15°', onclick: () => nudge(15) }, '+'),
        num, h('span', { class: 'muted small' }, '°'))));
  }
  return wrap;
}

function wrapDeg180(d) {
  let v = (((d + 180) % 360) + 360) % 360 - 180;
  if (v === -180) v = 180;
  return v;
}

const MOUNTS = [
  ['Pe podea ↑', { x: 0, y: 0, z: 0 }],
  ['Agățat ↓', { x: 180, y: 0, z: 0 }],
  ['Spre public →', { x: 90, y: 0, z: 0 }],
  ['Spre scenă ←', { x: -90, y: 0, z: 0 }],
];

function aimButton(app) {
  return h('button', {
    class: 'aim-btn',
    title: 'Apasă, apoi dă click în scenă pe punctul spre care vrei să bată lumina (podea, perete, glob, ring…)',
    onclick: () => {
      toast('🎯 Dă click în scenă pe punctul spre care să bată lumina (Esc anulează).', 'info', 5000);
      app.vis.startAim((point) => app.aimSelectionAt(point));
    },
  }, '🎯 Țintește un punct');
}

/** Position, rotation, mounting presets and aiming for one object. */
function transformSection(app, item, isFixture) {
  return [
    h('h4', {}, 'Poziție (m)'),
    positionInputs(app, item.id),
    h('h4', {}, 'Orientare'),
    isFixture ? h('div', { class: 'muted small' }, 'Săgeata galbenă din scenă arată încotro bate lumina.') : null,
    rotationControls(app, item.id),
    isFixture ? h('div', { class: 'preset-buttons' }, MOUNTS.map(([label, rot]) => h('button', {
      onclick: () => app.updateItem(item.id, { rotation: { ...rot, y: app.findItem(item.id).rotation.y } }),
    }, label))) : null,
    isFixture ? aimButton(app) : null,
  ];
}

export function updateInspectorTransform(app) {
  if (app.selectedIds.length !== 1) return;
  const item = app.findItem(app.selectedId);
  if (!item) return;
  for (const key of ['position', 'rotation']) {
    document.querySelectorAll(`#inspector [data-xyz="${key}"] input`).forEach((input) => {
      if (document.activeElement !== input) input.value = item[key][input.dataset.axis];
    });
  }
}

/** Several objects selected: actions that apply to all of them. */
function renderGroupInspector(app, el) {
  const items = app.selectedItems();
  const fixtures = app.selectedFixtures();
  const n = items.length;
  const step = (label, delta) => h('button', { onclick: () => app.moveSelection(delta) }, label);
  const universe = numberInput(fixtures[0] ? fixtures[0].universe : 1, () => {}, { min: 1, max: 32768, integer: true });
  const start = numberInput(fixtures.length ? Math.min(...fixtures.map((f) => f.address)) : 1, () => {}, { min: 1, max: 512, integer: true });
  const totalCh = fixtures.reduce((s, f) => s + app.profile(f.profileId).channels.length, 0);
  el.append(
    h('h3', {}, `${n} elemente selectate`),
    h('div', { class: 'sub' }, fixtures.length ? `${fixtures.length} fixturi · ${totalCh} canale` : 'Elemente de scenă'),
    h('div', { class: 'list group-list' }, items.map((it) => h('div', { class: 'item' },
      h('span', { class: 'name' }, it.name),
      app.isFixture(it.id) ? h('span', { class: 'meta' }, `U${it.universe} · ${it.address}`) : null,
      h('button', { class: 'icon', title: 'Scoate din selecție', onclick: () => app.toggleSelect(it.id) }, '✕')))),
    h('h4', {}, 'Mută tot grupul'),
    h('div', { class: 'grid3' },
      step('← X', { x: -0.25 }), step('↑ Sus', { y: 0.25 }), step('X →', { x: 0.25 }),
      step('↑ Z (spate)', { z: -0.25 }), step('↓ Jos', { y: -0.25 }), step('Z (față) ↓', { z: 0.25 })),
    h('div', { class: 'muted small' }, 'Sau trage de săgețile din scenă (W) / săgețile de la tastatură (Shift = pas fin).'),
    h('h4', {}, 'Aliniază și distribuie'),
    h('div', { class: 'grid2' },
      h('button', { title: 'Toate la aceeași înălțime ca ultimul selectat', onclick: () => app.alignSelection('y') }, 'Aceeași înălțime'),
      h('button', { title: 'Toate pe aceeași linie față/spate', onclick: () => app.alignSelection('z') }, 'Aceeași linie Z'),
      h('button', { title: 'Toate pe aceeași linie stânga/dreapta', onclick: () => app.alignSelection('x') }, 'Aceeași linie X')),
    h('div', { class: 'grid2' },
      h('button', { onclick: () => app.distributeSelection('x') }, 'Distribuie egal pe X'),
      h('button', { onclick: () => app.distributeSelection('z') }, 'Distribuie egal pe Z')),
    h('h4', {}, 'Orientare'),
    h('div', { class: 'grid2' },
      h('button', { onclick: () => app.rotateSelection('y', -15) }, '⟲ Rotire −15°'),
      h('button', { onclick: () => app.rotateSelection('y', 15) }, '⟳ Rotire +15°'),
      h('button', { onclick: () => app.rotateSelection('x', -15) }, 'Înclinare −15°'),
      h('button', { onclick: () => app.rotateSelection('x', 15) }, 'Înclinare +15°')),
    fixtures.length ? h('div', { class: 'preset-buttons' }, MOUNTS.map(([label, rot]) => h('button', {
      onclick: () => app.updateItems(fixtures.map((f) => f.id), (f) => ({ rotation: { ...rot, y: f.rotation.y } })),
    }, label))) : null,
    fixtures.length ? aimButton(app) : null,
    fixtures.length ? h('h4', {}, 'Adrese DMX (de la stânga la dreapta)') : null,
    fixtures.length ? h('div', { class: 'grid3' },
      field('Univers', universe), field('Adresă start', start),
      h('button', { style: { alignSelf: 'end' }, onclick: () => app.readdressSelection(Number(universe.value), Number(start.value)) }, 'Re-adresează')) : null,
    fixtures.length ? h('button', { onclick: () => dialogs.changeProfileGroupDialog(app, fixtures) }, 'Schimbă profilul pentru toate…') : null,
    fixtures.length ? h('h4', {}, 'Test') : null,
    fixtures.length ? h('div', { class: 'grid2' },
      h('button', { onclick: () => fixtures.forEach((f) => app.profile(f.profileId).channels.forEach((c, i) => app.dmx.setOverride(f.universe, f.address + i, locateValue(c)))) }, '💡 Găsește toate'),
      h('button', { onclick: () => fixtures.forEach((f) => app.dmx.clearOverrides(f.universe, f.address, app.profile(f.profileId).channels.length)) }, 'Eliberează toate')) : null,
    h('h4', {}, 'Acțiuni'),
    h('div', { class: 'grid2' },
      h('button', { onclick: () => app.duplicateMany(app.selectedIds) }, 'Duplică grupul'),
      h('button', { class: 'danger', onclick: () => app.removeItems(app.selectedIds) }, `Șterge ${n}`)),
  );
}

export function renderInspector(app) {
  const el = $('inspector');
  el.innerHTML = '';
  el.className = 'panel right inspector';
  const id = app.selectedId;
  const item = id && app.findItem(id);
  if (!item) {
    el.append(h('div', { class: 'inspector-empty' },
      h('p', {}, 'Selectează o fixtură sau un element (click în scenă sau în listă).'),
      h('p', { class: 'small' }, 'Mai multe deodată: Ctrl/Cmd+click, sau Shift + trage cu mouse-ul un dreptunghi în scenă. Ctrl/Cmd+A selectează toate fixturile.'),
      h('p', { class: 'small' }, 'Scurtături: W mută · E rotește · săgeți / PageUp / PageDown mută · [ ] rotește · F focus · Ctrl+D duplică · Del șterge · H ascunde panourile · D demo · 1–6 camere')));
    return;
  }
  if (app.selectedIds.length > 1) { renderGroupInspector(app, el); return; }
  if (app.isFixture(id)) renderFixtureInspector(app, el, item);
  else renderPropInspector(app, el, item);
}

function renderFixtureInspector(app, el, f) {
  const p = app.profile(f.profileId);
  const conflicts = app.conflicts();
  const nameInput = h('input', { value: f.name });
  nameInput.addEventListener('change', () => app.updateItem(f.id, { name: nameInput.value.trim() || f.name }));
  el.append(
    h('h3', {}, h('span', { class: 'swatch', 'data-swatch': f.id, style: { width: '12px', height: '12px', borderRadius: '3px', display: 'inline-block' } }), 'Fixtură'),
    h('div', { class: 'form' },
      field('Nume', nameInput),
      h('div', { class: 'sub' }, `${p.manufacturer ? p.manufacturer + ' · ' : ''}${p.name} · ${p.channels.length} canale · ${KINDS[p.kind]}${p.kind === 'moving' ? ' ' + (MOVING_STYLES[p.style] || '') : ''}`),
      h('div', { class: 'grid2' },
        field('Univers', numberInput(f.universe, (v) => app.updateItem(f.id, { universe: v }), { min: 1, max: 32768, integer: true })),
        field('Adresă DMX', numberInput(f.address, (v) => app.updateItem(f.id, { address: v }), { min: 1, max: 512, integer: true }))),
      h('div', { class: 'muted small' }, `Canale ${f.address}–${fixtureEnd(f, p)} în universul ${f.universe}`),
      conflicts.has(f.id) ? h('div', { class: 'warn-box' }, '⚠ Adresele se suprapun cu altă fixtură (sau depășesc 512).') : null,
      h('button', { onclick: () => dialogs.changeProfileDialog(app, f) }, 'Schimbă profilul…'),
      ...transformSection(app, f, true),
      p.kind === 'moving' ? h('div', { class: 'grid2' },
        h('label', { class: 'inline' }, checkbox(f.invertPan, (v) => app.updateItem(f.id, { invertPan: v })), 'Inversează pan'),
        h('label', { class: 'inline' }, checkbox(f.invertTilt, (v) => app.updateItem(f.id, { invertTilt: v })), 'Inversează tilt')) : null,
      h('div', { class: 'grid2' },
        h('button', { onclick: () => app.duplicate(f.id) }, 'Duplică'),
        h('button', { class: 'danger', onclick: () => app.removeItem(f.id) }, 'Șterge')),
    ),
    renderFaders(app, f, p),
  );
}

function locateValue(c) {
  switch (c.type) {
    case 'dimmer': case 'red': case 'green': case 'blue': case 'white': return 255;
    case 'pan': case 'tilt': case 'zoom': return 128;
    case 'strobe': { const r = (c.ranges || []).find((x) => x.mode === 'open'); return r ? r.from : 0; }
    case 'colorWheel': { const r = (c.ranges || []).find((x) => x.color && x.color.toLowerCase() === '#ffffff'); return r ? r.from : 0; }
    default: return 0;
  }
}

function renderFaders(app, f, p) {
  const box = h('div', { class: 'faders' });
  const rows = [];
  p.channels.forEach((c, i) => {
    const addr = f.address + i;
    const range = h('input', { type: 'range', min: 0, max: 255, step: 1, value: 0 });
    const val = h('span', { class: 'val' }, '0');
    const row = h('div', { class: 'fader', title: `Canal ${addr}` }, h('span', { class: 'num' }, i + 1), h('span', { class: 'lbl' }, channelLabel(c)), range, val);
    range.addEventListener('input', () => {
      app.dmx.setOverride(f.universe, addr, Number(range.value));
      val.textContent = range.value;
    });
    rows.push({ range, val, row, addr });
    box.append(row);
  });
  let attached = false;
  const sync = () => {
    if (!box.isConnected) { if (attached) clearInterval(timer); return; }
    attached = true;
    const buf = app.dmx.get(f.universe);
    for (const r of rows) {
      const over = app.dmx.hasOverride(f.universe, r.addr);
      r.row.classList.toggle('overridden', over);
      if (document.activeElement === r.range) continue;
      const v = buf ? buf[r.addr - 1] : 0;
      r.range.value = v;
      r.val.textContent = v;
    }
  };
  const timer = setInterval(sync, 120);
  sync();
  const release = () => { app.dmx.clearOverrides(f.universe, f.address, p.channels.length); sync(); };
  return h('div', {},
    h('h4', {}, 'Test canale (control manual)'),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Mișcă un fader ca să preiei controlul canalului (suprascrie SoundSwitch/Demo).'),
    h('div', { class: 'grid2', style: { marginBottom: '6px' } },
      h('button', { onclick: () => { p.channels.forEach((c, i) => app.dmx.setOverride(f.universe, f.address + i, locateValue(c))); sync(); } }, '💡 Găsește (Locate)'),
      h('button', { onclick: release }, 'Eliberează')),
    box);
}

function renderPropInspector(app, el, pr) {
  const def = PROP_TYPES[pr.type] || { params: {} };
  const nameInput = h('input', { value: pr.name });
  nameInput.addEventListener('change', () => app.updateItem(pr.id, { name: nameInput.value.trim() || pr.name }));
  const labels = { length: 'Lungime (m)', width: 'Lățime (m)', height: 'Înălțime (m)', depth: 'Adâncime (m)', count: 'Număr persoane', diameter: 'Diametru (m)', drop: 'Tijă (m)', rpm: 'Rotații / minut' };
  const params = { ...def.params, ...pr.params };
  el.append(
    h('h3', {}, def.label || pr.type),
    h('div', { class: 'form' },
      field('Nume', nameInput),
      h('div', { class: 'grid2' }, Object.entries(params).map(([k, v]) => field(labels[k] || k, numberInput(v, (nv) => app.updateItem(pr.id, { params: { ...params, ...app.findItem(pr.id).params, [k]: nv } }, { rebuild: true }), { min: k === 'count' ? 1 : 0.05, step: k === 'count' ? 1 : 0.1, integer: k === 'count' })))),
      pr.type === 'wall' ? field('Culoare', colorInput(pr.color || '#2a2a30', (v) => app.updateItem(pr.id, { color: v }, { rebuild: true }))) : null,
      ...transformSection(app, pr, false),
      h('div', { class: 'grid2' },
        h('button', { onclick: () => app.duplicate(pr.id) }, 'Duplică'),
        h('button', { class: 'danger', onclick: () => app.removeItem(pr.id) }, 'Șterge')),
    ),
  );
}

// ------------------------------------------------------------------ status
export function updateStatus(app) {
  const pill = $('inputStatus');
  const txt = pill.querySelector('.txt');
  const dmx = app.dmx;
  $('demoBtn').classList.toggle('on', dmx.useDemo);
  $('demoBtn').textContent = dmx.useDemo ? '■ Oprește demo' : '▶ Demo';
  let cls = 'wait';
  let text = 'Aștept date Art-Net / sACN…';
  if (!dmx.connected) { cls = 'bad'; text = 'Server oprit – pornește FreeVisualizer'; }
  else if (dmx.useDemo) { cls = 'demo'; text = 'DEMO intern activ'; }
  else if (dmx.receiving) {
    cls = 'ok';
    const now = Date.now();
    const act = [...dmx.activeInputs.values()].filter((a) => now - a.at < 3000);
    const names = act.map((a) => `U${a.display}`).sort().join(', ');
    text = `Primesc DMX · ${Math.round(dmx.packetsPerSecond)} pkt/s · ${names}`;
  }
  pill.className = `status-pill ${cls}`;
  txt.textContent = text;
  const err = dmx.status && (dmx.status.artnet.error || dmx.status.sacn.error);
  pill.title = err ? `Eroare: ${err}` : 'Starea intrării DMX';

  const showHint = dmx.connected && !dmx.useDemo && !dmx.receiving && app.project.fixtures.length > 0 && performance.now() - app.startedAt > 4000;
  $('noSignal').classList.toggle('hidden', !showHint);

  // Live color swatches
  document.querySelectorAll('[data-swatch]').forEach((s) => {
    const st = app.states.get(s.dataset.swatch);
    s.style.background = st ? rgbCss(st.color, Math.max(0.12, st.intensity)) : '#333';
    s.style.boxShadow = st && st.intensity > 0.3 ? `0 0 6px ${rgbCss(st.color)}` : 'none';
  });
}
