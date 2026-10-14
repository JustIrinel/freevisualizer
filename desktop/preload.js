'use strict';
// Bridge between the native menu and the web app (no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freevisDesktop', {
  platform: process.platform,
  onMenu: (callback) => ipcRenderer.on('menu-action', (_e, action) => callback(action)),
  info: () => ipcRenderer.invoke('desktop-info'),
  togglePresent: () => ipcRenderer.send('toggle-present'),
});
