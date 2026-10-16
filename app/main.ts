// Electron 메인 프로세스 (KAISTBOT 앱 껍데기, C단계).
// 트레이 상주, 단일 인스턴스, 메인 창. 로그인·sync는 뒤 단계에서 붙인다.
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installElectronPlatform } from './platform-electron.js';
import { getSavedId } from '../src/sso/account.js';
import { hasGoogleToken, hasGmailScope, googleLogin } from '../src/google/oauth.js';
import { loadSettings, saveSettings } from '../src/config.js';
import { getMeta } from '../src/store/db.js';
import { checkForUpdate, type UpdateInfo } from './update-check.js';

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
    // ChatGPT·Claude 데스크톱과 비슷한 기본 창(사이드바 + 본문). 작은 창에서도 쓰이도록 최소 크기만 제한
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f5f6f8',
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

// AI 일정 제안: 공지에서 후보를 뽑아 보여주고(등록 안 함), 사용자가 확인하면 등록
ipcMain.handle('events:suggest', async (_e, opts?: { all?: boolean }) => {
  try {
    const { suggestEvents } = await import('../src/ai/events.js');
    const suggestions = await suggestEvents({ all: !!(opts && opts.all), onStatus: (m: string) => win?.webContents.send('status', m) });
    return { ok: true, suggestions };
  } catch (e) {
    const err = e as { message?: string };
    return { ok: false, error: { message: err.message ?? String(e) } };
  }
});

ipcMain.handle('events:register', async (_e, s: { candidateId: number; course: string; kind: string; date: string; start?: string; quote: string }) => {
  try {
    const { registerSuggestion } = await import('../src/ai/events.js');
    const r = await registerSuggestion(s as never);
    return { ok: true, id: r.event?.id ?? null };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, error: { code: err.code, message: err.message ?? String(e) } };
  }
});

ipcMain.handle('events:dismiss', async (_e, candidateId: number) => {
  try { const { dismissSuggestion } = await import('../src/ai/events.js'); dismissSuggestion(candidateId); return { ok: true }; }
  catch (e) { return { ok: false, error: { message: (e as { message?: string }).message } }; }
});

// 대화: 로컬 자료를 근거로 내장 AI가 답한다 (E2)
ipcMain.handle('ask', async (_e, question: string, opts?: { effort?: 'low' | 'medium' | 'high' }) => {
  try {
    const { getAiProvider, EFFORT_MAX_TOKENS } = await import('../src/ai/provider.js');
    const { gatherContext, CHAT_SYSTEM } = await import('../src/ai/context.js');
    const effort = (opts && opts.effort) ?? loadSettings().aiEffort ?? 'medium';
    const p = await getAiProvider();
    await p.ensureReady?.((m: string) => win?.webContents.send('status', m));
    const answer = await p.complete(CHAT_SYSTEM, `자료:\n${gatherContext()}\n\n질문: ${question}`, { maxTokens: EFFORT_MAX_TOKENS[effort], effort });
    return { ok: true, answer, provider: p.name, model: p.label, effort };
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

// 구글 드라이브 데스크톱이 없을 때: 문서\KAIST를 자료 폴더로(폰에서는 안 보이지만 모든 기능 동작)
ipcMain.handle('drive:useLocal', () => {
  const root = path.join(app.getPath('documents'), 'KAIST');
  try { fs.mkdirSync(root, { recursive: true }); } catch (e) { return { ok: false, error: { message: `폴더를 만들지 못했습니다: ${(e as Error).message}` } }; }
  saveSettings({ driveRoot: root });
  return { ok: true, driveRoot: root };
});

ipcMain.handle('drive:pick', async () => {
  const r = await dialog.showOpenDialog({ title: '드라이브(KAIST) 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  saveSettings({ driveRoot: r.filePaths[0] });
  return { ok: true, driveRoot: r.filePaths[0] };
});

// AI 모델 선택 (설치 마법사 4단계)
ipcMain.handle('ai:state', async () => {
  const { catalogWithState } = await import('../src/ai/models.js');
  const { resolveAiSource } = await import('../src/ai/provider.js');
  const { chatGptState, USAGE_URL } = await import('../src/ai/chatgpt-auth.js');
  const s = loadSettings();
  const models = catalogWithState(s.aiModelUri);
  const source = resolveAiSource(s);
  const cur = models.find(m => m.selected);
  const cg = chatGptState();
  const cgModel = s.aiChatgptModel ?? cg.models[0]?.slug ?? '';
  const labels: Record<string, string> = {
    key: `${s.aiModel ?? 'gpt-6-luna'} · 외부`,
    chatgpt: `${cgModel || 'ChatGPT'} · ChatGPT 플랜`,
    local: `${cur?.label ?? '로컬 모델'} · 로컬`,
  };
  return {
    models, source, hasApiKey: !!s.aiApiKey, usingApiKey: source === 'key', apiBaseUrl: s.aiBaseUrl ?? '', apiModel: s.aiModel ?? '',
    chatgpt: { loggedIn: cg.loggedIn, email: cg.email ?? '', models: cg.models, model: cgModel, usageUrl: USAGE_URL },
    effort: s.aiEffort ?? 'medium',
    currentLabel: labels[source],
  };
});

// 마법사: 로컬 모델 선택(키·ChatGPT 로그인은 지우지 않고 선택만 바꾼다)
ipcMain.handle('ai:setModel', async (_e, uri: string) => {
  const { resetAiProvider } = await import('../src/ai/provider.js');
  saveSettings({ aiModelUri: uri, aiUseExternal: false, aiSource: 'local' });
  await resetAiProvider();
  return { ok: true };
});

ipcMain.handle('ai:setApiKey', async (_e, opts: { apiKey: string; baseUrl?: string; model?: string }) => {
  const { resetAiProvider } = await import('../src/ai/provider.js');
  saveSettings({ aiApiKey: opts.apiKey || undefined, aiBaseUrl: opts.baseUrl || undefined, aiModel: opts.model || undefined, aiUseExternal: !!opts.apiKey, aiSource: opts.apiKey ? 'key' : 'local' });
  await resetAiProvider();
  return { ok: true };
});

// 대화창 모델 선택기: 로컬 카탈로그 중 하나 / 외부(키 있을 때) / ChatGPT 플랜(로그인돼 있을 때)
ipcMain.handle('ai:select', async (_e, sel: { uri?: string; external?: boolean; chatgpt?: boolean; model?: string }) => {
  const { resetAiProvider } = await import('../src/ai/provider.js');
  const { hasChatGptToken } = await import('../src/ai/chatgpt-auth.js');
  if (sel.chatgpt) {
    if (!hasChatGptToken()) return { ok: false, error: { message: 'ChatGPT 플랜을 쓰려면 설정에서 "Continue with ChatGPT"로 먼저 로그인해야 합니다.' } };
    saveSettings({ aiSource: 'chatgpt', ...(sel.model ? { aiChatgptModel: sel.model } : {}) });
  } else if (sel.external) { if (!loadSettings().aiApiKey) return { ok: false, error: { message: '외부 AI는 설정에서 API 키를 먼저 넣어야 합니다.' } }; saveSettings({ aiUseExternal: true, aiSource: 'key' }); }
  else if (sel.uri) saveSettings({ aiModelUri: sel.uri, aiUseExternal: false, aiSource: 'local' });
  await resetAiProvider();
  return { ok: true };
});

// Continue with ChatGPT: 브라우저에서 OpenAI 로그인·동의 → 토큰 저장 → 이 PC의 ChatGPT 플랜으로 모델 호출
ipcMain.handle('chatgpt:login', async () => {
  const sendStatus = (msg: string) => win?.webContents.send('status', msg);
  try {
    const { chatGptLogin } = await import('../src/ai/chatgpt-auth.js');
    const { resetAiProvider } = await import('../src/ai/provider.js');
    const r = await chatGptLogin(sendStatus, { openUrl: (u) => { shell.openExternal(u).catch(() => { /* 상태줄에 URL이 있음 */ }); } });
    saveSettings({ aiSource: 'chatgpt', aiChatgptModel: loadSettings().aiChatgptModel ?? r.models[0]?.slug });
    await resetAiProvider();
    return { ok: true, email: r.email ?? '', models: r.models };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, error: { code: err.code ?? 'ERROR', message: err.message ?? String(e) } };
  }
});

ipcMain.handle('chatgpt:logout', async () => {
  const { chatGptLogout } = await import('../src/ai/chatgpt-auth.js');
  const { resetAiProvider } = await import('../src/ai/provider.js');
  chatGptLogout();
  if (loadSettings().aiSource === 'chatgpt') saveSettings({ aiSource: 'local' });
  await resetAiProvider();
  return { ok: true };
});

ipcMain.handle('chatgpt:usage', () => { shell.openExternal('https://chatgpt.com/settings/usage').catch(() => { /* 무시 */ }); return { ok: true }; });

ipcMain.handle('ai:setEffort', (_e, effort: 'low' | 'medium' | 'high') => { saveSettings({ aiEffort: effort }); return { ok: true }; });

// 일정 탭: 등록된 일정 목록(오늘 이후)과 취소(사용자가 누를 때만, confirmed)
ipcMain.handle('events:list', async () => {
  try {
    const { listSchoolEvents } = await import('../src/events/register.js');
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    return { ok: true, events: listSchoolEvents({ from: today }) };
  } catch (e) { return { ok: false, error: { message: (e as { message?: string }).message ?? String(e) } }; }
});
ipcMain.handle('events:cancel', async (_e, id: number) => {
  try { const { updateSchoolEvent } = await import('../src/events/register.js'); await updateSchoolEvent(id, { cancel: true, confirmed: true }); return { ok: true }; }
  catch (e) { return { ok: false, error: { message: (e as { message?: string }).message ?? String(e) } }; }
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

// 홈 화면: 저장된 세션 여부·신선도·다가오는 마감·시험/휴강. 모두 로컬 DB, 접속 없음.
ipcMain.handle('home:state', async () => {
  try {
    const { siteStatuses } = await import('../src/sites/session.js');
    const { listTasks } = await import('../src/store/queries.js');
    const { listSchoolEvents } = await import('../src/events/register.js');
    const now = Math.floor(Date.now() / 1000);
    const lastSync = getMeta('last_sync_at');
    const klms = siteStatuses().find(s => s.site === 'klms');
    const tasks = listTasks({ now, withinSec: 14 * 86400 })
      .filter(t => !t.removed)
      .map(t => ({ cmid: t.cmid, course: t.course, courseName: t.courseName, name: t.name, dueKst: t.dueKst, hoursLeft: t.hoursLeft, submission: t.submission, needsReview: t.needsReview }));
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const events = listSchoolEvents({ from: today })
      .map(e => ({ id: e.id, course: e.course, kind: e.kind, title: e.title, date: e.date, startKst: e.startKst, location: e.location, confidence: e.confidence }));
    return {
      ok: true,
      hasSavedId: !!getSavedId(),
      sessionSaved: !!(klms && klms.saved),
      lastSync,
      lastSyncMinutesAgo: lastSync ? Math.round((Date.now() - Date.parse(lastSync)) / 60000) : null,
      tasks, events,
    };
  } catch (e) {
    return { ok: false, error: { message: (e as { message?: string }).message ?? String(e) } };
  }
});

// 새 버전 감지: GitHub 릴리스(latest) 태그와 현재 버전 비교. 설치는 사용자가 받은 파일로 직접.
let lastUpdate: UpdateInfo | null = null;
let notifiedVersion: string | null = null;
async function runUpdateCheck(): Promise<UpdateInfo> {
  lastUpdate = await checkForUpdate(app.getVersion());
  if (lastUpdate.available && lastUpdate.latest !== notifiedVersion) {
    notifiedVersion = lastUpdate.latest;
    notify('KAISTBOT 새 버전', `v${lastUpdate.latest}이 나왔습니다. 앱에서 "다운로드"를 누르세요.`);
    win?.webContents.send('update', lastUpdate);
  }
  return lastUpdate;
}
ipcMain.handle('update:check', () => runUpdateCheck());
ipcMain.handle('update:open', () => { if (lastUpdate?.url) shell.openExternal(lastUpdate.url); return { ok: true }; });
app.whenReady().then(() => {
  setTimeout(() => { runUpdateCheck().catch(() => { /* 오프라인 등은 무시 */ }); }, 8000);
  setInterval(() => { runUpdateCheck().catch(() => { /* 무시 */ }); }, 6 * 3600e3);
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
