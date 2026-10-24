'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFiles: (opts) => ipcRenderer.invoke('dialog:files', opts),
  pickFolder: (current) => ipcRenderer.invoke('dialog:folder', current),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return ''; } },
  startJob: (id, tool, payload) => ipcRenderer.invoke('job:start', { id, tool, payload }),
  cancelJob: (id) => ipcRenderer.invoke('job:cancel', id),
  onJobEvent: (cb) => { const h = (_e, ev) => cb(ev); ipcRenderer.on('job:event', h); return () => ipcRenderer.removeListener('job:event', h); },
  listRecipes: () => ipcRenderer.invoke('recipes:list'),
  refreshRecipes: () => ipcRenderer.invoke('recipes:refresh'),
  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  updateTool: (which) => ipcRenderer.invoke('tools:update', which),
  resetFfmpeg: () => ipcRenderer.invoke('tools:reset-ffmpeg'),
  onNotice: (cb) => { const h = (_e, t) => cb(t); ipcRenderer.on('app:notice', h); return () => ipcRenderer.removeListener('app:notice', h); },
  supportBase: () => ipcRenderer.invoke('support:base'),
  sendReport: (kind, subject, text) => ipcRenderer.invoke('support:send', { kind, subject, text }),
  copyText: (t) => ipcRenderer.invoke('support:copy', t),
  shortenUrl: (url, alias) => ipcRenderer.invoke('qr:shorten', { url, alias }),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openFolder: (dir) => ipcRenderer.invoke('shell:openFolder', dir),
  saveImage: (dataUrl, defaultName) => ipcRenderer.invoke('file:saveImage', { dataUrl, defaultName })
});
