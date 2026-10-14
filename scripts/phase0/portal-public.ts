// Portal 0단계 (공개 자료): OTL 시간표, 학사일정 페이지, 학교 공지 목록. 로그인 없음, 요청 최소 (과목당 1회 + 2회)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');
const out = path.join(home, 'samples', 'portal');
fs.mkdirSync(out, { recursive: true });
const db = new DatabaseSync(path.join(home, 'kaist.db'));
const courses = db.prepare('select code, name from courses where active = 1 order by code').all() as { code: string; name: string }[];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

// 1) OTL: 과목코드(분반 제외)로 검색해 분반이 맞는 강의의 시간표
for (const c of courses) {
  const base = c.code.replace(/\(.*\)$/, '');
  const cls = c.code.match(/\((\w+)\)$/)?.[1] ?? '';
  const r = await fetch(`https://otl.kaist.ac.kr/api/lectures?year=2026&semester=3&keyword=${encodeURIComponent(base)}`, { headers: UA });
  const j = await r.json().catch(() => null) as any[] | null;
  fs.writeFileSync(path.join(out, `otl-${base}.json`), JSON.stringify(j, null, 2));
  const hits = (j ?? []).filter(l => l.code === base);
  const pick = hits.filter(l => (l.class_no ?? '') === cls);
  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  console.log(`${c.code.padEnd(14)} HTTP ${r.status}, 같은 코드 ${hits.length}개 분반${cls ? `, 분반 ${cls} ${pick.length}개` : ''} →`,
    (pick.length ? pick : hits).slice(0, 2).map(l => `[${l.class_no || '-'}] ` + (l.classtimes ?? []).map((t: any) => `${days[t.day] ?? t.day} ${fmt(t.begin)}~${fmt(t.end)} ${t.classroom_short ?? t.classroom ?? ''}`).join(', ')).join(' | '));
  await sleep(1500);
}

// 2) 학사일정 (공개)
const cal = await fetch('https://www.kaist.ac.kr/kr/html/edu/03110101.html', { headers: UA });
const calHtml = await cal.text();
fs.writeFileSync(path.join(out, 'kaist-academic-calendar.html'), calHtml);
console.log('학사일정 페이지', cal.status, calHtml.length, '바이트, "중간고사" 포함:', calHtml.includes('중간고사'));
await sleep(1500);

// 3) 학교 공지 목록 (공개)
const nt = await fetch('https://www.kaist.ac.kr/kr/html/footer/0802.html', { headers: UA });
const ntHtml = await nt.text();
fs.writeFileSync(path.join(out, 'kaist-notice-list.html'), ntHtml);
console.log('공지 목록', nt.status, ntHtml.length, '바이트, 글 링크 수:', (ntHtml.match(/mode=V&(amp;)?no=/g) ?? []).length);
