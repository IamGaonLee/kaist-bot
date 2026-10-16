// 렌더러에 안전한 API만 노출 (contextBridge). CommonJS여야 한다(Electron preload는 ESM 불가).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kaist', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  login: () => ipcRenderer.invoke('login'),
  onStatus: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('status', h);
    return () => ipcRenderer.removeListener('status', h);
  },
});
