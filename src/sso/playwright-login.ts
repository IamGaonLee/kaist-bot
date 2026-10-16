// SSO 로그인 창의 Playwright 드라이버 (CLI용). 포트는 browser-login.ts.
// 간편 로그인: 아이디만 채우고(비밀번호 없음) 버튼을 누른 뒤, 사용자의 폰 승인을 기다린다.
// 실패 감지: 정상 로그인에는 alert가 없다(실측). 로그인 중 alert가 뜨면 문구로 분류해 멈춘다.
import { chromium, type Dialog, type Page } from 'playwright';
import { LoginCancelledError, KaistError } from '../errors.js';
import { cookiesFor, type BrowserCookie, type BrowserLoginOptions, type ChainLoginOptions, type ChainLoginResult, type LoginDriver, type LoginPage, type LoginStep } from './browser-login.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const asLoginPage = (page: Page): LoginPage => ({
  evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) => page.evaluate(fn as never, arg as never),
} as LoginPage);

// KAIST_LOGIN_DEBUG=1이면 각 화면의 클릭 요소(버튼·앵커)를 한 번씩 기록한다(라벨·선택자만, 개인정보 없음).
const LOGIN_DEBUG = !!process.env.KAIST_LOGIN_DEBUG;
async function debugStage(page: Page, seen: Set<string>): Promise<void> {
  if (!LOGIN_DEBUG) return;
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, input[type=button], input[type=submit], [onclick]')]
      .filter(e => (e as HTMLElement).offsetParent !== null)
      .map(e => {
        const img = e.querySelector('img');
        return {
          tag: e.tagName.toLowerCase(), id: (e as HTMLElement).id || '', cls: String((e as HTMLElement).className || '').slice(0, 50),
          txt: ((e as HTMLElement).innerText || (e as HTMLInputElement).value || '').trim().slice(0, 24),
          href: ((e as HTMLAnchorElement).getAttribute?.('href') || '').slice(-50),
          onclick: (e.getAttribute('onclick') || '').slice(0, 50),
          img: img ? (img.getAttribute('alt') || img.getAttribute('src') || '').slice(-40) : '',
        };
      })
      .filter(e => e.txt || e.id || e.href || e.onclick || e.img);
    return { path: location.host + location.pathname, els };
  }).catch(() => null);
  if (!info) return;
  const key = info.path;
  if (seen.has(key)) return;
  seen.add(key);
  console.error(`\n[login-debug] STAGE ${info.path} (${info.els.length})`);
  for (const e of info.els) console.error(`[login-debug]   <${e.tag} id="${e.id}" class="${e.cls}"> txt="${e.txt}" href="${e.href}" onclick="${e.onclick}" img="${e.img}"`);
}

/** 로그인 중 뜬 alert 문구 분류. 없으면 null(원문 짧게 보여줌). */
function classifyLoginDialog(msg: string): string | null {
  const m = msg || '';
  if (/잠[겼금]|lock|정지|제한.*횟수|\d+회 이상/i.test(m)) return '계정이 잠겼거나 로그인 시도가 제한되었습니다';
  if (/거[부절]|reject|승인.*(거|실패)/i.test(m)) return '폰에서 승인이 거부되었습니다';
  if (/차단|block|비정상적인 접근/i.test(m)) return '접근이 차단되었습니다';
  if (/중복|다른 곳|이미 로그인|duplicate/i.test(m)) return '다른 곳에서 로그인 중입니다';
  if (/일치하지|불일치|mismatch/i.test(m)) return '인증 번호가 일치하지 않습니다';
  if (/만료|시간.*초과|timeout|expire/i.test(m)) return '시간이 초과되었습니다';
  if (/아이디|비밀번호|존재하지|확인해/i.test(m)) return '아이디 또는 비밀번호가 올바르지 않습니다';
  return null;
}

/** page.on('dialog')로 실패를 잡는다. 반환한 getter가 에러를 주면 대기 루프가 멈춘다. */
function watchDialogs(page: Page): () => KaistError | null {
  let err: KaistError | null = null;
  page.on('dialog', (d: Dialog) => {
    const reason = classifyLoginDialog(d.message());
    err = new KaistError('LOGIN_FAILED', `로그인이 중단됐습니다: ${reason ?? (d.message() || '알 수 없는 알림').slice(0, 100)}`);
    d.dismiss().catch(() => {});
  });
  return () => err;
}

interface WaitOpts {
  getDialogError?: () => KaistError | null;
  captureId?(page: LoginPage): Promise<string | null>;
  onId?(id: string): void;
  onStatus?(message: string): void;
}

/** 완료될 때까지 기다린다. 창이 닫히면 취소, alert 실패면 중단. captureId가 있으면 매 회 읽어 둔다. */
async function waitLoggedIn(page: Page, step: LoginStep, timeoutMs: number, isClosed: () => boolean, opts: WaitOpts = {}): Promise<boolean> {
  const lp = asLoginPage(page);
  const seen = new Set<string>();
  let lastDesc = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isClosed()) throw new LoginCancelledError('closed');
    const dlgErr = opts.getDialogError?.();
    if (dlgErr) throw dlgErr;
    if (Date.now() > deadline) return false;
    await debugStage(page, seen);
    await step.prepare?.(lp).catch(() => {});
    if (step.describe && opts.onStatus) {
      const d = await step.describe(lp).catch(() => null);
      if (d && d !== lastDesc) { lastDesc = d; opts.onStatus(d); }
    }
    if (opts.captureId) {
      const id = await opts.captureId(lp).catch(() => null);
      if (id) opts.onId?.(id);
    }
    if (await step.isLoggedIn(lp).catch(() => false)) return true;
    await sleep(1000);
  }
}

async function chainLogin(opts: ChainLoginOptions): Promise<ChainLoginResult> {
  const { timeoutMs = 5 * 60_000, chainTimeoutMs = 60_000, onStatus = () => {} } = opts;
  const [first, ...rest] = opts.steps;
  if (!first) throw new KaistError('INTERNAL', '로그인 단계가 없습니다.');
  const browser = await chromium.launch({ headless: !!opts.headless });
  try {
    const context = await browser.newContext({ viewport: opts.headless ? undefined : null, userAgent: opts.userAgent });
    const page = await context.newPage();
    const getDialogError = watchDialogs(page);
    let closed = false;
    page.on('close', () => { closed = true; });
    browser.on('disconnected', () => { closed = true; });
    const isClosed = () => closed;

    await page.goto(first.startUrl, { waitUntil: 'domcontentloaded' });
    onStatus(opts.headless ? '로그인 중입니다...' : first.prepare ? '프로그램이 로그인 화면을 넘깁니다. 폰에서 로그인을 승인해 주세요.' : '브라우저 창에서 로그인과 폰 승인을 진행해 주세요.');
    let capturedId: string | undefined;
    if (!(await waitLoggedIn(page, first, timeoutMs, isClosed, { getDialogError, onStatus, captureId: first.captureId, onId: id => { capturedId = id; } }))) {
      throw new LoginCancelledError('timeout');
    }
    const ok: Record<string, boolean> = { [first.id]: true };

    for (const step of rest) {
      onStatus(`${step.id} 연쇄 로그인 중...`);
      await page.goto(step.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      ok[step.id] = await waitLoggedIn(page, step, chainTimeoutMs, isClosed, { getDialogError, onStatus });
      if (!ok[step.id]) onStatus(`${step.id} 연쇄 로그인이 시간 안에 끝나지 않았습니다. 나머지는 계속합니다.`);
      await sleep(1500); // 리다이렉트 마무리
    }
    return { ok, cookies: (await context.cookies()) as BrowserCookie[], capturedId };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 한 사이트만 로그인 (브라우저를 닫기 전에 쿠키를 확인) */
async function browserLogin(opts: BrowserLoginOptions): Promise<BrowserCookie[]> {
  const { timeoutMs = 5 * 60_000, onStatus = () => {} } = opts;
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    const getDialogError = watchDialogs(page);
    let closed = false;
    page.on('close', () => { closed = true; });
    browser.on('disconnected', () => { closed = true; });

    await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded' });
    onStatus('브라우저 창에서 로그인과 폰 승인을 진행해 주세요.');
    const step: LoginStep = { id: 'login', startUrl: opts.startUrl, isLoggedIn: opts.isLoggedIn };
    if (!(await waitLoggedIn(page, step, timeoutMs, () => closed, { getDialogError }))) throw new LoginCancelledError('timeout');

    const cookies = cookiesFor((await context.cookies()) as BrowserCookie[], opts.cookieDomain);
    if (!(await opts.verify(cookies))) {
      throw new KaistError('LOGIN_VERIFY_FAILED', '브라우저에서는 로그인됐지만 저장한 쿠키로는 세션이 확인되지 않습니다.');
    }
    return cookies;
  } finally {
    await browser.close().catch(() => {});
  }
}

export const playwrightLoginDriver: LoginDriver = { chainLogin, browserLogin };
