// Side panels, inspector and status bar.
import { h, toast, numberInput, field, rgbCss } from './dom.js';
import { KINDS, MOVING_STYLES, channelLabel } from './profiles.js';
import { PROP_TYPES } from './props3d.js';
import { fixtureEnd } from './project.js';
import * as dialogs from './dialogs.js';
import * as ssDialog from './ss-dialog.js';
import { ROOM_STYLES } from './venue3d.js';
import { recordDialog } from './recorder.js';
import { tr, tp, lang, setLang } from './i18n.js';
import { exactGroup, groupMembers } from './groups.js';

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
    language: () => setLang(lang === 'ro' ? 'en' : 'ro'),
    settings: () => dialogs.settingsDialog(app),
    help: () => dialogs.helpDialog(app),
    'add-fixture': () => dialogs.addFixturesDialog(app),
    'import-soundswitch': () => ssDialog.soundSwitchImportDialog(app),
    assistant: () => app.assistant.toggle(),
    'ofl-search': () => dialogs.oflDialog(app),
    'open-fixture-id': () => dialogs.openFixtureId(),
    'new-profile': () => dialogs.profileEditor(app, null),
    'import-profile': () => dialogs.importProfileFile(app),
    fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
    'hide-ui': () => { document.body.classList.toggle('ui-hidden'); app.vis.resize(); if (document.body.classList.contains('ui-hidden')) toast(tr('Apasă H ca să revii la panouri.')); },
    demo: () => app.toggleDemo(),
    record: () => app.license.guard('clips', () => recordDialog(app)),
    license: () => app.license.open(),
    present: () => app.license.guard('present', () => window.freevisDesktop && window.freevisDesktop.togglePresent()),
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
        if (!source) throw new Error(tr('Folderul nu e un proiect SoundSwitch (.ssproj)'));
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
      toast(tr('Am primit „{name}” de pe Fixture.ID', { name: f.name }));
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

  const house = $('houseSlider');
  house.addEventListener('input', () => {
    if (app.project.settings.workLights) app.setSetting('workLights', false);
    app.setSetting('houseLight', parseFloat(house.value));
    renderLightControls(app);
  });
  $('workLightsBtn').addEventListener('click', () => { app.setSetting('workLights', !app.project.settings.workLights); renderLightControls(app); });
  const haze = $('hazeSlider');
  haze.value = app.project.settings.haze;
  haze.addEventListener('input', () => app.setSetting('haze', parseFloat(haze.value)));
  const bloom = $('bloomSlider');
  bloom.value = app.project.settings.bloom;
  bloom.addEventListener('input', () => app.setSetting('bloom', parseFloat(bloom.value)));

  $('demoBtn').addEventListener('click', () => app.toggleDemo());
  $('projectName').addEventListener('change', (e) => { app.project.name = e.target.value.trim() || tr('Proiect nou'); app.saveSoon(); });
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
    toast(tr('Rotire: trage de cercuri – roșu = înclinare față/spate, verde = rotire stânga/dreapta, albastru = înclinare laterală. Mai simplu: sliderele din dreapta sau 🎯 Țintește.'), 'info', 9000);
  }
  document.querySelectorAll('[data-tmode]').forEach((b) => b.classList.toggle('active', b.dataset.tmode === mode));
}

export function toggleLabels(app) {
  app.setSetting('showLabels', !app.project.settings.showLabels);
  $('labelsBtn').classList.toggle('active', app.project.settings.showLabels);
}

function renderLightControls(app) {
  const s = app.project.settings;
  $('houseSlider').value = s.workLights ? 1 : s.houseLight ?? 0.3;
  $('workLightsBtn').classList.toggle('active', !!s.workLights);
}

// ------------------------------------------------------------------ render
export function renderAll(app) {
  $('projectName').value = app.project.name;
  $('hazeSlider').value = app.project.settings.haze;
  $('bloomSlider').value = app.project.settings.bloom;
  renderLightControls(app);
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

/** 🔒 in a list row: click to unlock (shown only for locked items). */
function lockIcon(app, it) {
  if (!it.locked) return null;
  return h('span', { class: 'lock-icon', title: tr('Blocat – click ca să deblochezi'), onclick: (e) => { e.stopPropagation(); app.setLocked([it.id], false); } }, '🔒');
}

/** Groups that have members matching `filter`, above the list. */
function renderGroupRows(app, list, filter) {
  const all = [...app.project.fixtures, ...app.project.props];
  const groups = (app.project.groups || []).filter((g) => all.some((it) => it.groupId === g.id && filter(it)));
  if (!groups.length) return;
  list.append(h('div', { class: 'group-title' }, tr('Grupuri')));
  for (const g of groups) {
    const ids = groupMembers(app.project, g.id);
    const locked = ids.every((id) => app.isLocked(id));
    const selected = ids.every((id) => app.selectedIds.includes(id));
    list.append(h('div', { class: `item group-row ${selected ? 'selected' : ''}`, title: tr('Click: selectează tot grupul'), onclick: () => app.selectGroup(g.id) },
      h('span', { class: 'name' }, `⛓ ${g.name}`),
      h('span', { class: 'meta' }, String(ids.length)),
      h('button', { class: 'icon mini', title: locked ? tr('Deblochează grupul') : tr('Blochează grupul'), onclick: (e) => { e.stopPropagation(); app.setLocked(ids, !locked); } }, locked ? '🔒' : '🔓'),
      h('button', { class: 'icon mini', title: tr('Desfă grupul (obiectele rămân)'), onclick: (e) => { e.stopPropagation(); app.setSelection(ids); app.ungroupSelection(); } }, '✕')));
  }
}

/** Big lock / unlock button for the inspector. */
function lockButton(app, ids) {
  const locked = ids.length && ids.every((id) => app.isLocked(id));
  return h('button', {
    class: `lock-btn ${locked ? 'on' : ''}`,
    title: tr('Blocat = nu se mai poate muta sau roti din greșeală (tasta K)'),
    onclick: () => app.setLocked(ids, !locked),
  }, locked ? tr('🔒 Blocat · click ca să deblochezi') : tr('🔓 Blochează poziția (K)'));
}

function renderFixtureList(app) {
  const list = $('fixtureList');
  const q = $('fixtureFilter').value.toLowerCase().trim();
  const conflicts = app.conflicts();
  const fixtures = [...app.project.fixtures].sort((a, b) => a.universe - b.universe || a.address - b.address);
  list.innerHTML = '';
  renderGroupRows(app, list, (it) => app.isFixture(it.id));
  let lastU = null;
  let shown = 0;
  for (const f of fixtures) {
    const p = app.profile(f.profileId);
    const hay = `${f.name} ${p.name} ${f.universe}.${f.address}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    if (f.universe !== lastU) {
      list.append(h('div', { class: 'group-title' }, tr('Univers {u}', { u: f.universe })));
      lastU = f.universe;
    }
    shown++;
    const end = fixtureEnd(f, p);
    list.append(h('div', {
      class: `item ${app.selectedIds.includes(f.id) ? 'selected' : ''} ${conflicts.has(f.id) ? 'conflict' : ''}`,
      'data-id': f.id,
      title: `${p.name}${conflicts.has(f.id) ? `\n${tr('⚠ Adrese suprapuse!')}` : ''}\n${tr('Ctrl/Cmd+click: adaugă la selecție · Shift+click: interval')}`,
      onclick: (e) => listClick(app, f.id, e, () => [...document.querySelectorAll('#fixtureList .item[data-id]')].map((x) => x.dataset.id)),
      ondblclick: () => app.vis.focusSelected(),
    },
    h('span', { class: 'swatch', 'data-swatch': f.id }),
    h('span', { class: 'name' }, f.name),
    lockIcon(app, f),
    h('span', { class: 'meta' }, `${f.address}–${end}`)));
  }
  if (!app.project.fixtures.length) {
    list.append(h('div', { class: 'muted', style: { padding: '16px 6px' } }, tr('Nicio fixtură încă. Apasă „+ Adaugă fixturi” și alege din bibliotecă (sau caută modelul tău exact în Open Fixture Library).')));
  } else if (!shown) {
    list.append(h('div', { class: 'muted', style: { padding: '8px' } }, tr('Niciun rezultat.')));
  }
  const universes = new Set(app.project.fixtures.map((f) => f.universe));
  const channels = app.project.fixtures.reduce((s, f) => s + app.profile(f.profileId).channels.length, 0);
  $('patchSummary').textContent = [
    tp(app.project.fixtures.length, '1 fixtură', '{n} fixturi'),
    tp(channels, '1 canal', '{n} canale'),
    tp(universes.size, '1 univers', '{n} universuri'),
    conflicts.size ? tp(conflicts.size, '⚠ 1 conflict de adresă', '⚠ {n} conflicte de adresă') : null,
  ].filter(Boolean).join(' · ');
}

function renderPropList(app) {
  const list = $('propList');
  list.innerHTML = '';
  renderGroupRows(app, list, (it) => !app.isFixture(it.id));
  for (const p of app.project.props) {
    list.append(h('div', {
      class: `item ${app.selectedIds.includes(p.id) ? 'selected' : ''}`,
      'data-id': p.id,
      onclick: (e) => listClick(app, p.id, e, () => app.project.props.map((x) => x.id)),
    }, h('span', { class: 'name' }, p.name), lockIcon(app, p), h('span', { class: 'tag' }, (PROP_TYPES[p.type] || {}).label || p.type)));
  }
  if (!app.project.props.length) list.append(h('div', { class: 'muted small' }, tr('Nimic adăugat.')));
}

export function renderProfileList(app) {
  const list = $('profileList');
  const q = $('profileFilter').value.toLowerCase().trim();
  list.innerHTML = '';
  const groups = [
    [tr('Profilele proiectului'), app.project.profiles],
    [tr('Generice (incluse)'), app.builtins],
  ];
  for (const [title, profiles] of groups) {
    const items = profiles.filter((p) => !q || `${p.manufacturer} ${p.name} ${KINDS[p.kind]}`.toLowerCase().includes(q));
    if (!items.length) continue;
    list.append(h('div', { class: 'group-title' }, title));
    for (const p of items) {
      const used = app.project.fixtures.filter((f) => f.profileId === p.id).length;
      list.append(h('div', { class: 'item', title: `${p.manufacturer ? p.manufacturer + ' · ' : ''}${p.name}\n${tp(p.channels.length, '1 canal', '{n} canale')} · ${KINDS[p.kind]}`, onclick: () => dialogs.profileActions(app, p) },
        h('span', { class: 'name' }, p.thumbnail ? h('img', { class: 'profile-thumb', src: `/api/models/${p.thumbnail}`, alt: '' }) : null, p.manufacturer && p.source !== 'builtin' ? `${p.manufacturer} ${p.name}` : p.name),
        p.model ? h('span', { class: 'tag', title: tr('Are model 3D real') }, '3D') : null,
        used ? h('span', { class: 'tag' }, `×${used}`) : null,
        h('span', { class: 'meta' }, `${p.channels.length}ch`)));
    }
  }
}

function renderRoomForm(app) {
  const r = app.project.room;
  const form = $('roomForm');
  form.innerHTML = '';
  const style = h('select', {}, Object.entries(ROOM_STYLES).map(([k, label]) => h('option', { value: k, selected: (r.style || 'dark') === k }, label)));
  style.addEventListener('change', () => app.updateRoom({ style: style.value }));
  form.append(
    field(tr('Tip sală'), style),
    h('div', { class: 'grid3' },
      field(tr('Lățime (m)'), numberInput(r.width, (v) => app.updateRoom({ width: v }), { min: 4, max: 200, step: 1 })),
      field(tr('Adâncime (m)'), numberInput(r.depth, (v) => app.updateRoom({ depth: v }), { min: 4, max: 200, step: 1 })),
      field(tr('Înălțime (m)'), numberInput(r.height, (v) => app.updateRoom({ height: v }), { min: 2, max: 40, step: 0.5 }))),
    h('div', { class: 'grid2' },
      field(tr('Podea'), colorInput(r.floorColor, (v) => app.updateRoom({ floorColor: v }))),
      field(tr('Pereți'), colorInput(r.wallColor, (v) => app.updateRoom({ wallColor: v })))),
    h('label', { class: 'inline' }, checkbox(r.walls !== false, (v) => app.updateRoom({ walls: v })), tr('Pereți')),
    h('label', { class: 'inline' }, checkbox(r.grid !== false, (v) => app.updateRoom({ grid: v })), tr('Grilă pe podea')),
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
  const names = { x: tr('Stânga ↔ dreapta'), y: tr('Înălțime'), z: tr('Spate ↕ față') };
  const wrap = h('div', { class: 'xyz', 'data-xyz': 'position' });
  for (const axis of ['x', 'y', 'z']) {
    const input = numberInput(item.position[axis], (v) => app.updateItem(id, { position: { ...app.findItem(id).position, [axis]: v } }), { step: 0.05 });
    input.dataset.axis = axis;
    wrap.append(h('label', { title: names[axis] }, names[axis], input));
  }
  return wrap;
}

const ROT_AXES = [
  ['x', tr('Înclinare față / spate'), tr('Apleacă fixtura înainte sau înapoi')],
  ['y', tr('Rotire stânga / dreapta'), tr('Rotește fixtura în jurul axei verticale')],
  ['z', tr('Înclinare laterală'), tr('Apleacă fixtura spre stânga sau spre dreapta')],
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

// ------------------------------------------------------------------ move / rotate pad
const PAD_KEY = 'freevis.pad.v1';
function padSteps() {
  try { return { move: 0.1, turn: 15, ...JSON.parse(localStorage.getItem(PAD_KEY) || '{}') }; } catch { return { move: 0.1, turn: 15 }; }
}
function savePadSteps(v) {
  try { localStorage.setItem(PAD_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

/** Button that acts once on press and repeats while held (one undo step per press). */
function holdButton(label, title, act, app) {
  let timer = null;
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
  const b = h('button', { class: 'pad-btn', title }, label);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    act(true);
    timer = setTimeout(() => { timer = setInterval(() => act(false), 90); }, 380);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (timer) { stop(); app.saveSoon(); } });
  return b;
}

/**
 * Control pad for the selection: move left/right, towards/away (relative to the
 * camera), up/down, and rotate on the three axes, with selectable steps.
 */
function movePad(app) {
  const steps = padSteps();
  const stepRow = (key, values, fmt) => {
    const row = h('div', { class: 'pad-steps' }, h('span', { class: 'muted small' }, tr('Pas:')));
    for (const v of values) {
      const b = h('button', { class: steps[key] === v ? 'active' : '' }, fmt(v));
      b.addEventListener('click', () => {
        steps[key] = v;
        savePadSteps(steps);
        row.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      row.append(b);
    }
    return row;
  };
  const mv = (dir) => (record) => app.nudge(dir, steps.move, { record });
  const rt = (axis, sign) => (record) => app.rotateSelection(axis, sign * steps.turn, { record });
  return h('div', { class: 'pad' },
    h('div', { class: 'pad-title' }, tr('Mută'), stepRow('move', [0.01, 0.1, 0.5], (v) => (v < 0.1 ? '1 cm' : v < 0.5 ? '10 cm' : '50 cm'))),
    h('div', { class: 'pad-grid' },
      h('span'), holdButton(tr('⇡ Departe'), tr('Mai departe de tine (în spate)'), mv('away'), app), h('span'),
      h('span'), holdButton(tr('▲ Sus'), tr('Mai sus'), mv('up'), app),
      holdButton(tr('⟵ Stânga'), tr('Spre stânga, cum vezi pe ecran'), mv('left'), app), h('span', { class: 'pad-center' }, '✥'), holdButton(tr('Dreapta ⟶'), tr('Spre dreapta, cum vezi pe ecran'), mv('right'), app),
      h('span'), h('span'),
      h('span'), holdButton(tr('⇣ Spre tine'), tr('Mai aproape de tine (în față)'), mv('toward'), app), h('span'),
      h('span'), holdButton(tr('▼ Jos'), tr('Mai jos'), mv('down'), app)),
    h('div', { class: 'pad-title' }, tr('Rotește'), stepRow('turn', [1, 5, 15, 45, 90], (v) => `${v}°`)),
    h('div', { class: 'pad-rot' },
      holdButton(tr('⟲ Rotire stânga'), tr('Rotește în jurul axei verticale'), rt('y', -1), app), holdButton(tr('Rotire dreapta ⟳'), tr('Rotește în jurul axei verticale'), rt('y', 1), app),
      holdButton(tr('⤒ Înclină înainte'), tr('Apleacă fixtura înainte'), rt('x', 1), app), holdButton(tr('Înclină înapoi ⤓'), tr('Apleacă fixtura înapoi'), rt('x', -1), app),
      holdButton(tr('↶ Lateral stânga'), tr('Apleacă fixtura spre stânga'), rt('z', 1), app), holdButton(tr('Lateral dreapta ↷'), tr('Apleacă fixtura spre dreapta'), rt('z', -1), app)));
}

const MOUNTS = [
  [tr('Pe podea ↑'), { x: 0, y: 0, z: 0 }],
  [tr('Agățat ↓'), { x: 180, y: 0, z: 0 }],
  [tr('Spre public →'), { x: 90, y: 0, z: 0 }],
  [tr('Spre scenă ←'), { x: -90, y: 0, z: 0 }],
];

function aimButton(app) {
  return h('button', {
    class: 'aim-btn',
    title: tr('Apasă, apoi dă click în scenă pe punctul spre care vrei să bată lumina (podea, perete, glob, ring…)'),
    onclick: () => {
      toast(tr('🎯 Dă click în scenă pe punctul spre care să bată lumina (Esc anulează).'), 'info', 5000);
      app.vis.startAim((point) => app.aimSelectionAt(point));
    },
  }, tr('🎯 Țintește un punct'));
}

/** Position, rotation, mounting presets and aiming for one object. */
function transformSection(app, item, isFixture) {
  return [
    movePad(app),
    h('details', { class: 'exact' }, h('summary', {}, tr('Poziție exactă (m)')), positionInputs(app, item.id)),
    h('h4', {}, tr('Orientare')),
    isFixture ? h('div', { class: 'muted small' }, tr('Săgeata galbenă din scenă arată încotro bate lumina.')) : null,
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
  const universe = numberInput(fixtures[0] ? fixtures[0].universe : 1, () => {}, { min: 1, max: 32768, integer: true });
  const start = numberInput(fixtures.length ? Math.min(...fixtures.map((f) => f.address)) : 1, () => {}, { min: 1, max: 512, integer: true });
  const totalCh = fixtures.reduce((s, f) => s + app.profile(f.profileId).channels.length, 0);
  const group = exactGroup(app.project, app.selectedIds);
  let groupHead;
  if (group) {
    const nameInput = h('input', { value: group.name });
    nameInput.addEventListener('change', () => app.renameGroup(group.id, nameInput.value.trim()));
    groupHead = h('div', { class: 'form group-head' },
      field(tr('Nume grup'), nameInput),
      h('button', { title: 'Ctrl+Shift+G', onclick: () => app.ungroupSelection() }, tr('Desfă grupul')));
  } else {
    groupHead = h('button', { class: 'group-make', title: 'Ctrl+G', onclick: () => app.groupSelection() }, tr('⛓ Grupează selecția (Ctrl+G)'));
  }
  // Exact position of the whole selection (middle of the positions).
  const mid = (axis) => { const v = items.map((it) => it.position[axis]); return Math.round(((Math.min(...v) + Math.max(...v)) / 2) * 100) / 100; };
  const centre = h('div', { class: 'grid3' }, [['x', 'X (m)'], ['y', tr('Înălțime (m)')], ['z', 'Z (m)']].map(([axis, label]) => field(label, numberInput(mid(axis), (v) => app.moveSelectionCenterTo(axis, v), { step: 0.1 }))));
  // Props of one type: edit their parameters together.
  const props = items.filter((it) => !app.isFixture(it.id));
  const sameType = props.length > 1 && props.length === n && props.every((p) => p.type === props[0].type) ? props[0].type : null;
  const commonParams = sameType ? { ...(PROP_TYPES[sameType] || {}).params, ...props[0].params } : null;
  const moving = fixtures.filter((f) => app.profile(f.profileId).kind === 'moving');
  el.append(...[
    h('h3', {}, group ? `⛓ ${group.name}` : tr('{n} elemente selectate', { n })),
    groupHead,
    lockButton(app, app.selectedIds),
    h('div', { class: 'sub' }, fixtures.length ? `${tp(fixtures.length, '1 fixtură', '{n} fixturi')} · ${tp(totalCh, '1 canal', '{n} canale')}` : tr('Elemente de scenă')),
    h('div', { class: 'list group-list' }, items.map((it) => h('div', { class: 'item' },
      h('span', { class: 'name' }, it.name),
      app.isFixture(it.id) ? h('span', { class: 'meta' }, `U${it.universe} · ${it.address}`) : null,
      h('button', { class: 'icon', title: tr('Scoate din selecție'), onclick: () => app.toggleSelect(it.id) }, '✕')))),
    h('h4', {}, tr('Mută / rotește tot grupul')),
    movePad(app),
    h('details', { class: 'exact' }, h('summary', {}, tr('Poziția grupului (mijlocul)')), centre),
    commonParams ? h('h4', {}, tr('Dimensiuni (pentru toate)')) : null,
    commonParams ? h('div', { class: 'grid2' }, Object.entries(commonParams).map(([k, v]) => field(PARAM_LABELS()[k] || k, paramInput(sameType, k, v, (nv) => app.updateItems(props.map((p) => p.id), (p) => ({ params: { ...p.params, [k]: nv } }), { rebuild: true }))))) : null,
    moving.length ? h('div', { class: 'grid2' },
      h('label', { class: 'inline' }, checkbox(moving.every((f) => f.invertPan), (v) => app.updateItems(moving.map((f) => f.id), () => ({ invertPan: v }))), tr('Inversează pan')),
      h('label', { class: 'inline' }, checkbox(moving.every((f) => f.invertTilt), (v) => app.updateItems(moving.map((f) => f.id), () => ({ invertTilt: v }))), tr('Inversează tilt'))) : null,
    h('h4', {}, tr('Aliniază și distribuie')),
    h('div', { class: 'grid2' },
      h('button', { title: tr('Toate la aceeași înălțime ca ultimul selectat'), onclick: () => app.alignSelection('y') }, tr('Aceeași înălțime')),
      h('button', { title: tr('Toate pe aceeași linie față/spate'), onclick: () => app.alignSelection('z') }, tr('Aceeași linie Z')),
      h('button', { title: tr('Toate pe aceeași linie stânga/dreapta'), onclick: () => app.alignSelection('x') }, tr('Aceeași linie X'))),
    h('div', { class: 'grid2' },
      h('button', { onclick: () => app.distributeSelection('x') }, tr('Distribuie egal pe X')),
      h('button', { onclick: () => app.distributeSelection('z') }, tr('Distribuie egal pe Z'))),
    fixtures.length ? h('h4', {}, tr('Montaj')) : null,
    fixtures.length ? h('div', { class: 'preset-buttons' }, MOUNTS.map(([label, rot]) => h('button', {
      onclick: () => app.updateItems(fixtures.map((f) => f.id), (f) => ({ rotation: { ...rot, y: f.rotation.y } })),
    }, label))) : null,
    fixtures.length ? aimButton(app) : null,
    fixtures.length ? h('h4', {}, tr('Adrese DMX (de la stânga la dreapta)')) : null,
    fixtures.length ? h('div', { class: 'grid3' },
      field(tr('Univers'), universe), field(tr('Adresă start'), start),
      h('button', { style: { alignSelf: 'end' }, onclick: () => app.readdressSelection(Number(universe.value), Number(start.value)) }, tr('Re-adresează'))) : null,
    fixtures.length ? h('button', { onclick: () => dialogs.changeProfileGroupDialog(app, fixtures) }, tr('Schimbă profilul pentru toate…')) : null,
    fixtures.length ? h('h4', {}, tr('Test')) : null,
    fixtures.length ? h('div', { class: 'grid2' },
      h('button', { onclick: () => fixtures.forEach((f) => app.profile(f.profileId).channels.forEach((c, i) => app.dmx.setOverride(f.universe, f.address + i, locateValue(c)))) }, tr('💡 Găsește toate')),
      h('button', { onclick: () => fixtures.forEach((f) => app.dmx.clearOverrides(f.universe, f.address, app.profile(f.profileId).channels.length)) }, tr('Eliberează toate'))) : null,
    h('h4', {}, tr('Acțiuni')),
    h('div', { class: 'grid2' },
      h('button', { onclick: () => app.duplicateMany(app.selectedIds) }, tr('Duplică grupul')),
      h('button', { class: 'danger', onclick: () => app.removeItems(app.selectedIds) }, tr('Șterge {n}', { n }))),
  ].filter(Boolean));
}

export function renderInspector(app) {
  const el = $('inspector');
  el.innerHTML = '';
  el.className = 'panel right inspector';
  const id = app.selectedId;
  const item = id && app.findItem(id);
  if (!item) {
    el.append(h('div', { class: 'inspector-empty' },
      h('p', {}, tr('Selectează o fixtură sau un element (click în scenă sau în listă).')),
      h('p', { class: 'small' }, tr('Mai multe deodată: Ctrl/Cmd+click, sau Shift + trage cu mouse-ul un dreptunghi în scenă. Ctrl/Cmd+A selectează toate fixturile.')),
      h('p', { class: 'small' }, tr('Scurtături: W mută · E rotește · săgeți / PageUp / PageDown mută · [ ] rotește · F focus · Ctrl+D duplică · Del șterge · H ascunde panourile · D demo · 1–6 camere')),
      h('p', { class: 'small' }, tr('Grupuri și blocare: Ctrl+G grupează · Ctrl+Shift+G desface · Alt+click sau dublu-click = un singur obiect din grup · K blochează / deblochează'))));
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
    h('h3', {}, h('span', { class: 'swatch', 'data-swatch': f.id, style: { width: '12px', height: '12px', borderRadius: '3px', display: 'inline-block' } }), tr('Fixtură')),
    h('div', { class: 'form' },
      field(tr('Nume'), nameInput),
      h('div', { class: 'sub' }, `${p.manufacturer ? p.manufacturer + ' · ' : ''}${p.name} · ${tp(p.channels.length, '1 canal', '{n} canale')} · ${KINDS[p.kind]}${p.kind === 'moving' ? ' ' + (MOVING_STYLES[p.style] || '') : ''}`),
      h('div', { class: 'grid2' },
        field(tr('Univers'), numberInput(f.universe, (v) => app.updateItem(f.id, { universe: v }), { min: 1, max: 32768, integer: true })),
        field(tr('Adresă DMX'), numberInput(f.address, (v) => app.updateItem(f.id, { address: v }), { min: 1, max: 512, integer: true }))),
      h('div', { class: 'muted small' }, tr('Canale {a}–{b} în universul {u}', { a: f.address, b: fixtureEnd(f, p), u: f.universe })),
      conflicts.has(f.id) ? h('div', { class: 'warn-box' }, tr('⚠ Adresele se suprapun cu altă fixtură (sau depășesc 512).')) : null,
      h('button', { onclick: () => dialogs.changeProfileDialog(app, f) }, tr('Schimbă profilul…')),
      lockButton(app, [f.id]),
      ...transformSection(app, f, true),
      p.kind === 'moving' ? h('div', { class: 'grid2' },
        h('label', { class: 'inline' }, checkbox(f.invertPan, (v) => app.updateItem(f.id, { invertPan: v })), tr('Inversează pan')),
        h('label', { class: 'inline' }, checkbox(f.invertTilt, (v) => app.updateItem(f.id, { invertTilt: v })), tr('Inversează tilt'))) : null,
      h('div', { class: 'grid2' },
        h('button', { onclick: () => app.duplicate(f.id) }, tr('Duplică')),
        h('button', { class: 'danger', onclick: () => app.removeItem(f.id) }, tr('Șterge'))),
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
    const row = h('div', { class: 'fader', title: tr('Canal {n}', { n: addr }) }, h('span', { class: 'num' }, i + 1), h('span', { class: 'lbl' }, channelLabel(c)), range, val);
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
    h('h4', {}, tr('Test canale (control manual)')),
    h('div', { class: 'muted small', style: { marginBottom: '6px' } }, tr('Mișcă un fader ca să preiei controlul canalului (suprascrie SoundSwitch/Demo).')),
    h('div', { class: 'grid2', style: { marginBottom: '6px' } },
      h('button', { onclick: () => { p.channels.forEach((c, i) => app.dmx.setOverride(f.universe, f.address + i, locateValue(c))); sync(); } }, tr('💡 Găsește (Locate)')),
      h('button', { onclick: release }, tr('Eliberează'))),
    box);
}

function PARAM_LABELS() {
  return {
    length: tr('Lungime (m)'), width: tr('Lățime (m)'), height: tr('Înălțime (m)'), depth: tr('Adâncime (m)'), count: tr('Număr persoane'), diameter: tr('Diametru (m)'), drop: tr('Tijă (m)'), rpm: tr('Rotații / minut'),
    wheels: tr('Roți'), bar: tr('Bară T (m, 0 = fără)'), legs: tr('Deschidere picioare (m)'), density: tr('Densitate'), size: tr('Mărime oameni'),
  };
}

/** Input for one prop param: a select for choice params (wheels, density), else a number with the type's limits. */
function paramInput(type, k, v, onChange) {
  const def = PROP_TYPES[type] || {};
  const choices = def.choices && def.choices[k];
  if (choices) {
    const sel = h('select', {}, choices.map(([val, label]) => h('option', { value: val, selected: Number(v) === val }, label)));
    sel.addEventListener('change', () => onChange(Number(sel.value)));
    return sel;
  }
  const [min, max] = (def.limits && def.limits[k]) || [k === 'count' ? 1 : 0.05];
  return numberInput(v, onChange, { min, max, step: k === 'count' ? 1 : k === 'size' ? 0.05 : 0.1, integer: k === 'count' });
}

function renderPropInspector(app, el, pr) {
  const def = PROP_TYPES[pr.type] || { params: {} };
  const nameInput = h('input', { value: pr.name });
  nameInput.addEventListener('change', () => app.updateItem(pr.id, { name: nameInput.value.trim() || pr.name }));
  const labels = PARAM_LABELS();
  const params = { ...def.params, ...pr.params };
  el.append(
    h('h3', {}, def.label || pr.type),
    h('div', { class: 'form' },
      field(tr('Nume'), nameInput),
      h('div', { class: 'grid2' }, Object.entries(params).map(([k, v]) => field(labels[k] || k, paramInput(pr.type, k, v, (nv) => app.updateItem(pr.id, { params: { ...params, ...app.findItem(pr.id).params, [k]: nv } }, { rebuild: true }))))),
      pr.type === 'wall' ? field(tr('Culoare'), colorInput(pr.color || '#2a2a30', (v) => app.updateItem(pr.id, { color: v }, { rebuild: true }))) : null,
      lockButton(app, [pr.id]),
      ...transformSection(app, pr, false),
      h('div', { class: 'grid2' },
        h('button', { onclick: () => app.duplicate(pr.id) }, tr('Duplică')),
        h('button', { class: 'danger', onclick: () => app.removeItem(pr.id) }, tr('Șterge'))),
    ),
  );
}

// ------------------------------------------------------------------ status
export function updateStatus(app) {
  const pill = $('inputStatus');
  const txt = pill.querySelector('.txt');
  const dmx = app.dmx;
  $('demoBtn').classList.toggle('on', dmx.useDemo);
  $('demoBtn').textContent = dmx.useDemo ? tr('■ Oprește demo') : '▶ Demo';
  let cls = 'wait';
  let text = tr('Aștept date Art-Net / sACN…');
  if (!dmx.connected) { cls = 'bad'; text = tr('Server oprit – pornește FreeVisualizer'); }
  else if (dmx.useDemo) { cls = 'demo'; text = tr('DEMO intern activ'); }
  else if (dmx.receiving) {
    cls = 'ok';
    const now = Date.now();
    const act = [...dmx.activeInputs.values()].filter((a) => now - a.at < 3000);
    const names = act.map((a) => `U${a.display}`).sort().join(', ');
    text = tr('Primesc DMX · {pps} pkt/s · {u}', { pps: Math.round(dmx.packetsPerSecond), u: names });
  }
  pill.className = `status-pill ${cls}`;
  txt.textContent = text;
  const err = dmx.status && (dmx.status.artnet.error || dmx.status.sacn.error);
  pill.title = err ? tr('Eroare: {err}', { err }) : tr('Starea intrării DMX');

  const showHint = dmx.connected && !dmx.useDemo && !dmx.receiving && app.project.fixtures.length > 0 && performance.now() - app.startedAt > 4000;
  const box = $('noSignal');
  if (!box.dataset.html) box.dataset.html = box.innerHTML;
  box.classList.toggle('hidden', !showHint);
  // Trial over: the box explains why there is no live DMX instead of pointing at SoundSwitch.
  const limited = !app.license.allows('dmx');
  if (showHint && box.dataset.limited !== String(limited)) {
    box.dataset.limited = String(limited);
    if (limited) {
      box.replaceChildren(h('strong', {}, tr('DMX-ul live e oprit: perioada de probă s-a terminat.')),
        h('span', {}, tr('Activează FreeVisualizer ca să vezi din nou show-ul din SoundSwitch. Demo-ul merge în continuare.')),
        h('button', { onclick: () => app.license.open() }, tr('Activează')));
    } else box.innerHTML = box.dataset.html;
  }

  // Live color swatches
  document.querySelectorAll('[data-swatch]').forEach((s) => {
    const st = app.states.get(s.dataset.swatch);
    s.style.background = st ? rgbCss(st.color, Math.max(0.12, st.intensity)) : '#333';
    s.style.boxShadow = st && st.intensity > 0.3 ? `0 0 6px ${rgbCss(st.color)}` : 'none';
  });
}
