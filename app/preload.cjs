// 렌더러에 안전한 API만 노출 (contextBridge). CommonJS여야 한다(Electron preload는 ESM 불가).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kaist', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  login: (opts) => ipcRenderer.invoke('login', opts),
  sync: () => ipcRenderer.invoke('sync'),
  ask: (q) => ipcRenderer.invoke('ask', q),
  setupState: () => ipcRenderer.invoke('setup:state'),
  pickDrive: () => ipcRenderer.invoke('drive:pick'),
  googleLogin: (opts) => ipcRenderer.invoke('google:login', opts),
  onStatus: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('status', h);
    return () => ipcRenderer.removeListener('status', h);
  },
  onTriggerSync: (cb) => { ipcRenderer.on('trigger-sync', () => cb()); },
});
