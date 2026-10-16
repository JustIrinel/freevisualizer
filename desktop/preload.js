'use strict';
// Bridge between the native menu and the web app (no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freevisDesktop', {
  platform: process.platform,
  onMenu: (callback) => ipcRenderer.on('menu-action', (_e, action) => callback(action)),
  info: () => ipcRenderer.invoke('desktop-info'),
  togglePresent: () => ipcRenderer.send('toggle-present'),
  openFixtureId: () => ipcRenderer.send('open-fixture-id'),
  pickSoundSwitch: () => ipcRenderer.invoke('pick-soundswitch'),
  onFixtureFile: (callback) => ipcRenderer.on('fixture-file', (_e, file) => callback(file)),
  openLicenseAdmin: () => ipcRenderer.send('open-license-admin'),
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
});
