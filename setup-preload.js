const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  check: () => ipcRenderer.invoke('setup:check'),
  action: (name, arg) => ipcRenderer.invoke('setup:action', name, arg),
  done: () => ipcRenderer.invoke('setup:done'),
  onProgress: (fn) => ipcRenderer.on('setup:progress', (_e, p) => fn(p)),
  platform: process.platform,
});
