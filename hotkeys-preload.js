const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hotkeys', {
  get: () => ipcRenderer.invoke('hotkeys:get'),
  save: (hotkeys) => ipcRenderer.invoke('hotkeys:save', hotkeys),
  suspend: () => ipcRenderer.invoke('hotkeys:suspend'),
  resume: () => ipcRenderer.invoke('hotkeys:resume'),
});
