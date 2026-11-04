const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('themeApi', {
  get: () => ipcRenderer.invoke('theme:get'),
  preview: (theme) => ipcRenderer.invoke('theme:preview', theme),
  auto: () => ipcRenderer.invoke('theme:auto'),
  save: (theme) => ipcRenderer.invoke('theme:save', theme),
  reset: () => ipcRenderer.invoke('theme:reset'),
});
