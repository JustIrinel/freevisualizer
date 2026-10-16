'use strict';
// Bridge for the license generator window (DJ Matei only).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('licenseAdmin', {
  status: () => ipcRenderer.invoke('admin:status'),
  setup: () => ipcRenderer.invoke('admin:setup'),
  issue: (input) => ipcRenderer.invoke('admin:issue', input),
  release: (licenseId, code) => ipcRenderer.invoke('admin:release', licenseId, code),
  backup: () => ipcRenderer.invoke('admin:backup'),
  restore: () => ipcRenderer.invoke('admin:restore'),
  copy: (text) => ipcRenderer.invoke('admin:copy', text),
});
