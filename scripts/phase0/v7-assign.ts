// V7: 토큰 없이 과제 마감 얻기 — 캘린더 월별 뷰(AJAX) vs 과목 페이지 end-dt vs 과제 페이지
import fs from 'node:fs';
import path from 'node:path';
import { get, ajax, sesskeyOf, save, short, LOCAL } from './http.ts';

const COURSE = Number(process.argv[2] ?? 189782);
const S = path.join(LOCAL, 'samples');
const probe = await get('/my/');
const sesskey = probe.status === 200 ? sesskeyOf(await probe.text()) : null;
if (!sesskey) { console.log('세션 만료:', probe.status, short(probe.headers.get('location'))); process.exit(1); }

const apiAssign = JSON.parse(fs.readFileSync(path.join(S, `api-contents-${COURSE}.json`), 'utf8'))
  .flatMap((s: any) => s.modules).filter((m: any) => m.modname === 'assign');
const kst = (t: number) => new Date(t * 1000 + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

// 1) 캘린더 월별 (9~12월)
const calEvents: any[] = [];
for (const month of [9, 10, 11, 12]) {
  const r = await ajax(sesskey, 'core_calendar_get_calendar_monthly_view', { year: 2026, month, courseid: COURSE, categoryid: 0, includenavigation: false, mini: false });
  save(`ajax-v7-month-${COURSE}-${month}.json`, r.body);
  const j = JSON.parse(r.body)[0];
  if (j.error) { console.log('month', month, 'FAIL', j.exception?.errorcode); continue; }
  for (const w of j.data.weeks) for (const d of w.days) for (const e of d.events) calEvents.push(e);
}
const uniq = [...new Map(calEvents.map(e => [e.id, e])).values()];
console.log('캘린더 이벤트:', uniq.length, '/ 필드:', uniq[0] ? Object.keys(uniq[0]).join(',') : '-');

// 2) 과목 페이지(전체 주차)
const r = await get(`/course/view.php?id=${COURSE}&section=0`);
const html = await r.text();
save(`html-course-${COURSE}.html`, html);

console.log('\ncmid | 이름 | 캘린더(due) | end-dt(HTML) | 상태');
for (const m of apiAssign) {
  const ev = uniq.find(e => e.modulename === 'assign' && e.instance === m.instance && e.eventtype === 'due');
  const li = html.match(new RegExp(`id="module-${m.id}"[\\s\\S]*?</li>`))?.[0] ?? '';
  const endDt = li.match(/<strong class="end-dt">([^<]*)</)?.[1]?.trim() ?? '-';
  const status = li.match(/<strong class="status[^"]*">([\s\S]*?)<\/strong>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '-';
  console.log(`${m.id} | ${m.name} | ${ev ? kst(ev.timestart) : '없음'} | ${endDt} | ${status}`);
}
const others = uniq.filter(e => e.modulename !== 'assign' || e.eventtype !== 'due').map(e => `${e.modulename}/${e.eventtype}`);
console.log('기타 이벤트:', others);

// 3) 과제 페이지 1개 (기준값)
const a = apiAssign[0];
if (a) {
  const r2 = await get(`/mod/assign/view.php?id=${a.id}`);
  const h2 = await r2.text();
  save(`html-assign-${a.id}.html`, h2);
  const rows = [...h2.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)]
    .map(m => `${m[1].replace(/<[^>]+>/g, '').trim()}: ${m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}`)
    .filter(s => /마감|상태|남은|수정/.test(s));
  console.log(`\n과제 페이지 ${a.id}:`, rows);
  console.log('첨부 링크:', [...h2.matchAll(/pluginfile\.php\/[^"']*introattachment[^"']*/g)].length, '/ intro 존재:', h2.includes('id="intro"'));
}
