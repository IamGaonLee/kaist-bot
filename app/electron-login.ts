// SSO 로그인 창의 Electron 드라이버 (앱용). 포트는 src/sso/browser-login.ts.
// 숨긴 BrowserWindow(메모리 전용 partition)에서 로그인하고, 사용자는 앱 화면만 본다(폰 승인·번호·완료).
// Playwright 드라이버와 같은 포트·같은 스텝(prepare/describe/captureId/isLoggedIn)을 쓴다.
import { BrowserWindow, session as electronSession } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoginCancelledError, KaistError } from '../src/errors.js';
import { cookiesFor, type BrowserCookie, type BrowserLoginOptions, type ChainLoginOptions, type ChainLoginResult, type LoginDriver, type LoginPage, type LoginStep } from '../src/sso/browser-login.js';
import { loginFailureMessage } from '../src/sso/login-dialog.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** webContents.executeJavaScript로 포트의 evaluate(함수+인자)를 돌린다. 함수는 자기 완결적이어야 한다(Playwright evaluate와 동일 규약). */
function asLoginPage(win: BrowserWindow): LoginPage {
  return {
    evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) =>
      win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`, true),
  } as LoginPage;
}

/** preload가 보관한 alert 문구를 읽어 실패를 판별한다 */
function makeDialogWatcher(page: LoginPage) {
  let err: KaistError | null = null;
  return {
    async check(): Promise<void> {
      const msg = await page.evaluate(() => {
        const w = window as unknown as { __kaistDialogMsg?: string };
        const m = w.__kaistDialogMsg; if (m) w.__kaistDialogMsg = ''; return m ?? '';
      }).catch(() => '');
      if (msg) err = new KaistError('LOGIN_FAILED', loginFailureMessage(msg));
    },
    getError: (): KaistError | null => err,
  };
}

function makeWindow(headless: boolean, userAgent?: string): { win: BrowserWindow; partition: string } {
  const partition = `memory-login-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const win = new BrowserWindow({
    show: !headless,
    width: 480,
    height: 640,
    webPreferences: {
      partition,
      preload: path.join(dir, 'login-preload.cjs'),
      contextIsolation: false, // preload가 페이지 메인 월드에서 window.alert를 가로채야 함
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (userAgent) win.webContents.setUserAgent(userAgent);
  return { win, partition };
}

interface Ctx {
  page: LoginPage;
  isClosed: () => boolean;
  dialog: ReturnType<typeof makeDialogWatcher>;
}

async function waitLoggedIn(ctx: Ctx, step: LoginStep, timeoutMs: number, opts: { onStatus?(m: string): void; onId?(id: string): void } = {}): Promise<boolean> {
  const { page, isClosed, dialog } = ctx;
  let lastDesc = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isClosed()) throw new LoginCancelledError('closed');
    await dialog.check();
    const dlgErr = dialog.getError();
    if (dlgErr) throw dlgErr;
    if (Date.now() > deadline) return false;
    await step.prepare?.(page).catch(() => {});
    if (step.describe && opts.onStatus) {
      const d = await step.describe(page).catch(() => null);
      if (d && d !== lastDesc) { lastDesc = d; opts.onStatus(d); }
    }
    if (step.captureId && opts.onId) {
      const id = await step.captureId(page).catch(() => null);
      if (id) opts.onId(id);
    }
    if (await step.isLoggedIn(page).catch(() => false)) return true;
    await sleep(1000);
  }
}

async function readCookies(partition: string): Promise<BrowserCookie[]> {
  const list = await electronSession.fromPartition(partition).cookies.get({});
  return list.map(c => ({ name: c.name, value: c.value, domain: c.domain ?? '', path: c.path ?? '/', expires: c.expirationDate ?? -1 }));
}

async function chainLogin(opts: ChainLoginOptions): Promise<ChainLoginResult> {
  const { timeoutMs = 5 * 60_000, chainTimeoutMs = 60_000, onStatus = () => {} } = opts;
  const [first, ...rest] = opts.steps;
  if (!first) throw new KaistError('INTERNAL', '로그인 단계가 없습니다.');
  const { win, partition } = makeWindow(!!opts.headless, opts.userAgent);
  let closed = false;
  win.on('closed', () => { closed = true; });
  const page = asLoginPage(win);
  const ctx: Ctx = { page, isClosed: () => closed, dialog: makeDialogWatcher(page) };
  try {
    onStatus('로그인 중입니다...');
    await win.loadURL(first.startUrl).catch(() => {});
    let capturedId: string | undefined;
    if (!(await waitLoggedIn(ctx, first, timeoutMs, { onStatus, onId: id => { capturedId = id; } }))) {
      throw new LoginCancelledError('timeout');
    }
    const ok: Record<string, boolean> = { [first.id]: true };
    for (const step of rest) {
      onStatus(`${step.id} 연쇄 로그인 중...`);
      await win.loadURL(step.startUrl).catch(() => {});
      ok[step.id] = await waitLoggedIn(ctx, step, chainTimeoutMs, { onStatus });
      await sleep(1500);
    }
    return { ok, cookies: await readCookies(partition), capturedId };
  } finally {
    if (!closed) win.destroy();
    electronSession.fromPartition(partition).clearStorageData().catch(() => {});
  }
}

async function browserLogin(opts: BrowserLoginOptions): Promise<BrowserCookie[]> {
  const { win, partition } = makeWindow(false, undefined);
  let closed = false;
  win.on('closed', () => { closed = true; });
  const page = asLoginPage(win);
  const ctx: Ctx = { page, isClosed: () => closed, dialog: makeDialogWatcher(page) };
  try {
    opts.onStatus?.('브라우저 창에서 로그인과 폰 승인을 진행해 주세요.');
    await win.loadURL(opts.startUrl).catch(() => {});
    const step: LoginStep = { id: 'login', startUrl: opts.startUrl, isLoggedIn: opts.isLoggedIn };
    if (!(await waitLoggedIn(ctx, step, opts.timeoutMs ?? 5 * 60_000))) throw new LoginCancelledError('timeout');
    const cookies = cookiesFor(await readCookies(partition), opts.cookieDomain);
    if (!(await opts.verify(cookies))) throw new KaistError('LOGIN_VERIFY_FAILED', '브라우저에서는 로그인됐지만 저장한 쿠키로는 세션이 확인되지 않습니다.');
    return cookies;
  } finally {
    if (!closed) win.destroy();
    electronSession.fromPartition(partition).clearStorageData().catch(() => {});
  }
}

export const electronLoginDriver: LoginDriver = { chainLogin, browserLogin };
