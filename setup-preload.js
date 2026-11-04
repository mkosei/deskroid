const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  check: () => ipcRenderer.invoke('setup:check'),
  action: (name) => ipcRenderer.invoke('setup:action', name),
  done: () => ipcRenderer.invoke('setup:done'),
  onProgress: (fn) => ipcRenderer.on('setup:progress', (_e, p) => fn(p)),
  platform: process.platform,
});
