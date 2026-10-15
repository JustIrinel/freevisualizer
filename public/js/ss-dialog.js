// "Import from SoundSwitch": read a .ssproj project and rebuild its patch.
import { h, openModal, toast } from './dom.js';
import { parseSoundSwitchVenues, ssPlacement } from './ss-import.js';
import { readZip } from './zip-lite.js';
import { weddingProject } from './project.js';
import { uid } from './profiles.js';
import { tr, tp } from './i18n.js';

const VENUES_FILE = 'soundswitchvenues.bin';

const isVenuesFile = (name) => name.toLowerCase().split(/[\\/]/).pop() === VENUES_FILE;

/** SoundSwitchVenues.bin from a .zip of the .ssproj folder (or null). */
export async function venuesFromZip(buffer) {
  for (const [name, get] of readZip(buffer)) if (isVenuesFile(name) && !/__MACOSX/.test(name)) return { name: projectName(name), bytes: await get() };
  return null;
}

/** "…/Nunta Popescu.ssproj/SoundSwitchVenues.bin" → "Nunta Popescu". */
function projectName(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const dir = parts.length > 1 ? parts[parts.length - 2] : '';
  return dir.replace(/\.ssproj$/i, '') || 'SoundSwitch';
}

function pickDirectory() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

function pickAnyFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.bin';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/** Files of a picked folder → the SoundSwitchVenues.bin to use (asks when there are several projects). */
async function venuesFromFolder(files) {
  const found = files.filter((f) => isVenuesFile(f.webkitRelativePath || f.name));
  if (!found.length) throw new Error(tr('În folderul ales nu există un proiect SoundSwitch (lipsește SoundSwitchVenues.bin). Alege folderul care se termină în .ssproj.'));
  let file = found[0];
  if (found.length > 1) {
    let chosen = 0;
    const list = h('div', { class: 'mode-list' }, found.map((f, i) => {
      const radio = h('input', { type: 'radio', name: 'ssproj', checked: i === 0 });
      radio.addEventListener('change', () => { chosen = i; });
      return h('label', {}, radio, h('span', { class: 'grow' }, projectName(f.webkitRelativePath)));
    }));
    const res = await openModal(tr('Ce proiect SoundSwitch?'), h('div', { class: 'form' }, list), [{ label: tr('Anulează'), value: null }, { label: tr('Continuă'), primary: true, value: 'ok' }]);
    if (!res) return null;
    file = found[chosen];
  }
  return { name: projectName(file.webkitRelativePath || file.name), bytes: new Uint8Array(await file.arrayBuffer()) };
}

/** A dropped/picked file: .zip of the project or SoundSwitchVenues.bin itself. */
export async function venuesFromFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (/\.zip$/i.test(file.name)) {
    const v = await venuesFromZip(buf);
    if (!v) throw new Error(tr('Arhiva nu conține un proiect SoundSwitch (SoundSwitchVenues.bin)'));
    return v;
  }
  return { name: projectName(file.webkitRelativePath || file.name), bytes: buf };
}

/** Folder dropped on the window (DataTransfer entry) → SoundSwitchVenues.bin inside it. */
export async function venuesFromEntry(entry, depth = 0) {
  if (entry.isFile) {
    if (!isVenuesFile(entry.name)) return null;
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return { name: projectName(entry.fullPath || entry.name), bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  if (!entry.isDirectory || depth > 2) return null;
  const reader = entry.createReader();
  const children = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    children.push(...batch);
  }
  for (const c of children) if (c.isFile && isVenuesFile(c.name)) return venuesFromEntry(c, depth + 1);
  for (const c of children) {
    if (!c.isDirectory) continue;
    const v = await venuesFromEntry(c, depth + 1);
    if (v) return v;
  }
  return null;
}

/** Start: pick the project (desktop: native dialog in Music/SoundSwitch). */
export async function soundSwitchImportDialog(app) {
  const desktop = window.freevisDesktop && window.freevisDesktop.pickSoundSwitch;
  const res = await openModal(tr('Importă din SoundSwitch'), h('div', { class: 'form' },
    h('p', {}, tr('FreeVisualizer citește proiectul tău SoundSwitch și pune în scenă '), h('b', {}, tr('aceleași fixturi, cu același mod și aceeași adresă DMX')), tr(' ca în DMX Map. Nu mai faci patch de mână.')),
    h('ol', { class: 'small' },
      h('li', {}, tr('Proiectele SoundSwitch sunt foldere care se termină în '), h('b', {}, '.ssproj'), tr(', de obicei în '), h('b', {}, tr('Muzică → SoundSwitch')), '.'),
      h('li', {}, tr('Poți folosi și o arhivă '), h('b', {}, '.zip'), tr(' a proiectului (de ex. din File → Export Project).')),
      h('li', {}, tr('Dacă ai schimbat ceva în SoundSwitch, salvează proiectul acolo (File → Save Project) înainte de import.')))),
  [
    { label: tr('Anulează'), value: null },
    { label: tr('Arhivă .zip…'), value: 'file' },
    { label: desktop ? tr('Alege proiectul…') : tr('Alege folderul .ssproj…'), primary: true, value: 'folder' },
  ]);
  if (!res) return;
  try {
    let source = null;
    if (res === 'folder') {
      if (desktop) {
        const r = await window.freevisDesktop.pickSoundSwitch();
        if (!r) return;
        if (r.error) throw new Error(r.error);
        source = r.zip ? await venuesFromZip(new Uint8Array(r.data)) : { name: r.name, bytes: new Uint8Array(r.data) };
        if (!source) throw new Error(tr('Arhiva nu conține un proiect SoundSwitch (SoundSwitchVenues.bin)'));
      } else {
        const files = await pickDirectory();
        if (!files.length) return;
        source = await venuesFromFolder(files);
      }
    } else {
      const file = await pickAnyFile();
      if (!file) return;
      source = await venuesFromFile(file);
    }
    if (source) await importSoundSwitch(app, source);
  } catch (err) {
    toast(err.message, 'error', 8000);
  }
}

function stageOf(project) {
  const truss = project.props.find((p) => p.type === 'truss');
  const room = project.room;
  return {
    trussY: truss ? truss.position.y : 3.35,
    trussZ: truss ? truss.position.z : -room.depth / 2 + 1,
    trussHalf: truss ? Math.max(1, (truss.params.length || 6) / 2 - 0.35) : 3.4,
    roomHalfWidth: room.width / 2,
    backZ: -room.depth / 2,
  };
}

/** Parsed project → confirmation → new project (or update of the current one). */
export async function importSoundSwitch(app, { name, bytes }) {
  const parsed = parseSoundSwitchVenues(bytes);
  if (!parsed.fixtures.length) throw new Error(tr('Proiectul SoundSwitch nu are fixturi în DMX Map'));
  const linked = app.project.fixtures.filter((f) => f.ssName);
  const table = h('table', { class: 'ss-table' },
    h('thead', {}, h('tr', {}, h('th', {}, tr('Fixtură')), h('th', {}, tr('Model')), h('th', {}, tr('Mod')), h('th', {}, tr('Adresă')))),
    h('tbody', {}, parsed.fixtures.map((f) => h('tr', {},
      h('td', {}, f.name),
      h('td', {}, `${f.definition.manufacturer} ${f.definition.name}`.trim()),
      h('td', {}, f.definition.modes[f.modeIndex]?.name || ''),
      h('td', {}, `U${f.universe} · ${f.address}`)))));
  const buttons = [{ label: tr('Anulează'), value: null }];
  if (linked.length) buttons.push({ label: tr('Actualizează proiectul curent'), value: 'update' });
  buttons.push({ label: tr('Importă ca proiect nou'), primary: true, value: 'new' });
  const res = await openModal(`SoundSwitch: ${name}`, h('div', { class: 'form' },
    h('p', {}, tp(parsed.fixtures.length, 'Am găsit o fixtură în venue-ul „{venue}”:', 'Am găsit {n} fixturi în venue-ul „{venue}”:', { venue: parsed.venue })),
    h('div', { class: 'ss-table-wrap' }, table),
    parsed.warnings.length ? h('div', { class: 'warn-box' }, parsed.warnings.join(' ')) : null,
    linked.length ? h('p', { class: 'small muted' }, tr('„Actualizează” păstrează pozițiile din scenă și schimbă doar patch-ul și profilele, după ce ai modificat ceva în SoundSwitch.')) : null,
    h('p', { class: 'small muted' }, tr('Fixturile sunt așezate automat (moving heads pe truss, par-uri pe podea, retro-uri în față). Le muți apoi unde sunt în sala ta.'))),
  buttons, { width: '760px' });
  if (!res) return;

  if (res === 'update') {
    updateFromSoundSwitch(app, parsed);
    return;
  }
  const project = weddingProject();
  project.name = `SoundSwitch – ${name}`;
  project.fixtures = [];
  const { profiles, placed } = ssPlacement(parsed, stageOf(project));
  project.profiles = profiles;
  project.fixtures = placed.map((it) => ({
    id: uid('fx'), name: it.fx.name, profileId: it.profile.id, universe: it.fx.universe, address: it.fx.address,
    position: it.position, rotation: it.rotation, invertPan: false, invertTilt: false, ssName: it.fx.name,
  }));
  app.checkpoint();
  app.loadProject(project);
  toast(tp(placed.length, 'Am importat o fixtură din SoundSwitch. Mut-o unde e în sala ta.', 'Am importat {n} fixturi din SoundSwitch. Mută-le unde sunt în sala ta.'), 'info', 6000);
}

/** Same project, new patch: keep positions of fixtures that still exist. */
function updateFromSoundSwitch(app, parsed) {
  const { profiles, placed } = ssPlacement(parsed, stageOf(app.project));
  const project = JSON.parse(JSON.stringify(app.project));
  const old = project.fixtures.filter((f) => f.ssName);
  const used = new Set();
  const match = (fx) => old.find((f) => !used.has(f.id) && f.ssName === fx.name)
    || old.find((f) => !used.has(f.id) && f.universe === fx.universe && f.address === fx.address);
  const next = [];
  let kept = 0;
  for (const it of placed) {
    const prev = match(it.fx);
    if (prev) { used.add(prev.id); kept++; }
    next.push({
      ...(prev || { id: uid('fx'), position: it.position, rotation: it.rotation, invertPan: false, invertTilt: false }),
      name: prev && prev.name !== prev.ssName ? prev.name : it.fx.name,
      ssName: it.fx.name, profileId: it.profile.id, universe: it.fx.universe, address: it.fx.address,
    });
  }
  const removed = old.length - used.size;
  project.fixtures = [...project.fixtures.filter((f) => !f.ssName), ...next];
  const ids = new Set(profiles.map((p) => p.id));
  project.profiles = [...project.profiles.filter((p) => !ids.has(p.id)), ...profiles];
  project.camera = app.vis.getCamera();
  app.checkpoint();
  app.loadProject(project);
  toast(tr('Patch actualizat din SoundSwitch: {kept} păstrate, {added} noi{removed}.', { kept, added: next.length - kept, removed: removed ? tr(', {n} scoase', { n: removed }) : '' }), 'info', 6000);
}

