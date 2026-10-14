'use strict';
// FreeVisualizer desktop app (macOS / Windows). Runs the same server as
// `npm start` inside Electron and shows the visualizer in a native window.

const { app, BrowserWindow, Menu, dialog, shell, screen, ipcMain } = require('electron');
const path = require('path');
const { createApp, ipv4Interfaces } = require('../server/app');

const isMac = process.platform === 'darwin';
let server = null;
let baseUrl = null;
let mainWindow = null;
let presentWindow = null;

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
  });
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
    title: 'FreeVisualizer – Prezentare',
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
  const item = (label, action, accelerator) => ({ label, accelerator, click: () => sendMenu(action) });
  const template = [
    ...(isMac ? [{
      label: 'FreeVisualizer',
      submenu: [
        { role: 'about', label: 'Despre FreeVisualizer' },
        { type: 'separator' },
        item('Setări…', 'settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'hide', label: 'Ascunde FreeVisualizer' },
        { role: 'hideOthers', label: 'Ascunde celelalte' },
        { role: 'unhide', label: 'Arată tot' },
        { type: 'separator' },
        { role: 'quit', label: 'Ieșire din FreeVisualizer' },
      ],
    }] : []),
    {
      label: 'Fișier',
      submenu: [
        item('Proiect nou…', 'new', 'CmdOrCtrl+N'),
        item('Deschide…', 'open', 'CmdOrCtrl+O'),
        item('Salvează', 'save', 'CmdOrCtrl+S'),
        { type: 'separator' },
        item('Export proiect…', 'export', 'CmdOrCtrl+E'),
        item('Import proiect…', 'import', 'CmdOrCtrl+I'),
        { type: 'separator' },
        item('Înregistrează clip video…', 'record'),
        ...(isMac ? [] : [{ type: 'separator' }, item('Setări…', 'settings'), { role: 'quit', label: 'Ieșire' }]),
      ],
    },
    {
      label: 'Editare',
      submenu: [
        item('Anulează', 'undo', 'CmdOrCtrl+Z'),
        item('Refă', 'redo', isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut', label: 'Taie' },
        { role: 'copy', label: 'Copiază' },
        { role: 'paste', label: 'Lipește' },
        { role: 'selectAll', label: 'Selectează tot' },
        { type: 'separator' },
        item('Adaugă fixturi…', 'add-fixture', 'CmdOrCtrl+Shift+A'),
      ],
    },
    {
      label: 'Vizualizare',
      submenu: [
        item('Pornește / oprește demo', 'demo'),
        item('Ascunde panourile', 'hide-ui'),
        { label: 'Fereastră de prezentare (al doilea monitor)', accelerator: 'CmdOrCtrl+P', click: togglePresentWindow },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Ecran complet' },
        { role: 'resetZoom', label: 'Mărime normală' },
        { role: 'zoomIn', label: 'Mărește' },
        { role: 'zoomOut', label: 'Micșorează' },
        { type: 'separator' },
        { role: 'reload', label: 'Reîncarcă' },
        { role: 'toggleDevTools', label: 'Unelte dezvoltator' },
      ],
    },
    { role: 'windowMenu', label: 'Fereastră' },
    {
      role: 'help',
      label: 'Ajutor',
      submenu: [
        item('Conectare SoundSwitch', 'help'),
        { label: 'Open Fixture Library', click: () => shell.openExternal('https://open-fixture-library.org') },
        { label: 'Folderul cu date (proiecte)', click: () => shell.openPath(app.getPath('userData')) },
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

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'FreeVisualizer',
    applicationVersion: app.getVersion(),
    copyright: 'Vizualizator 3D gratuit pentru SoundSwitch (Art-Net / sACN)',
  });
  server = createApp({ dataDir: app.getPath('userData'), port: 8080 });
  try {
    const { port, stats } = await server.start();
    baseUrl = `http://localhost:${port}`;
    if (stats.artnet.error) {
      dialog.showMessageBox({
        type: 'warning',
        message: 'Portul Art-Net 6454 este ocupat',
        detail: 'Alt program (SoundSwitch pornit înainte, Capture sau alt vizualizator) folosește deja portul. '
          + 'Închide FreeVisualizer și SoundSwitch, pornește întâi FreeVisualizer, apoi SoundSwitch.\n\n'
          + `Detalii: ${stats.artnet.error}`,
      });
    }
  } catch (err) {
    dialog.showErrorBox('FreeVisualizer nu a putut porni', err.message);
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
