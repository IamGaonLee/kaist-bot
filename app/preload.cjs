// 렌더러에 안전한 API만 노출 (contextBridge). CommonJS여야 한다(Electron preload는 ESM 불가).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kaist', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  login: (opts) => ipcRenderer.invoke('login', opts),
  sync: () => ipcRenderer.invoke('sync'),
  ask: (q, opts) => ipcRenderer.invoke('ask', q, opts),
  aiSelect: (sel) => ipcRenderer.invoke('ai:select', sel),
  aiSetEffort: (effort) => ipcRenderer.invoke('ai:setEffort', effort),
  eventsList: () => ipcRenderer.invoke('events:list'),
  eventsCancel: (id) => ipcRenderer.invoke('events:cancel', id),
  eventsSuggest: (opts) => ipcRenderer.invoke('events:suggest', opts),
  eventsRegister: (s) => ipcRenderer.invoke('events:register', s),
  eventsDismiss: (id) => ipcRenderer.invoke('events:dismiss', id),
  setupState: () => ipcRenderer.invoke('setup:state'),
  pickDrive: () => ipcRenderer.invoke('drive:pick'),
  googleLogin: (opts) => ipcRenderer.invoke('google:login', opts),
  aiState: () => ipcRenderer.invoke('ai:state'),
  aiSetModel: (uri) => ipcRenderer.invoke('ai:setModel', uri),
  aiSetApiKey: (opts) => ipcRenderer.invoke('ai:setApiKey', opts),
  aiDownload: () => ipcRenderer.invoke('ai:download'),
  homeState: () => ipcRenderer.invoke('home:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateOpen: () => ipcRenderer.invoke('update:open'),
  onUpdate: (cb) => { ipcRenderer.on('update', (_e, info) => cb(info)); },
  onStatus: (cb) => {
    const h = (_e, msg) => cb(msg);
    ipcRenderer.on('status', h);
    return () => ipcRenderer.removeListener('status', h);
  },
  onTriggerSync: (cb) => { ipcRenderer.on('trigger-sync', () => cb()); },
});
