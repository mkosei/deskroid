const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mate', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  showMenu: (extra) => ipcRenderer.send('show-menu', extra),
  chat: (id, messages) => ipcRenderer.invoke('chat', { id, messages }),
  tts: (text) => ipcRenderer.invoke('tts', text),
  stt: (samples) => ipcRenderer.invoke('stt', samples),
  sttWarmup: () => ipcRenderer.invoke('stt-warmup'),
  on: (channel, fn) => {
    const allowed = ['chat-chunk', 'chat-done', 'chat-error', 'reset-chat', 'stt-status', 'toggle-voice-chat', 'listen-once', 'set-pose', 'set-legs'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
