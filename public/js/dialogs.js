// Modal dialogs: add fixtures, profile editor, OFL import, projects, settings, help.
import { h, openModal, closeModal, toast, numberInput, field, pickFile } from './dom.js';
import {
  KINDS, MOVING_STYLES, CHANNEL_TYPES, DEFAULT_STROBE_RANGES, DEFAULT_WHEEL, wheelRanges, goboRanges,
  channelLabel, cloneProfile, normalizeProfile, uid,
} from './profiles.js';
import { oflToProfile, listModes } from './ofl-import.js';
import { readGdtf, listGdtfModes, gdtfToProfile, gdtfAssets } from './gdtf-import.js';
import { uploadAsset } from './models3d.js';
import { parseQxf, listQxfModes, qxfToProfile } from './qxf-import.js';
import { parseD4, listD4Modes, d4ToProfile, isD4Xml } from './d4-import.js';
import { fixtureFilesInZip } from './zip-lite.js';
import { importSoundSwitch, venuesFromZip, soundSwitchImportDialog } from './ss-dialog.js';
import { loadBrand, saveBrand } from './recorder.js';
import { tr, tp, lang } from './i18n.js';
import { nextFreeAddress, listServerProjects, loadServerProject, deleteServerProject, downloadJson, nextName } from './project.js';

// ------------------------------------------------------------------ online search
export const FIXTURE_ID_URL = 'https://www.fixture.id/';

/** Opens Fixture.ID: in the desktop app a window whose downloads import themselves. */
export async function openFixtureId(query = '') {
  const q = query.trim();
  if (q) {
    try { await navigator.clipboard.writeText(q); } catch { /* clipboard not allowed: fine */ }
  }
  if (window.freevisDesktop?.openFixtureId) {
    window.freevisDesktop.openFixtureId();
    toast(q
      ? tr('Am deschis Fixture.ID. „{q}” e copiat: lipește-l în căutarea site-ului (Ctrl/Cmd+V). Fișierul descărcat (.d4) se importă singur.', { q })
      : tr('Am deschis Fixture.ID. Fișierul descărcat (.d4) se importă singur în FreeVisualizer.'), 'info', 9000);
  } else {
    window.open(FIXTURE_ID_URL, '_blank', 'noopener');
    toast(q
      ? tr('„{q}” e copiat pentru căutarea pe Fixture.ID. Descarcă fișierul .d4 și trage-l peste fereastra FreeVisualizer.', { q })
      : tr('Descarcă fișierul .d4 de pe Fixture.ID și trage-l peste fereastra FreeVisualizer.'), 'info', 9000);
  }
}

async function importOflFixture(app, key) {
  try {
    toast(tr('Descarc definiția fixturii…'));
    const res = await fetch(`/api/ofl/fixture?key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeModal();
    setTimeout(() => chooseModeAndImport(app, data, key), 0);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/**
 * Results from the online libraries for the text typed in a search box:
 * Open Fixture Library (live) and a row that opens Fixture.ID.
 */
function onlineResults(app) {
  const el = h('div');
  let timer = null;
  let seq = 0;
  let query = '';
  const fixtureIdRow = () => h('div', { class: 'item online-row', onclick: () => openFixtureId(query) },
    h('span', { class: 'name' }, query.length >= 2 ? tr('🔎 Caută „{q}” pe Fixture.ID', { q: query }) : tr('🔎 Caută pe Fixture.ID')),
    h('span', { class: 'meta' }, '.d4 / .gdtf ↗'));
  const render = (body) => {
    el.innerHTML = '';
    el.append(h('div', { class: 'group-title' }, 'Open Fixture Library (online)'));
    if (body) el.append(body);
    el.append(h('div', { class: 'group-title' }, 'Fixture.ID'), fixtureIdRow());
  };
  const note = (text, cls = 'muted') => h('div', { class: cls, style: { padding: '6px 10px' } }, text);
  const run = async () => {
    const my = ++seq;
    if (query.length < 2) { render(note(tr('Scrie cel puțin 2 caractere…'))); return; }
    render(note(tr('Caut…')));
    try {
      const res = await fetch(`/api/ofl/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (my !== seq) return;
      if (!res.ok) throw new Error(data.error || tr('eroare'));
      if (!data.length) { render(note(tr('Nimic în Open Fixture Library. Încearcă pe Fixture.ID ↓'))); return; }
      render(h('div', {}, data.slice(0, 40).map((r) => h('div', { class: 'item', onclick: () => importOflFixture(app, r.key) },
        h('span', { class: 'name' }, `${r.manufacturer} ${r.name}`), h('span', { class: 'tag' }, 'OFL'), h('span', { class: 'meta' }, tr('importă'))))));
    } catch (err) {
      if (my !== seq) return;
      render(note(tr('Open Fixture Library nu răspunde ({err}). Verifică internetul.', { err: err.message }), 'warn-box'));
    }
  };
  return {
    el,
    update(q) {
      query = q.trim();
      clearTimeout(timer);
      if (query.length < 2) { seq++; render(note(tr('Scrie cel puțin 2 caractere…'))); return; }
      timer = setTimeout(run, 300);
    },
  };
}

// ------------------------------------------------------------------ profile picker
function profilePicker(app, selectedId, onPick) {
  let current = selectedId;
  const search = h('input', { type: 'search', placeholder: tr('Caută model sau producător (ex: panther, intimidator, par rgbw…)') });
  const list = h('div', { class: 'pick-list' });
  const online = onlineResults(app);
  const render = () => {
    const q = search.value.toLowerCase().trim();
    list.innerHTML = '';
    const groups = [[tr('Profilele proiectului'), app.project.profiles], [tr('Generice'), app.builtins]];
    let found = 0;
    for (const [title, profiles] of groups) {
      const items = profiles.filter((p) => !q || `${p.manufacturer} ${p.name} ${KINDS[p.kind]}`.toLowerCase().includes(q));
      if (!items.length) continue;
      found += items.length;
      list.append(h('div', { class: 'group-title' }, title));
      for (const p of items) {
        list.append(h('div', {
          class: `item ${p.id === current ? 'selected' : ''}`,
          onclick: () => { current = p.id; onPick(p); render(); },
        }, h('span', { class: 'name' }, p.manufacturer && p.source !== 'builtin' ? `${p.manufacturer} ${p.name}` : p.name), h('span', { class: 'tag' }, KINDS[p.kind]), h('span', { class: 'meta' }, `${p.channels.length}ch`)));
      }
    }
    if (q && !found) list.append(h('div', { class: 'muted', style: { padding: '6px 10px' } }, tr('Niciun profil local. Uită-te mai jos, în bibliotecile online.')));
    list.append(online.el);
  };
  search.addEventListener('input', () => { render(); online.update(search.value); });
  render();
  online.update('');
  setTimeout(() => search.focus(), 50);
  return h('div', { class: 'form' }, search, list,
    h('div', { class: 'muted small' }, tr('Ai deja fișierul (.d4, .gdtf, .json)? Trage-l peste fereastră. Poți crea și un profil nou din Bibliotecă.')));
}

// ------------------------------------------------------------------ add fixtures
export async function addFixturesDialog(app, presetProfileId) {
  const selected = app.selectedId && app.isFixture(app.selectedId) ? app.findItem(app.selectedId) : null;
  let profile = app.profilesById[presetProfileId] || (selected && app.profilesById[selected.profileId]) || app.profilesById['gen-par-rgbw-8'] || app.builtins[0];
  const st = { qty: 4, universe: 1, address: 1, prefix: '', mount: 'floor', x: -3, y: 0, z: 0, spacing: 2 };
  const lastU = app.project.fixtures.length ? Math.max(...app.project.fixtures.map((f) => f.universe)) : 1;
  st.universe = lastU;

  const addrInput = numberInput(1, (v) => { st.address = v; info(); }, { min: 1, max: 512, integer: true });
  const prefixInput = h('input', { placeholder: tr('ex: Spot, Uplight…') });
  prefixInput.addEventListener('input', () => { st.prefix = prefixInput.value; });
  const infoEl = h('div', { class: 'muted small' });
  const titleEl = h('div', { style: { fontWeight: 600 } });

  const autoAddress = () => {
    // Room for all the fixtures in one block (falls back to the first free spot for one).
    const a = nextFreeAddress(app.project, app.profilesById, st.universe, profile.channels.length * st.qty)
      || nextFreeAddress(app.project, app.profilesById, st.universe, profile.channels.length);
    st.address = a || 1;
    addrInput.value = st.address;
  };
  const defaultPrefix = (p) => ({ moving: p.style === 'beam' ? 'Beam' : p.style === 'wash' ? 'Wash' : 'Spot', par: 'Par', bar: tr('Bară LED'), strobe: 'Strobe', blinder: 'Blinder', retro: 'Retro', pinspot: 'Pinspot', spark: tr('Scântei'), lowfog: tr('Fum greu'), laser: 'Laser', fog: tr('Fum') }[p.kind] || tr('Fixtură'));
  const info = () => {
    const ch = profile.channels.length;
    const last = st.address + ch * st.qty - 1;
    titleEl.textContent = profile.name;
    infoEl.textContent = tr('{qty} × {ch} canale → adrese {from}–{to} în universul {u}', { qty: st.qty, ch, from: st.address, to: last, u: st.universe }) + (last > 512 ? tr(' (continuă în universul următor)') : '');
  };
  const onPick = (p) => {
    profile = p;
    if (!st.prefixTouched) { prefixInput.value = defaultPrefix(p); st.prefix = prefixInput.value; }
    if (p.kind === 'moving') { st.mount = 'hang'; mountSel.value = 'hang'; st.y = 3.58; yInput.value = 3.58; }
    autoAddress();
    info();
  };
  prefixInput.addEventListener('change', () => { st.prefixTouched = true; });
  const mountSel = h('select', {}, h('option', { value: 'floor' }, tr('Pe podea (lumină în sus)')), h('option', { value: 'hang' }, tr('Agățat pe truss (în jos)')), h('option', { value: 'front' }, tr('Spre public')), h('option', { value: 'wall' }, tr('Spre perete (wash)')));
  mountSel.addEventListener('change', () => {
    st.mount = mountSel.value;
    if (st.mount === 'hang' && st.y < 1) { st.y = 3.58; yInput.value = 3.58; }
    if (st.mount === 'floor' && st.y > 2) { st.y = 0; yInput.value = 0; }
  });
  const yInput = numberInput(st.y, (v) => { st.y = v; }, { step: 0.1 });

  const content = h('div', { class: 'form' },
    profilePicker(app, profile.id, onPick),
    titleEl,
    h('div', { class: 'grid3' },
      field(tr('Cantitate'), numberInput(st.qty, (v) => { st.qty = v; autoAddress(); info(); }, { min: 1, max: 64, integer: true })),
      field(tr('Univers'), numberInput(st.universe, (v) => { st.universe = v; autoAddress(); info(); }, { min: 1, max: 32768, integer: true })),
      field(tr('Adresă de start'), addrInput)),
    infoEl,
    h('div', { class: 'grid2' }, field(tr('Nume (prefix)'), prefixInput), field(tr('Montaj'), mountSel)),
    h('div', { class: 'grid3' },
      field('Start X (m)', numberInput(st.x, (v) => { st.x = v; }, { step: 0.5 })),
      field(tr('Înălțime Y (m)'), yInput),
      field('Z (m)', numberInput(st.z, (v) => { st.z = v; }, { step: 0.5 }))),
    field(tr('Distanță între fixturi pe X (m)'), numberInput(st.spacing, (v) => { st.spacing = v; }, { step: 0.25 })),
    h('div', { class: 'muted small' }, tr('Sfat: folosește aceleași adrese ca în SoundSwitch (DMX Patch). Poziția o poți ajusta oricând trăgând fixtura cu mouse-ul.')),
  );
  prefixInput.value = defaultPrefix(profile);
  st.prefix = prefixInput.value;
  autoAddress();
  info();

  const res = await openModal(tr('Adaugă fixturi'), content, [
    { label: tr('Anulează'), value: null },
    { label: tr('🖱 Plasează cu mouse-ul'), value: 'place' },
    { label: tr('Adaugă'), primary: true, value: 'add' },
  ]);
  if (res !== 'add' && res !== 'place') return;

  const rot = { floor: { x: 0, y: 0, z: 0 }, hang: { x: 180, y: 0, z: 0 }, front: { x: 90, y: 0, z: 0 }, wall: { x: -15, y: 0, z: 0 } }[st.mount];
  const list = [];
  const names = app.project.fixtures.map((f) => f.name);
  let u = st.universe;
  let a = st.address;
  const ch = profile.channels.length;
  for (let i = 0; i < st.qty; i++) {
    if (a + ch - 1 > 512) { u += 1; a = 1; }
    let name = `${st.prefix || defaultPrefix(profile)} ${i + 1}`;
    if (names.includes(name)) name = nextName(name, names);
    names.push(name);
    list.push({
      id: uid('fx'), name, profileId: profile.id, universe: u, address: a,
      position: { x: Math.round((st.x + i * st.spacing) * 100) / 100, y: st.y, z: st.z }, rotation: { ...rot }, invertPan: false, invertTilt: false,
    });
    a += ch;
  }
  if (res === 'place') { app.placeFixtures(list); return; }
  app.addFixtures(list);
  toast(tr('Am adăugat {n} × {name}', { n: list.length, name: profile.name }));
}

export async function changeProfileGroupDialog(app, fixtures) {
  let chosen = null;
  const res = await openModal(tr('Profil pentru {n} fixturi', { n: fixtures.length }), profilePicker(app, fixtures[0].profileId, (p) => { chosen = p; }), [
    { label: tr('Anulează'), value: null }, { label: tr('Aplică la toate'), primary: true, value: 'ok' },
  ]);
  if (res === 'ok' && chosen) {
    app.updateItems(fixtures.map((f) => f.id), () => ({ profileId: chosen.id }), { rebuild: true });
    if (app.conflicts().size) toast(tr('Atenție: noul profil are alt număr de canale – folosește „Re-adresează”.'), 'error', 6000);
  }
}

export async function changeProfileDialog(app, f) {
  let chosen = app.profile(f.profileId);
  const res = await openModal(tr('Profil pentru „{name}”', { name: f.name }), profilePicker(app, f.profileId, (p) => { chosen = p; }), [
    { label: tr('Anulează'), value: null }, { label: tr('Aplică'), primary: true, value: 'ok' },
  ]);
  if (res === 'ok' && chosen) app.updateItem(f.id, { profileId: chosen.id }, { rebuild: true });
}

// ------------------------------------------------------------------ profile actions & editor
export async function profileActions(app, p) {
  const used = app.project.fixtures.filter((f) => f.profileId === p.id).length;
  const content = h('div', { class: 'form' },
    h('div', { class: 'muted' }, `${p.manufacturer || 'Generic'} · ${KINDS[p.kind]}${p.kind === 'moving' ? ' ' + MOVING_STYLES[p.style] : ''} · ${tr('{n} canale', { n: p.channels.length })} · ${tr('unghi')} ${p.beamAngle[0]}°${p.beamAngle[1] !== p.beamAngle[0] ? '–' + p.beamAngle[1] + '°' : ''}${p.pixels > 1 ? ` · ${tr('{n} pixeli', { n: p.pixels })}` : ''}`),
    h('table', { class: 'channels-table' },
      h('tr', {}, h('th', {}, '#'), h('th', {}, tr('Funcție'))),
      p.channels.map((c, i) => h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, channelLabel(c))))),
    used ? h('div', { class: 'muted small' }, tp(used, 'Folosit de o fixtură în proiect.', 'Folosit de {n} fixturi în proiect.')) : null,
  );
  const buttons = [
    { label: p.source === 'builtin' ? tr('Copiază și editează') : tr('Editează'), onClick: () => { setTimeout(() => profileEditor(app, p), 0); } },
    { label: tr('Export profil'), onClick: () => { downloadJson({ freevisProfile: 1, ...cloneProfile(p) }, `${p.name.replace(/[^\p{L}\p{N} _.-]/gu, '')}.profile.json`); return false; } },
  ];
  if (p.source !== 'builtin') buttons.push({ label: tr('Șterge'), danger: true, onClick: () => app.deleteProfile(p.id) });
  buttons.push({ label: tr('Adaugă în scenă'), primary: true, onClick: () => { setTimeout(() => addFixturesDialog(app, p.id), 0); } });
  await openModal(p.name, content, buttons);
}

function rangesEditor(c, onChange) {
  const wrap = h('div', { class: 'ranges' });
  const kind = c.type;
  const render = () => {
    wrap.innerHTML = '';
    (c.ranges || []).forEach((r, i) => {
      const from = numberInput(r.from, (v) => { r.from = v; onChange(); }, { min: 0, max: 255, integer: true });
      const to = numberInput(r.to, (v) => { r.to = v; onChange(); }, { min: 0, max: 255, integer: true });
      let mid; let extra1 = h('span'); let extra2 = h('span');
      if (kind === 'strobe') {
        mid = h('select', {}, ['open', 'closed', 'strobe', 'pulse', 'random'].map((m) => h('option', { value: m }, { open: tr('Deschis'), closed: tr('Închis'), strobe: 'Strobe', pulse: tr('Puls'), random: tr('Aleator') }[m])));
        mid.value = r.mode || 'open';
        mid.addEventListener('change', () => { r.mode = mid.value; if (r.mode !== 'open' && r.mode !== 'closed') { r.hzFrom ??= 1; r.hzTo ??= 20; } onChange(); render(); });
        if (r.mode !== 'open' && r.mode !== 'closed') {
          extra1 = numberInput(r.hzFrom ?? 1, (v) => { r.hzFrom = v; onChange(); }, { min: 0.1, max: 50, step: 0.5 });
          extra2 = numberInput(r.hzTo ?? 20, (v) => { r.hzTo = v; onChange(); }, { min: 0.1, max: 50, step: 0.5 });
          extra1.title = tr('Hz de la'); extra2.title = tr('Hz până la');
        }
      } else if (kind === 'colorWheel') {
        mid = h('select', {}, h('option', { value: 'color' }, tr('Culoare')), h('option', { value: 'rotate' }, tr('Rotire (scroll)')));
        mid.value = r.mode === 'rotate' ? 'rotate' : 'color';
        mid.addEventListener('change', () => { if (mid.value === 'rotate') { delete r.color; r.mode = 'rotate'; } else { delete r.mode; r.color = '#ffffff'; } onChange(); render(); });
        if (r.mode !== 'rotate') {
          extra1 = h('input', { type: 'color', value: r.color || '#ffffff', style: { padding: '1px', height: '26px' } });
          extra1.addEventListener('change', () => { r.color = extra1.value; onChange(); });
        }
      } else if (kind === 'gobo') {
        mid = numberInput(r.gobo ?? 0, (v) => { r.gobo = v; onChange(); }, { min: 0, max: 30, integer: true });
        mid.title = tr('Gobo (0 = deschis)');
        extra1 = h('label', { class: 'inline', title: 'Shake' }, h('input', { type: 'checkbox', checked: !!r.shake, onchange: (e) => { r.shake = e.target.checked; onChange(); } }), 'shake');
      } else if (kind === 'prism') {
        mid = numberInput(r.prism ?? 0, (v) => { r.prism = v; onChange(); }, { min: 0, max: 8, integer: true });
        mid.title = tr('Fațete (0 = fără prismă)');
      }
      const del = h('button', { class: 'icon', title: tr('Șterge interval'), onclick: () => { c.ranges.splice(i, 1); onChange(); render(); } }, '✕');
      wrap.append(h('div', { class: 'r' }, from, to, mid, extra1, extra2, del));
    });
    wrap.append(h('button', { onclick: () => {
      c.ranges = c.ranges || [];
      const last = c.ranges[c.ranges.length - 1];
      const from = last ? Math.min(255, last.to + 1) : 0;
      const r = { from, to: 255 };
      if (kind === 'strobe') r.mode = 'strobe';
      if (kind === 'colorWheel') r.color = '#ffffff';
      if (kind === 'gobo') r.gobo = 0;
      if (kind === 'prism') r.prism = 3;
      c.ranges.push(r);
      onChange(); render();
    } }, tr('+ interval')));
  };
  render();
  return wrap;
}

const RANGE_TYPES = new Set(['strobe', 'colorWheel', 'gobo', 'prism']);

function defaultRanges(type) {
  if (type === 'strobe') return DEFAULT_STROBE_RANGES.map((r) => ({ ...r }));
  if (type === 'colorWheel') return wheelRanges(DEFAULT_WHEEL);
  if (type === 'gobo') return goboRanges(8);
  if (type === 'prism') return [{ from: 0, to: 127, prism: 0 }, { from: 128, to: 255, prism: 3 }];
  return undefined;
}

/** "Model 3D" block of the profile editor: the real look of the fixture. */
function modelSection(p, rerender) {
  const box = h('div', { class: 'model-box' });
  const info = p.model
    ? (p.model.type === 'gdtf' ? tr('Model 3D din GDTF ({n} piese)', { n: Object.keys(p.model.files).length }) : tr('Model 3D încărcat (.glb)'))
    : tr('Model desenat de FreeVisualizer după tipul fixturii.');
  const upload = h('button', {
    onclick: async () => {
      const f = await pickFile('.glb');
      if (!f) return;
      try {
        toast(tr('Încarc modelul 3D…'));
        const file = await uploadAsset(new Uint8Array(await f.arrayBuffer()), 'glb');
        p.model = { type: 'glb', file, rotX: 0 };
        toast(tr('Model încărcat. Se vede după „Salvează”.'));
        rerender();
      } catch (err) { toast(tr('Nu am putut încărca modelul: {err}', { err: err.message }), 'error'); }
    },
  }, p.model ? tr('Schimbă modelul (.glb)…') : tr('Încarcă model 3D (.glb)…'));
  const orient = h('select', {}, [[0, 'Normal'], [180, tr('Întors')], [90, tr('Culcat (față în sus)')], [-90, tr('Culcat (spate în sus)')]]
    .map(([v, l]) => h('option', { value: v, selected: Number(p.model?.rotX || 0) === v }, l)));
  orient.addEventListener('change', () => { p.model.rotX = Number(orient.value); });
  const query = encodeURIComponent(`${p.manufacturer || ''} ${p.name.replace(/\(.*\)/, '')}`.trim());
  box.append(
    h('h4', {}, tr('Aspect 3D')),
    h('div', { class: 'model-row' },
      p.thumbnail ? h('img', { class: 'thumb', src: `/api/models/${p.thumbnail}`, alt: '' }) : null,
      h('div', { class: 'grow' },
        h('div', { class: 'small' }, info),
        h('div', { class: 'row' }, upload,
          p.model ? h('button', { onclick: () => { delete p.model; rerender(); } }, tr('Folosește modelul desenat')) : null,
          h('a', { href: `https://www.google.com/search?tbm=isch&q=${query}`, target: '_blank', rel: 'noopener', class: 'small' }, tr('🔍 Poze cu aparatul'))),
        p.model ? field(tr('Orientare model'), orient, tr('Dacă modelul apare culcat sau cu capul în jos')) : null,
        h('div', { class: 'muted small' }, tr('Modelele .glb cu piese numite Base / Yoke / Head se mișcă pe pan/tilt. Modelele din fișierele GDTF se iau automat.')))),
  );
  return box;
}

export async function profileEditor(app, source) {
  const p = source ? cloneProfile(source) : normalizeProfile({ id: uid('prof'), name: tr('Profil nou'), manufacturer: '', kind: 'par', source: 'custom', channels: [{ type: 'dimmer' }, { type: 'red' }, { type: 'green' }, { type: 'blue' }] });
  if (p.source === 'builtin') { p.id = uid('prof'); p.source = 'custom'; p.name = tr('{name} (copie)', { name: p.name }); p.manufacturer = ''; }
  p.channels = p.channels.map((c) => ({ ...c }));

  const body = h('div', { class: 'form' });
  const render = () => {
    body.innerHTML = '';
    const name = h('input', { value: p.name });
    name.addEventListener('change', () => { p.name = name.value; });
    const man = h('input', { value: p.manufacturer || '' });
    man.addEventListener('change', () => { p.manufacturer = man.value; });
    const kind = h('select', {}, Object.entries(KINDS).map(([k, v]) => h('option', { value: k }, v)));
    kind.value = p.kind;
    kind.addEventListener('change', () => { p.kind = kind.value; if (p.kind === 'moving' && !p.style) p.style = 'spot'; render(); });
    const style = h('select', {}, Object.entries(MOVING_STYLES).map(([k, v]) => h('option', { value: k }, v)));
    style.value = p.style || 'spot';
    style.addEventListener('change', () => { p.style = style.value; });
    const color = h('input', { type: 'color', value: p.defaultColor || '#ffffff', style: { height: '30px', padding: '2px' } });
    color.addEventListener('change', () => { p.defaultColor = color.value; });

    body.append(
      h('div', { class: 'grid2' }, field(tr('Nume'), name), field(tr('Producător'), man)),
      h('div', { class: 'grid3' },
        field(tr('Tip'), kind),
        p.kind === 'moving' ? field(tr('Stil'), style) : field(tr('Pixeli / celule'), numberInput(p.pixels || 1, (v) => { p.pixels = v; }, { min: 1, max: 64, integer: true })),
        field(tr('Culoare implicită'), color, tr('Culoarea folosită când profilul nu are canale de culoare (ex. halogen, blinder)'))),
      h('div', { class: 'grid3' },
        field(tr('Unghi min (°)'), numberInput(p.beamAngle[0], (v) => { p.beamAngle[0] = v; }, { min: 1, max: 170, step: 1 })),
        field(tr('Unghi max (°) – zoom'), numberInput(p.beamAngle[1], (v) => { p.beamAngle[1] = v; }, { min: 1, max: 170, step: 1 })),
        p.kind === 'moving' ? h('div', { class: 'grid2' },
          field('Pan (°)', numberInput(p.panRange, (v) => { p.panRange = v; }, { min: 0, max: 720, step: 1 })),
          field('Tilt (°)', numberInput(p.tiltRange, (v) => { p.tiltRange = v; }, { min: 0, max: 360, step: 1 })))
          : p.kind === 'retro' ? h('label', { class: 'inline', title: tr('Becurile se aprind/sting lin și se înroșesc când sunt dimate, ca filamentele adevărate') },
            h('input', { type: 'checkbox', checked: p.tungsten !== false, onchange: (e) => { p.tungsten = e.target.checked; } }), tr('Emulare bec cu filament'))
            : h('span')),
      modelSection(p, render),
      h('h4', {}, tr('Canale ({n})', { n: p.channels.length })),
    );

    const table = h('table', { class: 'channels-table' }, h('tr', {}, h('th', {}, '#'), h('th', {}, tr('Funcție')), h('th', {}, 'Pixel'), h('th', {}, tr('Etichetă')), h('th', {}, '')));
    p.channels.forEach((c, i) => {
      const type = h('select', {}, groupedTypeOptions());
      type.value = c.type;
      type.addEventListener('change', () => {
        c.type = type.value;
        if (RANGE_TYPES.has(c.type)) c.ranges = c.ranges && c.ranges.length ? c.ranges : defaultRanges(c.type);
        else delete c.ranges;
        render();
      });
      const pixel = h('input', { type: 'number', min: 1, max: 64, value: c.pixel != null ? c.pixel + 1 : '', placeholder: '–', style: { width: '56px' } });
      pixel.addEventListener('change', () => { const v = parseInt(pixel.value, 10); if (v >= 1) c.pixel = v - 1; else delete c.pixel; });
      const label = h('input', { value: c.label || '' });
      label.addEventListener('change', () => { c.label = label.value || undefined; });
      const actions = h('div', { style: { display: 'flex', gap: '2px' } },
        h('button', { class: 'icon', title: tr('Mută sus'), onclick: () => { if (i > 0) { [p.channels[i - 1], p.channels[i]] = [p.channels[i], p.channels[i - 1]]; render(); } } }, '↑'),
        h('button', { class: 'icon', title: tr('Mută jos'), onclick: () => { if (i < p.channels.length - 1) { [p.channels[i + 1], p.channels[i]] = [p.channels[i], p.channels[i + 1]]; render(); } } }, '↓'),
        h('button', { class: 'icon', title: tr('Șterge'), onclick: () => { p.channels.splice(i, 1); render(); } }, '✕'));
      table.append(h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, type, RANGE_TYPES.has(c.type) ? rangesEditor(c, () => {}) : null), h('td', {}, pixel), h('td', {}, label), h('td', {}, actions)));
    });
    body.append(table);

    const pxCount = h('input', { type: 'number', min: 1, max: 64, value: 8, style: { width: '64px' } });
    const pxPattern = h('select', {}, ['RGB', 'RGBW', 'RGBA', 'RGBWA', 'RGBWAUV'].map((x) => h('option', { value: x }, x)));
    body.append(h('div', { class: 'row' },
      h('button', { onclick: () => { p.channels.push({ type: 'none' }); render(); } }, tr('+ Canal')),
      h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, tr('Generează pixeli:')), pxCount, pxPattern,
      h('button', { onclick: () => {
        const n = Math.max(1, parseInt(pxCount.value, 10) || 1);
        const map = { R: 'red', G: 'green', B: 'blue', W: 'white', A: 'amber', U: 'uv' };
        const letters = pxPattern.value.replace('UV', 'U').split('');
        for (let px = 0; px < n; px++) for (const l of letters) p.channels.push({ type: map[l], pixel: px });
        p.pixels = Math.max(p.pixels || 1, n);
        if (p.kind === 'par') p.kind = 'bar';
        render();
      } }, tr('Adaugă'))));
  };
  render();

  await openModal(source && source.source !== 'builtin' ? tr('Editează: {name}', { name: source.name }) : tr('Profil nou'), body, [
    { label: tr('Anulează'), value: null },
    { label: tr('Salvează profilul'), primary: true, onClick: () => {
      if (!p.channels.length) { toast(tr('Profilul trebuie să aibă cel puțin un canal'), 'error'); return false; }
      const saved = app.saveProfile(p);
      toast(tr('Profil salvat: {name}', { name: saved.name }));
      return true;
    } },
  ], { width: 'min(900px, calc(100vw - 32px))' });
}

function groupedTypeOptions() {
  const groups = {};
  for (const [k, [label, group]] of Object.entries(CHANNEL_TYPES)) (groups[group] ||= []).push(h('option', { value: k }, label));
  return Object.entries(groups).map(([g, opts]) => h('optgroup', { label: g }, opts));
}

// ------------------------------------------------------------------ OFL
/**
 * Pick a DMX mode and import it as a profile.
 * @param source { title, modes: [{ index, name, channels }], convert(index) → profile }
 */
async function chooseModeAndImportGeneric(app, source) {
  const { modes } = source;
  if (!modes.length) { toast(tr('Fixtura nu are moduri DMX definite'), 'error'); return null; }
  // Preselect the mode with the most channels (usually the "full" mode).
  let chosen = modes.reduce((best, m) => (m.channels > best.channels ? m : best), modes[0]).index;
  const list = h('div', { class: 'mode-list' }, modes.map((m) => {
    const radio = h('input', { type: 'radio', name: 'importmode', value: m.index, checked: m.index === chosen });
    radio.addEventListener('change', () => { chosen = m.index; });
    return h('label', {}, radio, h('span', { class: 'grow' }, m.name), h('span', { class: 'muted' }, tr('{n} canale', { n: m.channels })));
  }));
  const res = await openModal(source.title, h('div', { class: 'form' },
    h('p', {}, tr('Alege modul DMX '), h('b', {}, tr('identic')), tr(' cu cel setat pe fixtură și în SoundSwitch:')),
    list), [
    { label: tr('Anulează'), value: null },
    { label: tr('Importă'), value: 'import' },
    { label: tr('Importă și adaugă în scenă'), primary: true, value: 'add' },
  ]);
  if (!res) return null;
  try {
    const profile = source.convert(chosen);
    const existing = app.project.profiles.find((p) => p.id === profile.id);
    const saved = app.saveProfile(existing ? { ...profile, id: existing.id } : profile);
    toast(tr('Profil importat: {name}', { name: saved.name }));
    if (res === 'add') setTimeout(() => addFixturesDialog(app, saved.id), 0);
    return saved;
  } catch (err) {
    toast(tr('Import eșuat: {err}', { err: err.message }), 'error');
    return null;
  }
}

function chooseModeAndImport(app, fixture, key) {
  return chooseModeAndImportGeneric(app, {
    title: `${fixture.__manufacturer || ''} ${fixture.name}`.trim(),
    modes: listModes(fixture),
    convert: (i) => oflToProfile(fixture, i, key),
  });
}

/** Several fixture files in one .zip: let the user pick one. */
async function pickFromArchive(app, files) {
  let chosen = 0;
  const list = h('div', { class: 'mode-list' }, files.map((f, i) => {
    const radio = h('input', { type: 'radio', name: 'zipfile', checked: i === 0 });
    radio.addEventListener('change', () => { chosen = i; });
    return h('label', {}, radio, h('span', { class: 'grow' }, f.name));
  }));
  const res = await openModal(tr('Arhiva conține mai multe fixturi'), h('div', { class: 'form' }, h('p', {}, tr('Alege fișierul de importat:')), list),
    [{ label: tr('Anulează'), value: null }, { label: tr('Continuă'), primary: true, value: 'ok' }]);
  if (!res) return null;
  const f = files[chosen];
  return importFixtureFile(app, new File([f.bytes], f.name));
}

/**
 * Import one fixture file: .d4 (Fixture.ID, Avolites), .gdtf (GDTF Share),
 * .zip with any of these inside, .json (Open Fixture Library or FreeVisualizer), .qxf.
 */
export async function importFixtureFile(app, file) {
  const name = file.name || '';
  const ext = name.toLowerCase().split('.').pop();
  try {
    if (/^soundswitchvenues\.bin$/i.test(name)) return importSoundSwitch(app, { name: 'SoundSwitch', bytes: new Uint8Array(await file.arrayBuffer()) });
    if (ext === 'zip') {
      // A zipped SoundSwitch project (.ssproj) → the whole patch.
      const ss = await venuesFromZip(new Uint8Array(await file.arrayBuffer()));
      if (ss) return importSoundSwitch(app, ss);
      const files = await fixtureFilesInZip(await file.arrayBuffer());
      if (!files.length) throw new Error(tr('arhiva nu conține fișiere .d4, .gdtf sau .json'));
      if (files.length === 1) return importFixtureFile(app, new File([files[0].bytes], files[0].name));
      return pickFromArchive(app, files);
    }
    if (ext === 'gdtf') {
      const buffer = await file.arrayBuffer();
      const ft = await readGdtf(buffer);
      // The manufacturer's 3D model and photo, when the file has them.
      const extra = {};
      try {
        const assets = await gdtfAssets(buffer, ft);
        const files = {};
        for (const [modelName, f] of Object.entries(assets.files)) files[modelName] = await uploadAsset(f.bytes, f.ext);
        if (Object.keys(files).length) extra.model = { type: 'gdtf', files, geometry: assets.geometry };
        if (assets.thumbnail) extra.thumbnail = await uploadAsset(assets.thumbnail, 'png');
      } catch (err) {
        console.warn('GDTF 3D:', err.message);
      }
      return chooseModeAndImportGeneric(app, {
        title: `${ft.attrs.Manufacturer || ''} ${ft.attrs.LongName || ft.attrs.Name || name}`.trim(),
        modes: listGdtfModes(ft),
        convert: (i) => ({ ...gdtfToProfile(ft, i), ...extra }),
      });
    }
    const text = await file.text();
    if (ext === 'd4' || (ext !== 'qxf' && isD4Xml(text))) {
      const root = parseD4(text);
      return chooseModeAndImportGeneric(app, {
        title: `${root.attrs.Company || ''} ${root.attrs.Name || name}`.trim(),
        modes: listD4Modes(root),
        convert: (i) => d4ToProfile(root, i),
      });
    }
    if (ext === 'qxf' || text.trimStart().startsWith('<')) {
      const root = parseQxf(text);
      return chooseModeAndImportGeneric(app, {
        title: `${root.children.find((c) => c.name === 'Manufacturer')?.text || ''} ${root.children.find((c) => c.name === 'Model')?.text || name}`.trim(),
        modes: listQxfModes(root),
        convert: (i) => qxfToProfile(root, i),
      });
    }
    const data = JSON.parse(text);
    if (data.availableChannels && data.modes) return chooseModeAndImport(app, data, data.__key || '');
    if (Array.isArray(data.channels)) {
      const { freevisProfile, ...p } = data;
      p.id = app.profilesById[p.id] ? uid('prof') : (p.id || uid('prof'));
      p.source = 'custom';
      const saved = app.saveProfile(p);
      toast(tr('Profil importat: {name}', { name: saved.name }));
      return saved;
    }
    if (Array.isArray(data.fixtures)) {
      app.checkpoint();
      app.loadProject(data);
      toast(tr('Proiect deschis: „{name}”', { name: app.project.name }));
      return null;
    }
    throw new Error(tr('format necunoscut'));
  } catch (err) {
    toast(tr('Nu am putut importa „{name}”: {err}', { name, err: err.message }), 'error', 6000);
    return null;
  }
}

/** Library search: Open Fixture Library + Fixture.ID. */
export async function oflDialog(app) {
  const search = h('input', { type: 'search', placeholder: tr('Model sau producător (ex: panther, intimidator spot 260, slimpar)') });
  const online = onlineResults(app);
  const results = h('div', { class: 'pick-list' }, online.el);
  search.addEventListener('input', () => online.update(search.value));
  online.update('');
  setTimeout(() => search.focus(), 50);
  await openModal(tr('Caută fixturi'), h('div', { class: 'form' },
    h('p', { class: 'muted' }, tr('Caută în '), h('b', {}, 'Open Fixture Library'), tr(' (import direct) și pe '), h('b', {}, 'Fixture.ID'),
      tr(' (fișiere .d4). Ai nevoie de internet doar la import – apoi profilul e salvat în proiect.')),
    search, results),
  [{ label: tr('Închide'), value: null }]);
}

export async function importProfileFile(app) {
  const file = await pickFile('.d4,.gdtf,.zip,.json,.qxf');
  if (file) await importFixtureFile(app, file);
}

// ------------------------------------------------------------------ projects
export async function newProjectDialog(app) {
  const res = await openModal(tr('Proiect nou'), h('div', { class: 'form' },
    h('p', {}, tr('Alege de unde pornești. Proiectul curent rămâne salvat automat în browser până creezi altul – exportă-l sau salvează-l dacă vrei să-l păstrezi.')),
    h('ul', { class: 'small muted' },
      h('li', {}, h('b', {}, tr('Din SoundSwitch: ')), tr('citește proiectul tău .ssproj – aceleași fixturi, moduri și adrese ca în DMX Map.')),
      h('li', {}, h('b', {}, tr('Nuntă: ')), tr('cabină DJ cu truss, retro-uri, uplight-uri pe pereți, ring de dans cu scântei reci, glob disco, fum greu, laser.')),
      h('li', {}, h('b', {}, 'Club: '), tr('truss cu moving heads, bare LED, strobe, ecran LED.')))), [
    { label: tr('Anulează'), value: null },
    { label: tr('Din SoundSwitch…'), value: 'soundswitch' },
    { label: tr('Proiect gol'), value: 'empty' },
    { label: tr('Rig club'), value: 'club' },
    { label: tr('Rig nuntă'), primary: true, value: 'wedding' },
  ]);
  if (res === 'soundswitch') soundSwitchImportDialog(app);
  else if (res) app.newProject(res);
}

export async function openProjectDialog(app) {
  const list = h('div', { class: 'pick-list' }, h('div', { class: 'muted', style: { padding: '10px' } }, tr('Se încarcă…')));
  const refresh = async () => {
    try {
      const items = await listServerProjects();
      list.innerHTML = '';
      if (!items.length) list.append(h('div', { class: 'muted', style: { padding: '10px' } }, tr('Niciun proiect salvat încă. Folosește „Salvează” (Ctrl+S).')));
      for (const it of items) {
        list.append(h('div', { class: 'item', onclick: async () => {
          try {
            const p = await loadServerProject(it.name);
            app.checkpoint();
            app.loadProject(p);
            closeModal();
            toast(tr('Deschis: {name}', { name: it.name }));
          } catch (err) { toast(err.message, 'error'); }
        } },
        h('span', { class: 'name' }, it.name),
        h('span', { class: 'meta' }, new Date(it.modified).toLocaleString(lang === 'en' ? 'en-GB' : 'ro-RO')),
        h('button', { class: 'icon danger', title: tr('Șterge'), onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(tr('Ștergi proiectul „{name}”?', { name: it.name }))) return;
          await deleteServerProject(it.name);
          refresh();
        } }, '🗑')));
      }
    } catch (err) {
      list.innerHTML = '';
      list.append(h('div', { class: 'warn-box' }, err.message));
    }
  };
  refresh();
  await openModal(tr('Deschide proiect'), h('div', { class: 'form' }, list), [
    { label: tr('Din fișier…'), onClick: () => { setTimeout(() => app.importProject(), 0); } },
    { label: tr('Închide'), value: null },
  ]);
}

// ------------------------------------------------------------------ settings & help
export async function settingsDialog(app) {
  const s = app.project.settings;
  let info = null;
  try { info = await (await fetch('/api/info')).json(); } catch (_) { /* server offline */ }
  const offset = h('select', {},
    h('option', { value: '1' }, tr('Art-Net 0 = Universul 1 (recomandat pentru SoundSwitch)')),
    h('option', { value: '0' }, tr('Art-Net 0 = Universul 0 (numerotare brută)')));
  offset.value = String(s.artnetOffset);
  offset.addEventListener('change', () => { app.setSetting('artnetOffset', Number(offset.value)); app.monitor.refreshUniverses(); });
  const sacn = h('input', { value: info ? info.settings.sacnUniverses.join(', ') : '1, 2, 3, 4' });
  const range = (key, min, max, step) => {
    const el = h('input', { type: 'range', min, max, step, value: s[key] });
    el.addEventListener('input', () => app.setSetting(key, parseFloat(el.value)));
    return el;
  };
  const content = h('div', { class: 'form' },
    h('h4', {}, tr('Intrare DMX')),
    field(tr('Numerotare universuri Art-Net'), offset),
    field(tr('Universuri sACN (E1.31) ascultate'), sacn, tr('Lista universurilor sACN multicast la care se abonează serverul')),
    info ? h('div', { class: 'muted small' }, tr('Server pe portul {port}. IP-urile acestui calculator: {ips}', { port: info.port, ips: info.interfaces.map((i) => `${i.address} (${i.name})`).join(', ') || '—' })) : h('div', { class: 'warn-box' }, tr('Serverul nu răspunde.')),
    h('h4', {}, tr('Branding pentru clipuri video')),
    brandingForm(),
    h('h4', {}, tr('Asistent Claude')),
    await assistantSettings(),
    h('h4', {}, tr('Imagine')),
    field(tr('Lumina din sală (candelabre, ambient)'), range('houseLight', 0, 1, 0.01)),
    field(tr('Putere lumină pe suprafețe (podea/pereți)'), range('lightPower', 0, 3, 0.05)),
    field(tr('Haze / fum'), range('haze', 0, 1, 0.01)),
    field('Glow (bloom)', range('bloom', 0, 2, 0.01)),
  );
  await openModal(tr('Setări'), content, [
    { label: tr('Gata'), primary: true, onClick: async () => {
      const list = sacn.value.split(/[ ,;]+/).map(Number).filter((n) => n >= 1 && n <= 63999);
      try {
        await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sacnUniverses: list }) });
      } catch (_) { /* ignore */ }
      return true;
    } },
  ]);
}

async function assistantSettings() {
  let st = { configured: false, models: {}, model: 'claude-opus-5-5' };
  try { st = await (await fetch('/api/assistant/status')).json(); } catch (_) { /* offline */ }
  const key = h('input', { type: 'password', placeholder: st.configured ? tr('•••••••• (cheie salvată)') : 'sk-ant-…', autocomplete: 'off' });
  key.addEventListener('keydown', (e) => e.stopPropagation());
  const model = h('select', {}, Object.entries(st.models || {}).map(([id, label]) => h('option', { value: id, selected: id === st.model }, label)));
  const msg = h('span', { class: 'muted small' }, st.configured ? (st.source === 'env' ? tr('Cheie din variabila ANTHROPIC_API_KEY.') : tr('Cheie salvată pe acest calculator.')) : tr('Nicio cheie salvată.'));
  const post = async (body, text) => {
    const res = await fetch('/api/assistant/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { msg.textContent = text; key.value = ''; }
  };
  return h('div', { class: 'form' },
    h('div', { class: 'grid2' }, field(tr('Cheie API'), key), field('Model', model)),
    h('div', { class: 'row' },
      h('button', { onclick: () => post({ ...(key.value ? { apiKey: key.value } : {}), model: model.value }, tr('Salvat.')) }, tr('Salvează')),
      h('button', { onclick: () => post({ apiKey: '' }, tr('Cheia a fost ștearsă.')) }, tr('Șterge cheia')),
      msg),
    h('div', { class: 'muted small' }, tr('Cheia rămâne doar pe acest calculator și nu este afișată în pagină. Costul se plătește direct la Anthropic, după consum. '),
      h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, tr('Obține o cheie ↗'))));
}

function brandingForm() {
  const brand = loadBrand();
  const text = h('input', { value: brand.text || '', placeholder: tr('ex: DJ Matei') });
  const sub = h('input', { value: brand.subtitle || '', placeholder: tr('ex: djmatei.ro') });
  const preview = h('div', { class: 'row' });
  const renderPreview = () => {
    preview.innerHTML = '';
    if (brand.logo) {
      preview.append(h('img', { src: brand.logo, class: 'brand-logo', alt: 'Logo' }),
        h('button', { onclick: () => { brand.logo = null; saveBrand(brand); renderPreview(); } }, tr('Șterge logo')));
    } else {
      preview.append(h('span', { class: 'muted small' }, tr('Niciun logo încărcat.')));
    }
  };
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp' });
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    // Downscale so it fits comfortably in local storage.
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      brand.logo = c.toDataURL('image/png');
      saveBrand(brand);
      renderPreview();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
  const save = () => { brand.text = text.value.trim(); brand.subtitle = sub.value.trim(); saveBrand(brand); };
  text.addEventListener('change', save);
  sub.addEventListener('change', save);
  renderPreview();
  return h('div', { class: 'form' },
    h('div', { class: 'grid2' }, field(tr('Nume'), text), field('Site / Instagram', sub)),
    field(tr('Logo (PNG transparent recomandat)'), file),
    preview);
}

export async function helpDialog(app) {
  let ips = '';
  try { const info = await (await fetch('/api/info')).json(); ips = info.interfaces.map((i) => i.address).join(', '); } catch (_) { /* offline */ }
  const content = h('div', { class: 'form' },
    h('h4', {}, tr('SoundSwitch pe același calculator')),
    h('ol', {},
      h('li', {}, tr('Pornește '), h('b', {}, tr('întâi FreeVisualizer')), tr(', apoi SoundSwitch.')),
      h('li', {}, tr('În SoundSwitch: '), h('code', {}, 'Preferences → Hardware'), tr(' → bifează '), h('b', {}, 'Localhost Art-Net Node'), tr(' (disponibil din SoundSwitch 2.9).')),
      h('li', {}, tr('Dacă nu apare imediat, repornește SoundSwitch (el caută nodurile Art-Net la pornire).')),
      h('li', {}, tr('În FreeVisualizer adaugă aceleași fixturi, cu '), h('b', {}, tr('același univers, aceeași adresă DMX și același mod (nr. de canale)')), tr(' ca în DMX Patch-ul din SoundSwitch.')),
      h('li', {}, tr('Indicatorul din dreapta sus devine verde: „Primesc DMX”. Gata – pune muzică și Autoloops!'))),
    h('h4', {}, tr('SoundSwitch pe alt calculator (în rețea)')),
    h('ol', {},
      h('li', {}, tr('Ambele calculatoare în aceeași rețea, ideal prin cablu (multe routere Wi-Fi blochează Art-Net).')),
      h('li', {}, tr('În SoundSwitch alege nodul Art-Net „FreeVisualizer” sau IP-ul acestui calculator: '), h('code', {}, ips || tr('vezi Setări'))),
      h('li', {}, tr('Permite aplicația Node.js în firewall (porturile UDP 6454 pentru Art-Net și 5568 pentru sACN).'))),
    h('h4', {}, tr('Fixturile din SoundSwitch')),
    h('ol', {},
      h('li', {}, tr('Fixturi → '), h('b', {}, tr('⇪ Importă din SoundSwitch')), tr(' și alegi proiectul (folderul .ssproj din Muzică → SoundSwitch). Sau tragi folderul peste fereastră.')),
      h('li', {}, tr('Primești aceleași fixturi, moduri și adrese ca în DMX Map. Le muți apoi unde sunt în sală.')),
      h('li', {}, tr('Ai schimbat ceva în SoundSwitch? Salvezi proiectul acolo și imporți din nou cu „Actualizează proiectul curent” – pozițiile rămân.'))),
    h('h4', {}, tr('Fixturi care nu sunt în listă')),
    h('ol', {},
      h('li', {}, tr('În „Adaugă fixturi” scrie modelul: caută deodată în profilele tale, în '), h('b', {}, 'Open Fixture Library'), tr(' și îți dă un buton spre '), h('b', {}, 'Fixture.ID'), '.'),
      h('li', {}, tr('De pe Fixture.ID descarci fișierul '), h('b', {}, '.d4'), tr('. În aplicația desktop se importă singur; în browser îl tragi peste fereastră.')),
      h('li', {}, tr('Alege '), h('b', {}, tr('același mod DMX')), tr(' ca în SoundSwitch.'))),
    h('h4', {}, tr('Probleme frecvente')),
    h('ol', {},
      h('li', {}, h('b', {}, tr('Universul nu se potrivește: ')), tr('deschide tab-ul DMX – vezi ce universuri sosesc. Poți schimba numerotarea Art-Net din Setări.')),
      h('li', {}, h('b', {}, tr('Culorile/mișcarea sunt greșite: ')), tr('modul DMX al profilului diferă de cel din SoundSwitch. Folosește „Test canale” din inspector ca să verifici fiecare canal.')),
      h('li', {}, h('b', {}, tr('Portul 6454 e ocupat: ')), tr('închide alte vizualizatoare / SoundSwitch, pornește FreeVisualizer, apoi SoundSwitch.'))),
    h('h4', {}, tr('Scurtături')),
    h('p', { class: 'small' }, tr('Ctrl/Cmd+click sau Shift+trage = selecție multiplă · Ctrl/Cmd+A toate · W mută · E rotește · săgeți/PageUp/PageDown mută · [ ] rotesc · F centrează pe selecție · Ctrl+D duplică · Del șterge · Ctrl+Z / Ctrl+Y anulează/refă · Ctrl+S salvează · H ascunde panourile (mod prezentare) · D demo · L etichete · 1–6 camere')),
  );
  await openModal(tr('Conectare SoundSwitch'), content, [{ label: tr('Am înțeles'), primary: true, value: null }]);
}
