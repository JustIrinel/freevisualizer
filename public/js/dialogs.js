// Modal dialogs: add fixtures, profile editor, OFL import, projects, settings, help.
import { h, openModal, closeModal, toast, numberInput, field, pickFile } from './dom.js';
import {
  KINDS, MOVING_STYLES, CHANNEL_TYPES, DEFAULT_STROBE_RANGES, DEFAULT_WHEEL, wheelRanges, goboRanges,
  channelLabel, cloneProfile, normalizeProfile, uid,
} from './profiles.js';
import { oflToProfile, listModes } from './ofl-import.js';
import { loadBrand, saveBrand } from './recorder.js';
import { nextFreeAddress, listServerProjects, loadServerProject, deleteServerProject, downloadJson, nextName } from './project.js';

// ------------------------------------------------------------------ profile picker
function profilePicker(app, selectedId, onPick) {
  let current = selectedId;
  const search = h('input', { type: 'search', placeholder: 'Caută (ex: spot, par, bară, chauvet…)' });
  const list = h('div', { class: 'pick-list' });
  const render = () => {
    const q = search.value.toLowerCase().trim();
    list.innerHTML = '';
    const groups = [['Profilele proiectului', app.project.profiles], ['Generice', app.builtins]];
    for (const [title, profiles] of groups) {
      const items = profiles.filter((p) => !q || `${p.manufacturer} ${p.name} ${KINDS[p.kind]}`.toLowerCase().includes(q));
      if (!items.length) continue;
      list.append(h('div', { class: 'group-title' }, title));
      for (const p of items) {
        list.append(h('div', {
          class: `item ${p.id === current ? 'selected' : ''}`,
          onclick: () => { current = p.id; onPick(p); render(); },
        }, h('span', { class: 'name' }, p.manufacturer && p.source !== 'builtin' ? `${p.manufacturer} ${p.name}` : p.name), h('span', { class: 'tag' }, KINDS[p.kind]), h('span', { class: 'meta' }, `${p.channels.length}ch`)));
      }
    }
  };
  search.addEventListener('input', render);
  render();
  setTimeout(() => search.focus(), 50);
  return h('div', { class: 'form' }, search, list,
    h('div', { class: 'muted small' }, 'Nu găsești modelul tău? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); closeModal(); oflDialog(app); } }, 'Caută-l în Open Fixture Library'), ' (peste 1000 de modele) sau creează un profil nou.'));
}

// ------------------------------------------------------------------ add fixtures
export async function addFixturesDialog(app, presetProfileId) {
  const selected = app.selectedId && app.isFixture(app.selectedId) ? app.findItem(app.selectedId) : null;
  let profile = app.profilesById[presetProfileId] || (selected && app.profilesById[selected.profileId]) || app.profilesById['gen-par-rgbw-8'] || app.builtins[0];
  const st = { qty: 4, universe: 1, address: 1, prefix: '', mount: 'floor', x: -3, y: 0, z: 0, spacing: 2 };
  const lastU = app.project.fixtures.length ? Math.max(...app.project.fixtures.map((f) => f.universe)) : 1;
  st.universe = lastU;

  const addrInput = numberInput(1, (v) => { st.address = v; info(); }, { min: 1, max: 512, integer: true });
  const prefixInput = h('input', { placeholder: 'ex: Spot, Uplight…' });
  prefixInput.addEventListener('input', () => { st.prefix = prefixInput.value; });
  const infoEl = h('div', { class: 'muted small' });
  const titleEl = h('div', { style: { fontWeight: 600 } });

  const autoAddress = () => {
    const a = nextFreeAddress(app.project, app.profilesById, st.universe, profile.channels.length);
    st.address = a || 1;
    addrInput.value = st.address;
  };
  const defaultPrefix = (p) => ({ moving: p.style === 'beam' ? 'Beam' : p.style === 'wash' ? 'Wash' : 'Spot', par: 'Par', bar: 'Bară LED', strobe: 'Strobe', blinder: 'Blinder', retro: 'Retro', pinspot: 'Pinspot', spark: 'Scântei', lowfog: 'Fum greu', laser: 'Laser', fog: 'Fum' }[p.kind] || 'Fixtură');
  const info = () => {
    const ch = profile.channels.length;
    const last = st.address + ch * st.qty - 1;
    titleEl.textContent = profile.name;
    infoEl.textContent = `${st.qty} × ${ch} canale → adrese ${st.address}–${last} în universul ${st.universe}${last > 512 ? ' (continuă în universul următor)' : ''}`;
  };
  const onPick = (p) => {
    profile = p;
    if (!st.prefixTouched) { prefixInput.value = defaultPrefix(p); st.prefix = prefixInput.value; }
    if (p.kind === 'moving') { st.mount = 'hang'; mountSel.value = 'hang'; st.y = 3.58; yInput.value = 3.58; }
    autoAddress();
    info();
  };
  prefixInput.addEventListener('change', () => { st.prefixTouched = true; });
  const mountSel = h('select', {}, h('option', { value: 'floor' }, 'Pe podea (lumină în sus)'), h('option', { value: 'hang' }, 'Agățat pe truss (în jos)'), h('option', { value: 'front' }, 'Spre public'), h('option', { value: 'wall' }, 'Spre perete (wash)'));
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
      field('Cantitate', numberInput(st.qty, (v) => { st.qty = v; info(); }, { min: 1, max: 64, integer: true })),
      field('Univers', numberInput(st.universe, (v) => { st.universe = v; autoAddress(); info(); }, { min: 1, max: 32768, integer: true })),
      field('Adresă de start', addrInput)),
    infoEl,
    h('div', { class: 'grid2' }, field('Nume (prefix)', prefixInput), field('Montaj', mountSel)),
    h('div', { class: 'grid3' },
      field('Start X (m)', numberInput(st.x, (v) => { st.x = v; }, { step: 0.5 })),
      field('Înălțime Y (m)', yInput),
      field('Z (m)', numberInput(st.z, (v) => { st.z = v; }, { step: 0.5 }))),
    field('Distanță între fixturi pe X (m)', numberInput(st.spacing, (v) => { st.spacing = v; }, { step: 0.25 })),
    h('div', { class: 'muted small' }, 'Sfat: folosește aceleași adrese ca în SoundSwitch (DMX Patch). Poziția o poți ajusta oricând trăgând fixtura cu mouse-ul.'),
  );
  prefixInput.value = defaultPrefix(profile);
  st.prefix = prefixInput.value;
  autoAddress();
  info();

  const res = await openModal('Adaugă fixturi', content, [
    { label: 'Anulează', value: null },
    { label: 'Adaugă', primary: true, value: 'add' },
  ]);
  if (res !== 'add') return;

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
  app.addFixtures(list);
  toast(`Am adăugat ${list.length} × ${profile.name}`);
}

export async function changeProfileDialog(app, f) {
  let chosen = app.profile(f.profileId);
  const res = await openModal(`Profil pentru „${f.name}”`, profilePicker(app, f.profileId, (p) => { chosen = p; }), [
    { label: 'Anulează', value: null }, { label: 'Aplică', primary: true, value: 'ok' },
  ]);
  if (res === 'ok' && chosen) app.updateItem(f.id, { profileId: chosen.id }, { rebuild: true });
}

// ------------------------------------------------------------------ profile actions & editor
export async function profileActions(app, p) {
  const used = app.project.fixtures.filter((f) => f.profileId === p.id).length;
  const content = h('div', { class: 'form' },
    h('div', { class: 'muted' }, `${p.manufacturer || 'Generic'} · ${KINDS[p.kind]}${p.kind === 'moving' ? ' ' + MOVING_STYLES[p.style] : ''} · ${p.channels.length} canale · unghi ${p.beamAngle[0]}°${p.beamAngle[1] !== p.beamAngle[0] ? '–' + p.beamAngle[1] + '°' : ''}${p.pixels > 1 ? ` · ${p.pixels} pixeli` : ''}`),
    h('table', { class: 'channels-table' },
      h('tr', {}, h('th', {}, '#'), h('th', {}, 'Funcție')),
      p.channels.map((c, i) => h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, channelLabel(c))))),
    used ? h('div', { class: 'muted small' }, `Folosit de ${used} fixturi în proiect.`) : null,
  );
  const buttons = [
    { label: p.source === 'builtin' ? 'Copiază și editează' : 'Editează', onClick: () => { setTimeout(() => profileEditor(app, p), 0); } },
    { label: 'Export profil', onClick: () => { downloadJson({ freevisProfile: 1, ...cloneProfile(p) }, `${p.name.replace(/[^\p{L}\p{N} _.-]/gu, '')}.profile.json`); return false; } },
  ];
  if (p.source !== 'builtin') buttons.push({ label: 'Șterge', danger: true, onClick: () => app.deleteProfile(p.id) });
  buttons.push({ label: 'Adaugă în scenă', primary: true, onClick: () => { setTimeout(() => addFixturesDialog(app, p.id), 0); } });
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
        mid = h('select', {}, ['open', 'closed', 'strobe', 'pulse', 'random'].map((m) => h('option', { value: m }, { open: 'Deschis', closed: 'Închis', strobe: 'Strobe', pulse: 'Puls', random: 'Aleator' }[m])));
        mid.value = r.mode || 'open';
        mid.addEventListener('change', () => { r.mode = mid.value; if (r.mode !== 'open' && r.mode !== 'closed') { r.hzFrom ??= 1; r.hzTo ??= 20; } onChange(); render(); });
        if (r.mode !== 'open' && r.mode !== 'closed') {
          extra1 = numberInput(r.hzFrom ?? 1, (v) => { r.hzFrom = v; onChange(); }, { min: 0.1, max: 50, step: 0.5 });
          extra2 = numberInput(r.hzTo ?? 20, (v) => { r.hzTo = v; onChange(); }, { min: 0.1, max: 50, step: 0.5 });
          extra1.title = 'Hz de la'; extra2.title = 'Hz până la';
        }
      } else if (kind === 'colorWheel') {
        mid = h('select', {}, h('option', { value: 'color' }, 'Culoare'), h('option', { value: 'rotate' }, 'Rotire (scroll)'));
        mid.value = r.mode === 'rotate' ? 'rotate' : 'color';
        mid.addEventListener('change', () => { if (mid.value === 'rotate') { delete r.color; r.mode = 'rotate'; } else { delete r.mode; r.color = '#ffffff'; } onChange(); render(); });
        if (r.mode !== 'rotate') {
          extra1 = h('input', { type: 'color', value: r.color || '#ffffff', style: { padding: '1px', height: '26px' } });
          extra1.addEventListener('change', () => { r.color = extra1.value; onChange(); });
        }
      } else if (kind === 'gobo') {
        mid = numberInput(r.gobo ?? 0, (v) => { r.gobo = v; onChange(); }, { min: 0, max: 30, integer: true });
        mid.title = 'Gobo (0 = deschis)';
        extra1 = h('label', { class: 'inline', title: 'Shake' }, h('input', { type: 'checkbox', checked: !!r.shake, onchange: (e) => { r.shake = e.target.checked; onChange(); } }), 'shake');
      } else if (kind === 'prism') {
        mid = numberInput(r.prism ?? 0, (v) => { r.prism = v; onChange(); }, { min: 0, max: 8, integer: true });
        mid.title = 'Fațete (0 = fără prismă)';
      }
      const del = h('button', { class: 'icon', title: 'Șterge interval', onclick: () => { c.ranges.splice(i, 1); onChange(); render(); } }, '✕');
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
    } }, '+ interval'));
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

export async function profileEditor(app, source) {
  const p = source ? cloneProfile(source) : normalizeProfile({ id: uid('prof'), name: 'Profil nou', manufacturer: '', kind: 'par', source: 'custom', channels: [{ type: 'dimmer' }, { type: 'red' }, { type: 'green' }, { type: 'blue' }] });
  if (p.source === 'builtin') { p.id = uid('prof'); p.source = 'custom'; p.name = `${p.name} (copie)`; p.manufacturer = ''; }
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
      h('div', { class: 'grid2' }, field('Nume', name), field('Producător', man)),
      h('div', { class: 'grid3' },
        field('Tip', kind),
        p.kind === 'moving' ? field('Stil', style) : field('Pixeli / celule', numberInput(p.pixels || 1, (v) => { p.pixels = v; }, { min: 1, max: 64, integer: true })),
        field('Culoare implicită', color, 'Culoarea folosită când profilul nu are canale de culoare (ex. halogen, blinder)')),
      h('div', { class: 'grid3' },
        field('Unghi min (°)', numberInput(p.beamAngle[0], (v) => { p.beamAngle[0] = v; }, { min: 1, max: 170, step: 1 })),
        field('Unghi max (°) – zoom', numberInput(p.beamAngle[1], (v) => { p.beamAngle[1] = v; }, { min: 1, max: 170, step: 1 })),
        p.kind === 'moving' ? h('div', { class: 'grid2' },
          field('Pan (°)', numberInput(p.panRange, (v) => { p.panRange = v; }, { min: 0, max: 720, step: 1 })),
          field('Tilt (°)', numberInput(p.tiltRange, (v) => { p.tiltRange = v; }, { min: 0, max: 360, step: 1 })))
          : p.kind === 'retro' ? h('label', { class: 'inline', title: 'Becurile se aprind/sting lin și se înroșesc când sunt dimate, ca filamentele adevărate' },
            h('input', { type: 'checkbox', checked: p.tungsten !== false, onchange: (e) => { p.tungsten = e.target.checked; } }), 'Emulare bec cu filament')
            : h('span')),
      h('h4', {}, `Canale (${p.channels.length})`),
    );

    const table = h('table', { class: 'channels-table' }, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Funcție'), h('th', {}, 'Pixel'), h('th', {}, 'Etichetă'), h('th', {}, '')));
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
        h('button', { class: 'icon', title: 'Mută sus', onclick: () => { if (i > 0) { [p.channels[i - 1], p.channels[i]] = [p.channels[i], p.channels[i - 1]]; render(); } } }, '↑'),
        h('button', { class: 'icon', title: 'Mută jos', onclick: () => { if (i < p.channels.length - 1) { [p.channels[i + 1], p.channels[i]] = [p.channels[i], p.channels[i + 1]]; render(); } } }, '↓'),
        h('button', { class: 'icon', title: 'Șterge', onclick: () => { p.channels.splice(i, 1); render(); } }, '✕'));
      table.append(h('tr', {}, h('td', { class: 'muted' }, i + 1), h('td', {}, type, RANGE_TYPES.has(c.type) ? rangesEditor(c, () => {}) : null), h('td', {}, pixel), h('td', {}, label), h('td', {}, actions)));
    });
    body.append(table);

    const pxCount = h('input', { type: 'number', min: 1, max: 64, value: 8, style: { width: '64px' } });
    const pxPattern = h('select', {}, ['RGB', 'RGBW', 'RGBA', 'RGBWA', 'RGBWAUV'].map((x) => h('option', { value: x }, x)));
    body.append(h('div', { class: 'row' },
      h('button', { onclick: () => { p.channels.push({ type: 'none' }); render(); } }, '+ Canal'),
      h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, 'Generează pixeli:'), pxCount, pxPattern,
      h('button', { onclick: () => {
        const n = Math.max(1, parseInt(pxCount.value, 10) || 1);
        const map = { R: 'red', G: 'green', B: 'blue', W: 'white', A: 'amber', U: 'uv' };
        const letters = pxPattern.value.replace('UV', 'U').split('');
        for (let px = 0; px < n; px++) for (const l of letters) p.channels.push({ type: map[l], pixel: px });
        p.pixels = Math.max(p.pixels || 1, n);
        if (p.kind === 'par') p.kind = 'bar';
        render();
      } }, 'Adaugă')));
  };
  render();

  await openModal(source && source.source !== 'builtin' ? `Editează: ${source.name}` : 'Profil nou', body, [
    { label: 'Anulează', value: null },
    { label: 'Salvează profilul', primary: true, onClick: () => {
      if (!p.channels.length) { toast('Profilul trebuie să aibă cel puțin un canal', 'error'); return false; }
      const saved = app.saveProfile(p);
      toast(`Profil salvat: ${saved.name}`);
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
async function chooseModeAndImport(app, fixture, key) {
  const modes = listModes(fixture);
  if (!modes.length) { toast('Fixtura nu are moduri definite', 'error'); return null; }
  let chosen = modes.length - 1;
  // Prefer the mode with most channels that is a typical "full" mode.
  chosen = modes.reduce((best, m) => (m.channels > modes[best].channels ? m.index : best), 0);
  const list = h('div', { class: 'mode-list' }, modes.map((m) => {
    const radio = h('input', { type: 'radio', name: 'oflmode', value: m.index, checked: m.index === chosen });
    radio.addEventListener('change', () => { chosen = m.index; });
    return h('label', {}, radio, h('span', { class: 'grow' }, m.name), h('span', { class: 'muted' }, `${m.channels} canale`));
  }));
  const res = await openModal(`${fixture.__manufacturer || ''} ${fixture.name}`.trim(), h('div', { class: 'form' },
    h('p', {}, 'Alege modul DMX ', h('b', {}, 'identic'), ' cu cel setat pe fixtură și în SoundSwitch:'),
    list), [
    { label: 'Anulează', value: null },
    { label: 'Importă', value: 'import' },
    { label: 'Importă și adaugă în scenă', primary: true, value: 'add' },
  ]);
  if (!res) return null;
  try {
    const profile = oflToProfile(fixture, chosen, key);
    const existing = app.project.profiles.find((p) => p.id === profile.id);
    const saved = app.saveProfile(existing ? { ...profile, id: existing.id } : profile);
    toast(`Profil importat: ${saved.name}`);
    if (res === 'add') setTimeout(() => addFixturesDialog(app, saved.id), 0);
    return saved;
  } catch (err) {
    toast(`Import eșuat: ${err.message}`, 'error');
    return null;
  }
}

export async function oflDialog(app) {
  const search = h('input', { type: 'search', placeholder: 'Model sau producător (ex: intimidator spot 260, slimpar, colorband)' });
  const results = h('div', { class: 'pick-list' }, h('div', { class: 'muted', style: { padding: '10px' } }, 'Scrie cel puțin 2 caractere…'));
  let timer = null;
  let seq = 0;
  const run = async () => {
    const q = search.value.trim();
    if (q.length < 2) return;
    const my = ++seq;
    results.innerHTML = '';
    results.append(h('div', { class: 'muted', style: { padding: '10px' } }, 'Caut…'));
    try {
      const res = await fetch(`/api/ofl/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (my !== seq) return;
      results.innerHTML = '';
      if (!res.ok) throw new Error(data.error || 'eroare');
      if (!data.length) results.append(h('div', { class: 'muted', style: { padding: '10px' } }, 'Niciun rezultat. Încearcă alt cuvânt (ex. doar numele modelului).'));
      for (const r of data) {
        results.append(h('div', { class: 'item', onclick: () => loadFixture(r.key) },
          h('span', { class: 'name' }, `${r.manufacturer} – ${r.name}`), h('span', { class: 'meta' }, r.key)));
      }
    } catch (err) {
      if (my !== seq) return;
      results.innerHTML = '';
      results.append(h('div', { class: 'warn-box' }, err.message));
    }
  };
  const loadFixture = async (key) => {
    try {
      toast('Descarc definiția fixturii…');
      const res = await fetch(`/api/ofl/fixture?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      closeModal();
      setTimeout(() => chooseModeAndImport(app, data, key), 0);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  setTimeout(() => search.focus(), 50);
  await openModal('Open Fixture Library', h('div', { class: 'form' },
    h('p', { class: 'muted' }, 'Biblioteca deschisă ', h('a', { href: 'https://open-fixture-library.org', target: '_blank', rel: 'noopener' }, 'open-fixture-library.org'), ' are profile pentru Chauvet, ADJ, Cameo, Stairville, Eurolite, Showtec, Martin și mulți alții. Ai nevoie de internet doar la import – apoi profilul e salvat în proiect.'),
    search, results,
    h('div', { class: 'muted small' }, 'Ai descărcat deja fișierul .json de pe site? Folosește „Import fișier” din Bibliotecă.')),
  [{ label: 'Închide', value: null }]);
}

export async function importProfileFile(app) {
  const file = await pickFile('.json');
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.availableChannels && data.modes) {
      await chooseModeAndImport(app, data, data.__key || '');
    } else if (Array.isArray(data.channels)) {
      const { freevisProfile, ...p } = data;
      p.id = app.profilesById[p.id] ? uid('prof') : (p.id || uid('prof'));
      p.source = 'custom';
      const saved = app.saveProfile(p);
      toast(`Profil importat: ${saved.name}`);
    } else {
      throw new Error('fișierul nu e un profil FreeVisualizer sau Open Fixture Library');
    }
  } catch (err) {
    toast(`Import eșuat: ${err.message}`, 'error');
  }
}

// ------------------------------------------------------------------ projects
export async function newProjectDialog(app) {
  const res = await openModal('Proiect nou', h('div', { class: 'form' },
    h('p', {}, 'Alege de unde pornești. Proiectul curent rămâne salvat automat în browser până creezi altul – exportă-l sau salvează-l dacă vrei să-l păstrezi.'),
    h('ul', { class: 'small muted' },
      h('li', {}, h('b', {}, 'Nuntă: '), 'cabină DJ cu truss, retro-uri, uplight-uri pe pereți, ring de dans cu scântei reci, glob disco, fum greu, laser.'),
      h('li', {}, h('b', {}, 'Club: '), 'truss cu moving heads, bare LED, strobe, ecran LED.'))), [
    { label: 'Anulează', value: null },
    { label: 'Proiect gol', value: 'empty' },
    { label: 'Rig club', value: 'club' },
    { label: 'Rig nuntă', primary: true, value: 'wedding' },
  ]);
  if (res) app.newProject(res);
}

export async function openProjectDialog(app) {
  const list = h('div', { class: 'pick-list' }, h('div', { class: 'muted', style: { padding: '10px' } }, 'Se încarcă…'));
  const refresh = async () => {
    try {
      const items = await listServerProjects();
      list.innerHTML = '';
      if (!items.length) list.append(h('div', { class: 'muted', style: { padding: '10px' } }, 'Niciun proiect salvat încă. Folosește „Salvează” (Ctrl+S).'));
      for (const it of items) {
        list.append(h('div', { class: 'item', onclick: async () => {
          try {
            const p = await loadServerProject(it.name);
            app.checkpoint();
            app.loadProject(p);
            closeModal();
            toast(`Deschis: ${it.name}`);
          } catch (err) { toast(err.message, 'error'); }
        } },
        h('span', { class: 'name' }, it.name),
        h('span', { class: 'meta' }, new Date(it.modified).toLocaleString('ro-RO')),
        h('button', { class: 'icon danger', title: 'Șterge', onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Ștergi proiectul „${it.name}”?`)) return;
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
  await openModal('Deschide proiect', h('div', { class: 'form' }, list), [
    { label: 'Din fișier…', onClick: () => { setTimeout(() => app.importProject(), 0); } },
    { label: 'Închide', value: null },
  ]);
}

// ------------------------------------------------------------------ settings & help
export async function settingsDialog(app) {
  const s = app.project.settings;
  let info = null;
  try { info = await (await fetch('/api/info')).json(); } catch (_) { /* server offline */ }
  const offset = h('select', {},
    h('option', { value: '1' }, 'Art-Net 0 = Universul 1 (recomandat pentru SoundSwitch)'),
    h('option', { value: '0' }, 'Art-Net 0 = Universul 0 (numerotare brută)'));
  offset.value = String(s.artnetOffset);
  offset.addEventListener('change', () => { app.setSetting('artnetOffset', Number(offset.value)); app.monitor.refreshUniverses(); });
  const sacn = h('input', { value: info ? info.settings.sacnUniverses.join(', ') : '1, 2, 3, 4' });
  const range = (key, min, max, step) => {
    const el = h('input', { type: 'range', min, max, step, value: s[key] });
    el.addEventListener('input', () => app.setSetting(key, parseFloat(el.value)));
    return el;
  };
  const content = h('div', { class: 'form' },
    h('h4', {}, 'Intrare DMX'),
    field('Numerotare universuri Art-Net', offset),
    field('Universuri sACN (E1.31) ascultate', sacn, 'Lista universurilor sACN multicast la care se abonează serverul'),
    info ? h('div', { class: 'muted small' }, `Server pe portul ${info.port}. IP-urile acestui calculator: ${info.interfaces.map((i) => `${i.address} (${i.name})`).join(', ') || '—'}`) : h('div', { class: 'warn-box' }, 'Serverul nu răspunde.'),
    h('h4', {}, 'Branding pentru clipuri video'),
    brandingForm(),
    h('h4', {}, 'Imagine'),
    field('Lumină ambientală în sală', range('ambient', 0, 1.5, 0.01)),
    field('Putere lumină pe suprafețe (podea/pereți)', range('lightPower', 0, 3, 0.05)),
    field('Haze / fum', range('haze', 0, 1, 0.01)),
    field('Glow (bloom)', range('bloom', 0, 2, 0.01)),
  );
  await openModal('Setări', content, [
    { label: 'Gata', primary: true, onClick: async () => {
      const list = sacn.value.split(/[ ,;]+/).map(Number).filter((n) => n >= 1 && n <= 63999);
      try {
        await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sacnUniverses: list }) });
      } catch (_) { /* ignore */ }
      return true;
    } },
  ]);
}

function brandingForm() {
  const brand = loadBrand();
  const text = h('input', { value: brand.text || '', placeholder: 'ex: DJ Matei' });
  const sub = h('input', { value: brand.subtitle || '', placeholder: 'ex: djmatei.ro' });
  const preview = h('div', { class: 'row' });
  const renderPreview = () => {
    preview.innerHTML = '';
    if (brand.logo) {
      preview.append(h('img', { src: brand.logo, class: 'brand-logo', alt: 'Logo' }),
        h('button', { onclick: () => { brand.logo = null; saveBrand(brand); renderPreview(); } }, 'Șterge logo'));
    } else {
      preview.append(h('span', { class: 'muted small' }, 'Niciun logo încărcat.'));
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
    h('div', { class: 'grid2' }, field('Nume', text), field('Site / Instagram', sub)),
    field('Logo (PNG transparent recomandat)', file),
    preview);
}

export async function helpDialog(app) {
  let ips = '';
  try { const info = await (await fetch('/api/info')).json(); ips = info.interfaces.map((i) => i.address).join(', '); } catch (_) { /* offline */ }
  const content = h('div', { class: 'form' },
    h('h4', {}, 'SoundSwitch pe același calculator'),
    h('ol', {},
      h('li', {}, 'Pornește ', h('b', {}, 'întâi FreeVisualizer'), ', apoi SoundSwitch.'),
      h('li', {}, 'În SoundSwitch: ', h('code', {}, 'Preferences → Hardware'), ' → bifează ', h('b', {}, 'Localhost Art-Net Node'), ' (disponibil din SoundSwitch 2.9).'),
      h('li', {}, 'Dacă nu apare imediat, repornește SoundSwitch (el caută nodurile Art-Net la pornire).'),
      h('li', {}, 'În FreeVisualizer adaugă aceleași fixturi, cu ', h('b', {}, 'același univers, aceeași adresă DMX și același mod (nr. de canale)'), ' ca în DMX Patch-ul din SoundSwitch.'),
      h('li', {}, 'Indicatorul din dreapta sus devine verde: „Primesc DMX”. Gata – pune muzică și Autoloops!')),
    h('h4', {}, 'SoundSwitch pe alt calculator (în rețea)'),
    h('ol', {},
      h('li', {}, 'Ambele calculatoare în aceeași rețea, ideal prin cablu (multe routere Wi-Fi blochează Art-Net).'),
      h('li', {}, `În SoundSwitch alege nodul Art-Net „FreeVisualizer” sau IP-ul acestui calculator: `, h('code', {}, ips || 'vezi Setări')),
      h('li', {}, 'Permite aplicația Node.js în firewall (porturile UDP 6454 pentru Art-Net și 5568 pentru sACN).')),
    h('h4', {}, 'Probleme frecvente'),
    h('ol', {},
      h('li', {}, h('b', {}, 'Universul nu se potrivește: '), 'deschide tab-ul DMX – vezi ce universuri sosesc. Poți schimba numerotarea Art-Net din Setări.'),
      h('li', {}, h('b', {}, 'Culorile/mișcarea sunt greșite: '), 'modul DMX al profilului diferă de cel din SoundSwitch. Folosește „Test canale” din inspector ca să verifici fiecare canal.'),
      h('li', {}, h('b', {}, 'Portul 6454 e ocupat: '), 'închide alte vizualizatoare / SoundSwitch, pornește FreeVisualizer, apoi SoundSwitch.')),
    h('h4', {}, 'Scurtături'),
    h('p', { class: 'small' }, 'W mută · E rotește · F centrează pe selecție · Ctrl+D duplică · Del șterge · Ctrl+Z / Ctrl+Y anulează/refă · Ctrl+S salvează · H ascunde panourile (mod prezentare) · D demo · L etichete · 1–6 camere'),
  );
  await openModal('Conectare SoundSwitch', content, [{ label: 'Am înțeles', primary: true, value: null }]);
}
