'use strict';
// FreeVisualizer desktop app (macOS / Windows). Runs the same server as
// `npm start` inside Electron and shows the visualizer in a native window.

const { app, BrowserWindow, Menu, dialog, shell, screen, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { createApp, ipv4Interfaces } = require('../server/app');

const isMac = process.platform === 'darwin';
let server = null;
let baseUrl = null;
let mainWindow = null;
let presentWindow = null;
let fixtureIdWindow = null;

const FIXTURE_ID_URL = process.env.FREEVIS_FIXTURE_ID_URL || 'https://www.fixture.id/';
// Downloads from the Fixture.ID window that we import instead of saving.
const FIXTURE_FILE = /\.(d4|gdtf|zip|qxf|xml)$/i;

// Menu and dialog language, chosen in the page (Setări) and kept in <userData>/prefs.json.
const EN = {
  'Alege proiectul SoundSwitch (.ssproj)': 'Choose the SoundSwitch project (.ssproj)',
  'Proiect SoundSwitch': 'SoundSwitch project',
  'În folderul ales nu există un proiect SoundSwitch. Alege folderul care se termină în .ssproj (de obicei în Muzică → SoundSwitch).': 'There is no SoundSwitch project in the chosen folder. Choose the folder that ends in .ssproj (usually in Music → SoundSwitch).',
  'Ce proiect SoundSwitch import?': 'Which SoundSwitch project should I import?',
  'Anulează#cancel': 'Cancel',
  'Descărcarea „{name}” nu s-a terminat': 'The download “{name}” did not finish',
  'Stare: {state}': 'Status: {state}',
  'Nu am putut citi fișierul descărcat': 'Couldn\'t read the downloaded file',
  'Fixture.ID – descarcă fișierul .d4, se importă singur în FreeVisualizer': 'Fixture.ID – download the .d4 file, it imports into FreeVisualizer automatically',
  'FreeVisualizer – Prezentare': 'FreeVisualizer – Presentation',
  'Despre FreeVisualizer': 'About FreeVisualizer',
  'Setări…': 'Settings…',
  'Ascunde FreeVisualizer': 'Hide FreeVisualizer',
  'Ascunde celelalte': 'Hide Others',
  'Arată tot': 'Show All',
  'Ieșire din FreeVisualizer': 'Quit FreeVisualizer',
  'Fișier': 'File',
  'Proiect nou…': 'New Project…',
  'Importă din SoundSwitch…': 'Import from SoundSwitch…',
  'Deschide…': 'Open…',
  'Salvează': 'Save',
  'Export proiect…': 'Export Project…',
  'Import proiect…': 'Import Project…',
  'Înregistrează clip video…': 'Record Video Clip…',
  'Ieșire': 'Exit',
  'Editare': 'Edit',
  'Anulează': 'Undo',
  'Refă': 'Redo',
  'Taie': 'Cut',
  'Copiază': 'Copy',
  'Lipește': 'Paste',
  'Selectează tot': 'Select All',
  'Adaugă fixturi…': 'Add Fixtures…',
  'Caută pe Fixture.ID…': 'Search Fixture.ID…',
  'Vizualizare': 'View',
  'Pornește / oprește demo': 'Start / Stop Demo',
  'Ascunde panourile': 'Hide Panels',
  'Fereastră de prezentare (al doilea monitor)': 'Presentation Window (Second Display)',
  'Ecran complet': 'Full Screen',
  'Mărime normală': 'Actual Size',
  'Mărește': 'Zoom In',
  'Micșorează': 'Zoom Out',
  'Reîncarcă': 'Reload',
  'Unelte dezvoltator': 'Developer Tools',
  'Fereastră': 'Window',
  'Ajutor': 'Help',
  'Conectare SoundSwitch': 'Connecting SoundSwitch',
  'Fixture.ID (fișiere .d4)': 'Fixture.ID (.d4 files)',
  'Folderul cu date (proiecte)': 'Data Folder (Projects)',
  'Vizualizator 3D gratuit pentru SoundSwitch (Art-Net / sACN)': 'Free 3D visualizer for SoundSwitch (Art-Net / sACN)',
  'Portul Art-Net 6454 este ocupat': 'Art-Net port 6454 is in use',
  'Alt program (SoundSwitch pornit înainte, Capture sau alt vizualizator) folosește deja portul. Închide FreeVisualizer și SoundSwitch, pornește întâi FreeVisualizer, apoi SoundSwitch.\n\nDetalii: {err}': 'Another program (SoundSwitch started first, Capture or another visualizer) is already using the port. Quit FreeVisualizer and SoundSwitch, start FreeVisualizer first, then SoundSwitch.\n\nDetails: {err}',
  'FreeVisualizer nu a putut porni': 'FreeVisualizer couldn\'t start',
};

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');

function loadLang() {
  try {
    const l = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')).lang;
    return l === 'en' ? 'en' : 'ro';
  } catch (_) {
    return 'ro';
  }
}

let lang = loadLang();

/** L('Text românesc', { x }) – a '#context' suffix tells apart keys with the same Romanian text. */
function L(ro, vars) {
  let out = (lang === 'en' && EN[ro]) || ro.replace(/#\w+$/, '');
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function sendMenu(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-action', action);
}

function secureWindow(win) {
  // Links to other sites (Open Fixture Library, docs) open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(baseUrl)) { e.preventDefault(); shell.openExternal(url); }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    title: 'FreeVisualizer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep rendering while SoundSwitch has focus
    },
  });
  secureWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(baseUrl);
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (presentWindow && !presentWindow.isDestroyed()) presentWindow.close();
    if (fixtureIdWindow && !fixtureIdWindow.isDestroyed()) fixtureIdWindow.close();
  });
}

const VENUES_FILE = 'SoundSwitchVenues.bin';

function soundSwitchFolder() {
  const music = app.getPath('music');
  const ss = path.join(music, 'SoundSwitch');
  return fs.existsSync(ss) ? ss : music;
}

/** .ssproj folders (with their venues file) directly inside a folder. */
function projectsIn(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, VENUES_FILE)))
      .map((d) => path.join(dir, d.name));
  } catch (_) {
    return [];
  }
}

/** Native picker for a SoundSwitch project: the .ssproj folder, its .zip or SoundSwitchVenues.bin. */
async function pickSoundSwitch() {
  const props = isMac ? ['openDirectory', 'openFile'] : ['openDirectory'];
  const r = await dialog.showOpenDialog(mainWindow, {
    title: L('Alege proiectul SoundSwitch (.ssproj)'),
    defaultPath: soundSwitchFolder(),
    properties: props,
    filters: isMac ? [{ name: L('Proiect SoundSwitch'), extensions: ['ssproj', 'zip', 'bin'] }] : undefined,
  });
  if (r.canceled || !r.filePaths.length) return null;
  let target = r.filePaths[0];
  const name = (p) => path.basename(p).replace(/\.ssproj$/i, '');
  if (fs.statSync(target).isFile()) {
    const data = await fs.promises.readFile(target);
    return { name: name(path.dirname(target)), data: new Uint8Array(data), zip: /\.zip$/i.test(target) };
  }
  if (!fs.existsSync(path.join(target, VENUES_FILE))) {
    const found = projectsIn(target);
    if (!found.length) return { error: L('În folderul ales nu există un proiect SoundSwitch. Alege folderul care se termină în .ssproj (de obicei în Muzică → SoundSwitch).') };
    if (found.length === 1) target = found[0];
    else {
      const list = found.slice(0, 12);
      const pick = await dialog.showMessageBox(mainWindow, {
        type: 'question', message: L('Ce proiect SoundSwitch import?'), buttons: [...list.map(name), L('Anulează#cancel')], cancelId: list.length,
      });
      if (pick.response >= list.length) return null;
      target = list[pick.response];
    }
  }
  const data = await fs.promises.readFile(path.join(target, VENUES_FILE));
  return { name: name(target), data: new Uint8Array(data) };
}

/** A fixture file downloaded in the Fixture.ID window goes straight to the import. */
function onFixtureDownload(_event, item) {
  const name = item.getFilename();
  if (!FIXTURE_FILE.test(name)) return; // anything else: normal download
  const tmp = path.join(app.getPath('temp'), `freevis-${Date.now()}-${name}`);
  item.setSavePath(tmp);
  item.once('done', async (_e, state) => {
    if (state !== 'completed') {
      dialog.showMessageBox({ type: 'warning', message: L('Descărcarea „{name}” nu s-a terminat', { name }), detail: L('Stare: {state}', { state }) });
      return;
    }
    try {
      const data = await fs.promises.readFile(tmp);
      fs.promises.unlink(tmp).catch(() => {});
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('fixture-file', { name, data: new Uint8Array(data) });
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } catch (err) {
      dialog.showErrorBox(L('Nu am putut citi fișierul descărcat'), err.message);
    }
  });
}

/** Fixture.ID inside the app, with its own persistent session (stay logged in). */
function openFixtureIdWindow() {
  if (fixtureIdWindow && !fixtureIdWindow.isDestroyed()) {
    if (fixtureIdWindow.isMinimized()) fixtureIdWindow.restore();
    fixtureIdWindow.focus();
    return;
  }
  const partition = 'persist:fixtureid';
  const ses = session.fromPartition(partition);
  if (!ses.listenerCount('will-download')) ses.on('will-download', onFixtureDownload);
  fixtureIdWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    title: L('Fixture.ID – descarcă fișierul .d4, se importă singur în FreeVisualizer'),
    backgroundColor: '#ffffff',
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Keep our title so the hint stays visible.
  fixtureIdWindow.on('page-title-updated', (e) => e.preventDefault());
  // Pop-ups (login, file links) stay in the same session so downloads are still caught.
  fixtureIdWindow.webContents.setWindowOpenHandler(({ url }) => (/^https?:/i.test(url) ? { action: 'allow' } : { action: 'deny' }));
  fixtureIdWindow.loadURL(FIXTURE_ID_URL);
  fixtureIdWindow.on('closed', () => { fixtureIdWindow = null; });
}

/** Full-screen view without panels, on the external display when there is one. */
function togglePresentWindow() {
  if (presentWindow && !presentWindow.isDestroyed()) { presentWindow.close(); return; }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = displays.find((d) => d.id !== primary.id) || primary;
  presentWindow = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    backgroundColor: '#000000',
    title: L('FreeVisualizer – Prezentare'),
    fullscreen: target.id !== primary.id,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  secureWindow(presentWindow);
  presentWindow.loadURL(`${baseUrl}/?present=1`);
  presentWindow.on('closed', () => { presentWindow = null; });
}

function buildMenu() {
  app.setAboutPanelOptions({
    applicationName: 'FreeVisualizer',
    applicationVersion: app.getVersion(),
    copyright: L('Vizualizator 3D gratuit pentru SoundSwitch (Art-Net / sACN)'),
  });
  const item = (label, action, accelerator) => ({ label: L(label), accelerator, click: () => sendMenu(action) });
  const template = [
    ...(isMac ? [{
      label: 'FreeVisualizer',
      submenu: [
        { role: 'about', label: L('Despre FreeVisualizer') },
        { type: 'separator' },
        item('Setări…', 'settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'hide', label: L('Ascunde FreeVisualizer') },
        { role: 'hideOthers', label: L('Ascunde celelalte') },
        { role: 'unhide', label: L('Arată tot') },
        { type: 'separator' },
        { role: 'quit', label: L('Ieșire din FreeVisualizer') },
      ],
    }] : []),
    {
      label: L('Fișier'),
      submenu: [
        item('Proiect nou…', 'new', 'CmdOrCtrl+N'),
        item('Importă din SoundSwitch…', 'import-soundswitch'),
        item('Deschide…', 'open', 'CmdOrCtrl+O'),
        item('Salvează', 'save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        item('Export proiect…', 'export', 'CmdOrCtrl+E'),
        item('Import proiect…', 'import', 'CmdOrCtrl+I'),
        { type: 'separator' },
        item('Înregistrează clip video…', 'record'),
        ...(isMac ? [] : [{ type: 'separator' }, item('Setări…', 'settings'), { role: 'quit', label: L('Ieșire') }]),
      ],
    },
    {
      label: L('Editare'),
      submenu: [
        item('Anulează', 'undo', 'CmdOrCtrl+Z'),
        item('Refă', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut', label: L('Taie') },
        { role: 'copy', label: L('Copiază') },
        { role: 'paste', label: L('Lipește') },
        { role: 'selectAll', label: L('Selectează tot') },
        { type: 'separator' },
        item('Adaugă fixturi…', 'add-fixture', 'CmdOrCtrl+Shift+A'),
        { label: L('Caută pe Fixture.ID…'), click: openFixtureIdWindow },
      ],
    },
    {
      label: L('Vizualizare'),
      submenu: [
        item('Pornește / oprește demo', 'demo'),
        item('Ascunde panourile', 'hide-ui'),
        { label: L('Fereastră de prezentare (al doilea monitor)'), accelerator: 'CmdOrCtrl+P', click: togglePresentWindow },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L('Ecran complet') },
        { role: 'resetZoom', label: L('Mărime normală') },
        { role: 'zoomIn', label: L('Mărește') },
        { role: 'zoomOut', label: L('Micșorează') },
        { type: 'separator' },
        { role: 'reload', label: L('Reîncarcă') },
        { role: 'toggleDevTools', label: L('Unelte dezvoltator') },
      ],
    },
    { role: 'windowMenu', label: L('Fereastră') },
    {
      role: 'help',
      label: L('Ajutor'),
      submenu: [
        item('Conectare SoundSwitch', 'help'),
        { label: L('Fixture.ID (fișiere .d4)'), click: openFixtureIdWindow },
        { label: 'Open Fixture Library', click: () => shell.openExternal('https://open-fixture-library.org') },
        { label: L('Folderul cu date (proiecte)'), click: () => shell.openPath(app.getPath('userData')) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('desktop-info', () => ({
  version: app.getVersion(),
  dataDir: app.getPath('userData'),
  interfaces: ipv4Interfaces().filter((i) => !i.internal).map((i) => i.address),
}));
ipcMain.on('toggle-present', () => togglePresentWindow());
ipcMain.on('open-fixture-id', () => openFixtureIdWindow());
ipcMain.handle('pick-soundswitch', () => pickSoundSwitch());
ipcMain.on('set-language', (_e, next) => {
  if ((next !== 'ro' && next !== 'en') || next === lang) return;
  lang = next;
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ lang })); } catch (_) { /* read-only profile */ }
  buildMenu();
});

app.whenReady().then(async () => {
  server = createApp({ dataDir: app.getPath('userData'), port: 8080 });
  try {
    const { port, stats } = await server.start();
    baseUrl = `http://localhost:${port}`;
    if (stats.artnet.error) {
      dialog.showMessageBox({
        type: 'warning',
        message: L('Portul Art-Net 6454 este ocupat'),
        detail: L('Alt program (SoundSwitch pornit înainte, Capture sau alt vizualizator) folosește deja portul. '
          + 'Închide FreeVisualizer și SoundSwitch, pornește întâi FreeVisualizer, apoi SoundSwitch.\n\n'
          + 'Detalii: {err}', { err: stats.artnet.error }),
      });
    }
  } catch (err) {
    dialog.showErrorBox(L('FreeVisualizer nu a putut porni'), err.message);
    app.quit();
    return;
  }
  buildMenu();
  createMainWindow();

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
});

// Quitting frees the Art-Net port for other apps.
app.on('window-all-closed', () => app.quit());

let stopping = false;
app.on('before-quit', (e) => {
  if (!server || stopping) return;
  e.preventDefault();
  stopping = true;
  server.stop().finally(() => { server = null; app.quit(); });
});
