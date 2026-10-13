// V1/V2: persistent context로 창을 띄우고 사용자가 SSO 로그인을 마칠 때까지 대기.
// 사용법: npx tsx scripts/phase0/v1-login.ts [--chrome]
//   --chrome : 설치된 일반 Chrome 채널 사용 (V1이 막힐 때 비교용)
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://klms.kaist.ac.kr';
const LOCAL = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');
const useChrome = process.argv.includes('--chrome');
const PROFILE = path.join(LOCAL, useChrome ? 'profile-chrome' : 'profile');
const TIMEOUT_MS = 10 * 60 * 1000;
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

const log: string[] = [];
const note = (s: string) => { const line = `${ts()} ${s}`; log.push(line); console.log(line); };

// 쿼리스트링은 토큰이 섞일 수 있어 경로까지만 기록
const short = (u: string) => { try { const x = new URL(u); return x.origin + x.pathname; } catch { return u; } };

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  ...(useChrome ? { channel: 'chrome' } : {}),
  viewport: null,
});
const page = ctx.pages()[0] ?? await ctx.newPage();

page.on('framenavigated', f => { if (f === page.mainFrame()) note(`NAV ${short(f.url())}`); });

async function loggedInSignal(p: Page) {
  const url = new URL(p.url());
  if (url.host !== 'klms.kaist.ac.kr' || url.pathname.startsWith('/login')) return null;
  return p.evaluate(() => {
    const M = (window as any).M;
    const hasSesskey = !!M?.cfg?.sesskey;
    const logout = !!document.querySelector('a[href*="login/logout.php"]');
    const userid = document.body?.getAttribute('data-userid') ?? null;
    const bodyId = document.body?.id ?? '';
    return { hasSesskey, logout, hasUserIdAttr: userid !== null, bodyId };
  }).catch(() => null);
}

const suspicious = /captcha|recaptcha|robot|자동화|비정상|차단|blocked|access denied/i;

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
note('브라우저 창에서 KAIST SSO 로그인과 폰 승인을 진행해 주세요.');

let signal: Awaited<ReturnType<typeof loggedInSignal>> = null;
const seenWarnings = new Set<string>();
while (Date.now() - t0 < TIMEOUT_MS) {
  await page.waitForTimeout(2000);
  if (page.isClosed()) { note('창이 닫힘'); break; }
  const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const m = text.match(suspicious);
  if (m && !seenWarnings.has(m[0])) { seenWarnings.add(m[0]); note(`의심 문구 감지: "${m[0]}" at ${short(page.url())}`); }
  signal = await loggedInSignal(page);
  if (signal?.hasSesskey && signal.logout) break;
}

if (signal?.hasSesskey) {
  note(`로그인 완료 판별: ${JSON.stringify(signal)} url=${short(page.url())}`);
  await page.waitForTimeout(1500);
  const html = await page.content();
  fs.writeFileSync(path.join(LOCAL, 'samples', 'dashboard.html'), html);
  const cookies = await ctx.cookies();
  // V3용 쿠키 저장 (local/ 안에만)
  fs.writeFileSync(path.join(LOCAL, 'cookies.json'), JSON.stringify(cookies, null, 2));
  note('쿠키 (값 제외):');
  for (const c of cookies) {
    const exp = c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString();
    note(`  ${c.domain}\t${c.name}\texpires=${exp}\thttpOnly=${c.httpOnly}\tsecure=${c.secure}\tsameSite=${c.sameSite}`);
  }
  fs.writeFileSync(path.join(LOCAL, 'login-time.txt'), new Date().toISOString());
} else {
  note('로그인 완료를 확인하지 못함');
}

fs.writeFileSync(path.join(LOCAL, `v1-log${useChrome ? '-chrome' : ''}.txt`), log.join('\n'));
await ctx.close();
