// Portal 0단계 (로그인): 사용자가 직접 화면을 누르는 동안 *.kaist.ac.kr 요청·응답을 기록한다 (KLMS 제외).
// 읽기 전용 관찰만 한다. 기록·응답 본문은 %LOCALAPPDATA%\kaist-cli\samples\portal\rec\ 에만 저장(성적 포함, 저장소 밖).
// 사용법: npx tsx scripts/phase0/portal-recorder.ts   (창을 닫으면 끝)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const dir = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'samples', 'portal', 'rec');
fs.mkdirSync(dir, { recursive: true });
const log = fs.createWriteStream(path.join(dir, 'recording.jsonl'));
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1);
let n = 0;
const twoFactor: string[] = [];

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

ctx.on('page', p => p.on('framenavigated', f => { if (f === p.mainFrame()) nav(f.url()); }));
page.on('framenavigated', f => { if (f === page.mainFrame()) nav(f.url()); });
function nav(u: string) {
  const x = new URL(u);
  if (/login2Factor|twofactor/i.test(x.pathname)) twoFactor.push(`${ts()}s ${x.host}`);
  console.log(`${ts()}s NAV ${x.host}${x.pathname}`);
  log.write(JSON.stringify({ t: ts(), type: 'nav', host: x.host, path: x.pathname }) + '\n');
}

ctx.on('response', async res => {
  const req = res.request();
  const u = new URL(req.url());
  if (!u.host.endsWith('kaist.ac.kr') || u.host === 'klms.kaist.ac.kr') return;
  const type = req.resourceType();
  if (!['xhr', 'fetch', 'document'].includes(type)) return;
  const ct = res.headers()['content-type'] ?? '';
  const id = ++n;
  const rec: Record<string, unknown> = { t: ts(), id, type, method: req.method(), host: u.host, path: u.pathname, queryKeys: [...u.searchParams.keys()], status: res.status(), ct };
  try {
    const post = req.postData();
    if (post) { fs.writeFileSync(path.join(dir, `${id}-req.txt`), post); rec.postBytes = post.length; }
    if (type !== 'document' || /json|xml/.test(ct)) {
      const body = await res.body();
      fs.writeFileSync(path.join(dir, `${id}-res.${/json/.test(ct) ? 'json' : /xml/.test(ct) ? 'xml' : 'txt'}`), body);
      rec.resBytes = body.length;
    }
  } catch { /* 리다이렉트 등 본문 없음 */ }
  log.write(JSON.stringify(rec) + '\n');
});

await page.goto('https://portal.kaist.ac.kr/');
console.log(`
==== 기록 중 ====
1) 포털에서 "로그인" → KAIST SSO 로그인과 폰 승인
2) 포털 학생 공지 목록 → 글 하나 열기
3) 학사시스템(ERP)에서 내 시간표(이번 학기) 화면 열기
4) 성적 조회 화면 열기 (보기만)
5) 생활관(kds.kaist.ac.kr) → 로그인 → 내 배정 정보 화면 열기
※ 수강신청·신청·변경 버튼은 누르지 마세요. 다 끝나면 브라우저 창을 닫으면 됩니다.
`);
await new Promise<void>(r => browser.on('disconnected', () => r()));
log.end();
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ requests: n, twoFactor }, null, 2));
console.log(`기록 끝: 요청 ${n}건, 2단계 인증 화면 ${twoFactor.length}회 ${twoFactor.join(', ')}`);
