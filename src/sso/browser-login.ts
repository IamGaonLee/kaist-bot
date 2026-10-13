// SSO 로그인 창 (사이트 무관). 사용자가 직접 입력·승인하고, 우리는 완료만 판별한다.
// 비밀번호는 다루지 않으며, 매번 새 컨텍스트를 쓴다(브라우저 프로필/자동완성 없음).
import { chromium, type Cookie, type Page } from 'playwright';
import { LoginCancelledError, KaistError } from '../errors.js';

export interface BrowserLoginOptions {
  startUrl: string;
  /** 로그인 완료 여부. 예외는 '아직 아님'으로 취급한다. */
  isLoggedIn(page: Page): Promise<boolean>;
  /** 돌려줄 쿠키의 도메인 (정확히 일치하거나 하위 도메인) */
  cookieDomain: string;
  /** 브라우저를 닫기 전에 쿠키가 브라우저 밖에서도 통하는지 확인 */
  verify(cookies: Cookie[]): Promise<boolean>;
  timeoutMs?: number;
  onStatus?(message: string): void;
}

// 로그인 중 이런 문구가 보이면 사용자에게 알리고 멈춰야 한다
const SUSPICIOUS = /captcha|recaptcha|자동화|비정상적인 접근|접근이 차단|access denied|request blocked/i;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function browserLogin(opts: BrowserLoginOptions): Promise<Cookie[]> {
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

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (closed) throw new LoginCancelledError('closed');
      if (Date.now() > deadline) throw new LoginCancelledError('timeout');
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const hit = text.match(SUSPICIOUS);
      if (hit) throw new KaistError('LOGIN_BLOCKED', `로그인 화면에 "${hit[0]}" 문구가 보입니다. 자동화 차단일 수 있어 중단합니다.`);
      if (await opts.isLoggedIn(page).catch(() => false)) break;
      await sleep(1000);
    }

    const domain = opts.cookieDomain;
    const cookies = (await context.cookies()).filter(c => {
      const d = c.domain.replace(/^\./, '');
      return d === domain || d.endsWith('.' + domain);
    });
    if (!(await opts.verify(cookies))) {
      throw new KaistError('LOGIN_VERIFY_FAILED', '브라우저에서는 로그인됐지만 저장한 쿠키로는 세션이 확인되지 않습니다.');
    }
    return cookies;
  } finally {
    await browser.close().catch(() => {});
  }
}
