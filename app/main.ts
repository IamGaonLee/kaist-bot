// Electron 메인 프로세스 (KAISTBOT 앱 껍데기, C단계).
// 트레이 상주, 단일 인스턴스, 메인 창. 로그인·sync는 뒤 단계에서 붙인다.
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installElectronPlatform } from './platform-electron.js';
import { getSavedId } from '../src/sso/account.js';
import { hasGoogleToken, hasGmailScope, googleLogin } from '../src/google/oauth.js';
import { loadSettings, saveSettings } from '../src/config.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'KAISTBOT';

installElectronPlatform();

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
      preload: path.join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.webContents.on('console-message', (_e, level, message, line, src) => console.log(`[renderer:${level}] ${message} (${src}:${line})`));
  win.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, err?.message));
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
    { label: '지금 동기화', click: () => { createWindow(); win?.webContents.send('trigger-sync'); } },
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

// 렌더러 → 메인 핸들
ipcMain.handle('app:info', () => ({ name: APP_NAME, version: app.getVersion(), electron: process.versions.electron, hasSavedId: !!getSavedId() }));

function notify(title: string, body: string): void {
  try { if (Notification.isSupported()) new Notification({ title, body }).show(); } catch { /* 알림 실패는 무시 */ }
}

// 동기화: KLMS·포털·생활관 수집 + 드라이브 저장. 세션이 없으면 실패(먼저 로그인).
let syncing = false;
ipcMain.handle('sync', async () => {
  if (syncing) return { ok: false, error: { message: '이미 동기화 중입니다.' } };
  syncing = true;
  const sendStatus = (msg: string) => win?.webContents.send('status', msg);
  try {
    const { runSync } = await import('../src/sync/sync.js');
    const r = await runSync({ interactive: false, onStatus: sendStatus });
    const changes = r.changes.length;
    const newCandidates = r.candidates?.newCandidates ?? 0;
    if (r.status === 'aborted') {
      const code = r.abortReason?.code;
      notify('KAISTBOT 동기화', code === 'SESSION_EXPIRED' ? '세션이 만료됐습니다. 먼저 로그인해 주세요.' : '동기화가 중단됐습니다.');
      return { ok: false, aborted: true, code, message: r.abortReason?.message };
    }
    notify('KAISTBOT 동기화 완료', `변경 ${changes}건${newCandidates ? `, 새 일정 후보 ${newCandidates}` : ''}${r.warnings.length ? `, 경고 ${r.warnings.length}` : ''}`);
    return { ok: true, status: r.status, changes, newCandidates, warnings: r.warnings };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    notify('KAISTBOT 동기화 실패', err.message ?? '오류');
    return { ok: false, error: { code: err.code ?? 'ERROR', message: err.message ?? String(e) } };
  } finally {
    syncing = false;
  }
});

// 로그인: 숨긴 창에서 진행, 상태는 'status'로 렌더러에 보낸다 (C2). 마법사 첫 로그인은 창을 보이고 아이디 저장.
ipcMain.handle('login', async (_e, opts?: { saveId?: boolean; show?: boolean }) => {
  const { loginAll } = await import('../src/sites/session.js');
  const sendStatus = (msg: string) => win?.webContents.send('status', msg);
  try {
    const forceShow = !!(opts && (opts.show || opts.saveId));
    const headless = !forceShow && !!getSavedId();
    const r = await loginAll({ saveId: !!(opts && opts.saveId), headless, onStatus: sendStatus });
    const failed = r.sites.filter(s => s.state !== 'ok');
    return { ok: failed.length === 0, sites: r.sites };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, error: { code: err.code ?? 'ERROR', message: err.message ?? String(e) } };
  }
});

// 대화: 로컬 자료를 근거로 내장 AI가 답한다 (E2)
ipcMain.handle('ask', async (_e, question: string) => {
  try {
    const { getAiProvider } = await import('../src/ai/provider.js');
    const { gatherContext, CHAT_SYSTEM } = await import('../src/ai/context.js');
    const p = await getAiProvider();
    await p.ensureReady?.((m: string) => win?.webContents.send('status', m));
    const answer = await p.complete(CHAT_SYSTEM, `자료:\n${gatherContext()}\n\n질문: ${question}`, { maxTokens: 500 });
    return { ok: true, answer, provider: p.name };
  } catch (e) {
    const err = e as { message?: string };
    return { ok: false, error: { message: err.message ?? String(e) } };
  }
});

// 첫 실행 설정 마법사 (D)
ipcMain.handle('setup:state', () => ({
  hasSavedId: !!getSavedId(),
  hasGoogleToken: hasGoogleToken(),
  hasGmail: hasGmailScope(),
  driveRoot: loadSettings().driveRoot,
  driveRootExists: (() => { try { return fs.existsSync(path.dirname(loadSettings().driveRoot)); } catch { return false; } })(),
}));

ipcMain.handle('drive:pick', async () => {
  const r = await dialog.showOpenDialog({ title: '드라이브(KAIST) 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  saveSettings({ driveRoot: r.filePaths[0] });
  return { ok: true, driveRoot: r.filePaths[0] };
});

// AI 모델 선택 (설치 마법사 4단계)
ipcMain.handle('ai:state', async () => {
  const { catalogWithState } = await import('../src/ai/models.js');
  const s = loadSettings();
  return { models: catalogWithState(s.aiModelUri), usingApiKey: !!s.aiApiKey, apiBaseUrl: s.aiBaseUrl ?? '', apiModel: s.aiModel ?? '' };
});

ipcMain.handle('ai:setModel', async (_e, uri: string) => {
  const { resetAiProvider } = await import('../src/ai/provider.js');
  saveSettings({ aiModelUri: uri, aiApiKey: undefined });
  await resetAiProvider();
  return { ok: true };
});

ipcMain.handle('ai:setApiKey', async (_e, opts: { apiKey: string; baseUrl?: string; model?: string }) => {
  const { resetAiProvider } = await import('../src/ai/provider.js');
  saveSettings({ aiApiKey: opts.apiKey || undefined, aiBaseUrl: opts.baseUrl || undefined, aiModel: opts.model || undefined });
  await resetAiProvider();
  return { ok: true };
});

ipcMain.handle('ai:download', async () => {
  const sendStatus = (msg: string) => win?.webContents.send('status', msg);
  try {
    const { getAiProvider } = await import('../src/ai/provider.js');
    const p = await getAiProvider();
    await p.ensureReady?.(sendStatus);
    return { ok: true };
  } catch (e) {
    const err = e as { message?: string };
    return { ok: false, error: { message: err.message ?? String(e) } };
  }
});

ipcMain.handle('google:login', async (_e, opts?: { gmail?: boolean }) => {
  const sendStatus = (msg: string) => win?.webContents.send('status', msg);
  try {
    await googleLogin(sendStatus, { gmail: !!(opts && opts.gmail) });
    return { ok: true, hasGmail: hasGmailScope() };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, error: { code: err.code ?? 'ERROR', message: err.message ?? String(e) } };
  }
});
