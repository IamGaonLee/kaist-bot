// SSO 로그인 창의 Playwright 드라이버 (CLI용). 포트는 browser-login.ts.
// 사용자가 직접 로그인·승인하고, 우리는 완료만 판별한다. 매번 새 컨텍스트를 쓴다.
import { chromium, type Page } from 'playwright';
import { LoginCancelledError, KaistError } from '../errors.js';
import { cookiesFor, type BrowserCookie, type BrowserLoginOptions, type ChainLoginOptions, type ChainLoginResult, type LoginDriver, type LoginPage, type LoginStep } from './browser-login.js';

// 로그인 중 이런 문구가 보이면 사용자에게 알리고 멈춰야 한다
const SUSPICIOUS = /captcha|recaptcha|자동화|비정상적인 접근|접근이 차단|access denied|request blocked/i;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const asLoginPage = (page: Page): LoginPage => ({
  evaluate: (fn: (arg: unknown) => unknown, arg?: unknown) => page.evaluate(fn as never, arg as never),
} as LoginPage);

/** 완료될 때까지 기다린다. 창이 닫히면 취소, 차단 문구면 중단 */
async function waitLoggedIn(page: Page, step: LoginStep, timeoutMs: number, isClosed: () => boolean): Promise<boolean> {
  const lp = asLoginPage(page);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isClosed()) throw new LoginCancelledError('closed');
    if (Date.now() > deadline) return false;
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const hit = text.match(SUSPICIOUS);
    if (hit) throw new KaistError('LOGIN_BLOCKED', `로그인 화면에 "${hit[0]}" 문구가 보입니다. 자동화 차단일 수 있어 중단합니다.`);
    if (await step.isLoggedIn(lp).catch(() => false)) return true;
    await sleep(1000);
  }
}

async function chainLogin(opts: ChainLoginOptions): Promise<ChainLoginResult> {
  const { timeoutMs = 5 * 60_000, chainTimeoutMs = 60_000, onStatus = () => {} } = opts;
  const [first, ...rest] = opts.steps;
  if (!first) throw new KaistError('INTERNAL', '로그인 단계가 없습니다.');
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    let closed = false;
    page.on('close', () => { closed = true; });
    browser.on('disconnected', () => { closed = true; });
    const isClosed = () => closed;

    await page.goto(first.startUrl, { waitUntil: 'domcontentloaded' });
    onStatus('브라우저 창에서 로그인과 폰 승인을 진행해 주세요.');
    if (!(await waitLoggedIn(page, first, timeoutMs, isClosed))) throw new LoginCancelledError('timeout');
    const ok: Record<string, boolean> = { [first.id]: true };

    for (const step of rest) {
      onStatus(`${step.id} 연쇄 로그인 중...`);
      await page.goto(step.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      ok[step.id] = await waitLoggedIn(page, step, chainTimeoutMs, isClosed);
      if (!ok[step.id]) onStatus(`${step.id} 연쇄 로그인이 시간 안에 끝나지 않았습니다. 나머지는 계속합니다.`);
      await sleep(1500); // 리다이렉트 마무리
    }
    return { ok, cookies: (await context.cookies()) as BrowserCookie[] };
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
    let closed = false;
    page.on('close', () => { closed = true; });
    browser.on('disconnected', () => { closed = true; });

    await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded' });
    onStatus('브라우저 창에서 로그인과 폰 승인을 진행해 주세요.');
    const step: LoginStep = { id: 'login', startUrl: opts.startUrl, isLoggedIn: opts.isLoggedIn };
    if (!(await waitLoggedIn(page, step, timeoutMs, () => closed))) throw new LoginCancelledError('timeout');

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
