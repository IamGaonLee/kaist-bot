// V2: 세션이 아직 유효한지 확인. 결과를 local/session-checks.log에 추가.
// 사용법: npx tsx scripts/phase0/check-session.ts [--browser]
//   기본: 저장된 쿠키로 HTTP 요청 + 모바일 토큰 확인
//   --browser: 같은 프로필로 브라우저를 다시 열어 로그인 유지 여부 확인 (쿠키 파일도 갱신)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { get, sesskeyOf, short, LOCAL, BASE } from './http.ts';

const loginAt = new Date(fs.readFileSync(path.join(LOCAL, 'login-time.txt'), 'utf8').trim());
const mins = ((Date.now() - loginAt.getTime()) / 60000).toFixed(0);
const out: string[] = [`[${new Date().toISOString()}] 로그인 후 ${mins}분`];

if (process.argv.includes('--browser')) {
  const ctx = await chromium.launchPersistentContext(path.join(LOCAL, 'profile'), { headless: false });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const navs: string[] = [];
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(short(f.url())); });
  await page.goto(BASE + '/my/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const ok = await page.evaluate(() => !!(window as any).M?.cfg?.sesskey && !!document.querySelector('a[href*="login/logout.php"]')).catch(() => false);
  const klmsCookies = (await ctx.cookies(BASE)).map(c => c.name).join(',');
  out.push(`  browser(재실행): ${ok ? '로그인 유지' : '로그인 풀림'} / 경로: ${navs.join(' -> ')} / 남은 KLMS 쿠키: ${klmsCookies || '없음'}`);
  if (ok) fs.writeFileSync(path.join(LOCAL, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  await ctx.close();
} else {
  const r = await get('/my/');
  const loc = r.headers.get('location');
  const html = r.status === 200 ? await r.text() : '';
  const ok = r.status === 200 && !!sesskeyOf(html);
  out.push(`  http(쿠키): ${ok ? '유효' : '만료'} / status ${r.status}${loc ? ' -> ' + short(loc) : ''}`);
}

// 토큰은 사용하지 않기로 함(V7). 유효기간 비교가 꼭 필요할 때만 --token
const tokPath = path.join(LOCAL, 'wstoken.txt');
if (process.argv.includes('--token') && fs.existsSync(tokPath)) {
  const token = fs.readFileSync(tokPath, 'utf8').trim();
  const r = await get(`${BASE}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info&wstoken=${token}`);
  const j = await r.json() as any;
  out.push(`  ws토큰: ${j.exception ? `실패 (${j.errorcode})` : '유효'}`);
}

console.log(out.join('\n'));
fs.appendFileSync(path.join(LOCAL, 'session-checks.log'), out.join('\n') + '\n');
