// 렌더러에 안전한 API만 노출 (contextBridge). 렌더러는 Node 접근이 없다.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kaist', {
  appInfo: () => ipcRenderer.invoke('app:info'),
  // 뒤 단계: login/sync/status + onStatus 이벤트
  onStatus: (cb: (msg: string) => void) => {
    const h = (_e: unknown, msg: string) => cb(msg);
    ipcRenderer.on('status', h);
    return () => ipcRenderer.removeListener('status', h);
  },
});
