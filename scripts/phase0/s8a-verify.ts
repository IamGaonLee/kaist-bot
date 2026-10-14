// S8a 검증: 포털 로그인(2FA 1회) → KLMS·ERP·kds SSO 연쇄 → 쿠키만으로 HTTP 재현, SSO 쿠키 없이, 망가진 쿠키(만료 응답).
// 읽기 전용. 응답 본문·쿠키는 %LOCALAPPDATA%\kaist-cli\samples\portal\s8a\ 에만. 화면 출력은 개수·상태·구조만(값 없음).
// ERP 성적·kds 요청 본문은 지난 화면 기록(rec/<id>-req.txt)을 그대로 다시 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Cookie } from 'playwright';

const base = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'samples', 'portal');
const out = path.join(base, 's8a');
fs.mkdirSync(out, { recursive: true });
const rec = (id: number) => { const p = path.join(base, 'rec', `${id}-req.txt`); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const twoFactor: string[] = [];

// ---------- A. 브라우저: 사용자 로그인 + 자동 연쇄 (--replay면 저장된 쿠키로 B만) ----------
const replay = process.argv.includes('--replay');
let cookies: Cookie[] = replay ? JSON.parse(fs.readFileSync(path.join(out, 'cookies.json'), 'utf8')) : [];
if (!replay) {
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
page.on('framenavigated', f => {
  if (f !== page.mainFrame()) return;
  const u = new URL(f.url());
  if (/login2Factor/i.test(u.pathname)) twoFactor.push(`${ts()} (${current})`);
  console.log(`${ts()} NAV ${u.host}${u.pathname}`);
});
let current = 'portal';

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check().catch(() => false)) { console.log(`${ts()} ✓ ${label}`); return true; }
    await sleep(1500);
  }
  console.log(`${ts()} ✗ ${label} (시간 초과)`);
  return false;
}
const host = () => { try { return new URL(page.url()).host; } catch { return ''; } };

await page.goto('https://portal.kaist.ac.kr/common/login/login.do');
console.log('\n==== 포털 창에서 KAIST SSO 로그인과 폰 승인을 해 주세요. 그 뒤는 자동으로 진행합니다. ====\n');
const portalOk = await waitFor('포털 로그인', async () => host() === 'portal.kaist.ac.kr' && !page.url().includes('/login') &&
  await page.evaluate(async () => { const r = await fetch('/wz/api/widget/identity', { redirect: 'manual' }); return r.ok && (r.headers.get('content-type') ?? '').includes('json'); }), 5 * 60_000);

const chain = [
  { site: 'klms', url: 'https://klms.kaist.ac.kr/login/ssologin.php', ok: async () => host() === 'klms.kaist.ac.kr' && await page.evaluate(() => typeof (window as any).M?.cfg?.sesskey === 'string' && !document.body.classList.contains('notloggedin')) },
  { site: 'erp', url: 'https://portal.kaist.ac.kr/kaist/main/cais', ok: async () => host() === 'erp.kaist.ac.kr' && !/login/i.test(new URL(page.url()).pathname.replace('/com/lgin/SsoCtr/initPageWork.do', '')) },
  { site: 'kds', url: 'https://kds.kaist.ac.kr/login/ssoLogin.do', ok: async () => host() === 'kds.kaist.ac.kr' && !page.url().includes('/login') },
];
const chained: Record<string, boolean> = { portal: portalOk };
if (portalOk) {
  for (const c of chain) {
    current = c.site;
    await page.goto(c.url).catch(() => {});
    chained[c.site] = await waitFor(`${c.site} 연쇄 로그인`, c.ok, 60_000);
    await sleep(2500);
  }
}
cookies = await ctx.cookies();
fs.writeFileSync(path.join(out, 'cookies.json'), JSON.stringify(cookies, null, 2));
await browser.close();
console.log(`2단계 인증 화면: ${twoFactor.length}회 ${twoFactor.join(', ')}`);
console.log('연쇄 결과:', JSON.stringify(chained));
}

// 쿠키 구조 (값 없음)
const byDomain: Record<string, string[]> = {};
for (const c of cookies) (byDomain[c.domain] ??= []).push(`${c.name}${c.httpOnly ? '[H]' : ''}${c.expires === -1 ? '[세션]' : ''}`);
console.log('\n== 쿠키 (도메인별 이름, H=HttpOnly) ==');
for (const [d, n] of Object.entries(byDomain)) console.log(`  ${d}: ${n.join(', ')}`);

// ---------- B. 브라우저 없이 쿠키 + fetch ----------
type Mode = 'host' | 'host+parent' | 'broken';
function jar(url: string, mode: Mode): string {
  const h = new URL(url).hostname;
  return cookies.filter((c: Cookie) => {
    const d = c.domain.replace(/^\./, '');
    if (d === 'sso.kaist.ac.kr') return false; // SSO 쿠키는 쓰지 않는다 (설계)
    const exact = h === d;
    const parent = !exact && h.endsWith('.' + d);
    return exact || ((mode === 'host+parent' || mode === 'broken') && parent);
  }).map(c => `${c.name}=${mode === 'broken' ? 'x' + c.value.slice(1, 4) + 'broken' : c.value}`).join('; ');
}
async function call(label: string, url: string, init: RequestInit & { cookieMode?: Mode } = {}): Promise<{ status: number; ct: string; loc: string; text: string }> {
  await sleep(700);
  const { cookieMode, ...rest } = init;
  const r = await fetch(url, { ...rest, redirect: 'manual', headers: { 'User-Agent': UA, Cookie: jar(url, cookieMode ?? 'host+parent'), ...(init.headers as Record<string, string> ?? {}) } });
  const text = await r.text();
  fs.writeFileSync(path.join(out, `${label}.${(r.headers.get('content-type') ?? '').includes('json') ? 'json' : 'txt'}`), text);
  return { status: r.status, ct: r.headers.get('content-type') ?? '', loc: r.headers.get('location') ? new URL(r.headers.get('location')!, url).pathname : '', text };
}
const jsonCount = (t: string, f: (j: any) => unknown) => { try { return f(JSON.parse(t)); } catch { return '파싱 실패'; } };
const show = (label: string, r: { status: number; ct: string; loc: string }, extra: unknown = '') => console.log(`  ${label.padEnd(28)} ${r.status} ${r.ct.split(';')[0]}${r.loc ? ' → ' + r.loc : ''} ${extra}`);

const P = 'https://portal.kaist.ac.kr';
const json = { 'Content-Type': 'application/json' };
const form = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
const kdsH = { ...form, AJAX: 'true', 'X-Requested-With': 'XMLHttpRequest' };

for (const mode of ['host', 'host+parent', 'broken'] as Mode[]) {
  console.log(`\n== HTTP 재현: 쿠키 ${mode === 'host' ? '사이트 자기 도메인만' : mode === 'host+parent' ? '자기 + 상위(.kaist.ac.kr)' : '망가뜨림(만료 응답 확인)'} ==`);
  let r = await call(`${mode}-portal-stulist`, `${P}/wz/api/widget/schedule/stulist`, { method: 'POST', headers: json, body: '', cookieMode: mode });
  show('포털 시간표 stulist', r, r.ct.includes('json') ? `칸 ${jsonCount(r.text, j => j.data?.length)}` : '');
  r = await call(`${mode}-portal-collegePlan`, `${P}/wz/api/widget/collegePlan?bgngDt=2026-08-01&endDt=2026-12-31`, { cookieMode: mode });
  show('포털 학사일정 collegePlan', r, r.ct.includes('json') ? `일정 ${jsonCount(r.text, j => (j.data ?? j)?.length)}` : '');
  r = await call(`${mode}-portal-recents`, `${P}/wz/api/board/recents?pageIndex=1&recordCountPerPage=10`, { cookieMode: mode });
  show('포털 공지 recents', r, r.ct.includes('json') ? `글 ${jsonCount(r.text, j => j.data?.length)} / 전체 ${jsonCount(r.text, j => j.page?.totalRecord)}` : '');
  r = await call(`${mode}-erp-ntcn`, 'https://erp.kaist.ac.kr/com/cmsv/SendCtr/findNtcnCnt.do', { method: 'POST', headers: form, body: rec(125), cookieMode: mode });
  show('ERP 프로브 findNtcnCnt', r, r.ct.includes('json') ? `success=${jsonCount(r.text, j => j._METADATA_?.success)}` : '');
  r = await call(`${mode}-erp-grades`, 'https://erp.kaist.ac.kr/sch/sgra/SgrassCtr/findStdntEtcGradeList.do', { method: 'POST', headers: form, body: rec(203), cookieMode: mode });
  show('ERP 성적 (개수만)', r, r.ct.includes('json') ? `과목행 ${jsonCount(r.text, j => j.dsSgra100?.length)}, 학기행 ${jsonCount(r.text, j => j.dsSgra120?.length)}` : '');
  r = await call(`${mode}-kds-info`, 'https://kds.kaist.ac.kr/myDorm/selectDormPostngInfo.do', { method: 'POST', headers: kdsH, body: rec(243), cookieMode: mode });
  show('kds 배정 정보', r, `info-ulbox ${r.text.includes('info-ulbox')}`);
  r = await call(`${mode}-kds-sched`, 'https://kds.kaist.ac.kr/semesterScheduleList.do', { method: 'POST', headers: kdsH, body: rec(207) || 'yearMonth=202610', cookieMode: mode });
  show('kds 생활관 일정', r, r.ct.includes('json') ? `일정 ${jsonCount(r.text, j => j.semesterScheduleList?.length)}` : '');
  r = await call(`${mode}-klms-my`, 'https://klms.kaist.ac.kr/my/', { cookieMode: mode });
  show('KLMS /my/', r, `sesskey ${/"sesskey":"/.test(r.text)}`);
}
console.log('\n끝. 응답·쿠키는', out, '에만 저장됐습니다.');
