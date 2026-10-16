// Electron 메인 프로세스 (KAISTBOT 앱 껍데기, C단계).
// 트레이 상주, 단일 인스턴스, 메인 창. 로그인·sync는 뒤 단계에서 붙인다.
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'KAISTBOT';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

// Windows 알림에 쓰는 AppUserModelID
app.setAppUserModelId('com.gaonlee.kaistbot');

function createWindow(): void {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 420,
    height: 560,
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(dir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(dir, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win?.show());
  // 창을 닫아도 앱은 트레이에 남는다
  win.on('close', e => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) { e.preventDefault(); win?.hide(); }
  });
}

function createTray(): void {
  // 임시 아이콘(빈 이미지). 실제 아이콘은 뒤 단계에서.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => createWindow() },
    { type: 'separator' },
    { label: '종료', click: () => { (app as unknown as { isQuitting?: boolean }).isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => createWindow());
}

// 단일 인스턴스 (두 번째 실행은 기존 창을 연다)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(() => {
    createTray();
    createWindow();
  });
  app.on('window-all-closed', () => { /* 트레이 앱이라 종료하지 않는다 */ });
  app.on('activate', () => createWindow());
}

// 렌더러 → 메인 핸들 (C1: 핑만)
ipcMain.handle('app:info', () => ({ name: APP_NAME, version: app.getVersion(), electron: process.versions.electron }));
