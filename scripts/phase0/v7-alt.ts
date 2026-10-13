// V7 대체 수단: AJAX로 열려 있을 수 있는 함수 + 과목 HTML 페이지
import fs from 'node:fs';
import path from 'node:path';
import { get, ajax, sesskeyOf, save, short, LOCAL } from './http.ts';

const COURSE = Number(process.argv[2] ?? 186294);
const SAMPLES = path.join(LOCAL, 'samples');
const probe = await get('/my/');
const sesskey = probe.status === 200 ? sesskeyOf(await probe.text()) : null;
if (!sesskey) { console.log('세션 만료:', probe.status, short(probe.headers.get('location'))); process.exit(1); }

const mods = JSON.parse(fs.readFileSync(path.join(SAMPLES, `api-contents-${COURSE}.json`), 'utf8')).flatMap((s: any) => s.modules);
const assign = mods.find((m: any) => m.modname === 'assign');
const ev = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'ajax-v7-core_calendar_get_action_events_by_timesort.json'), 'utf8'))[0].data.events?.[0];
const d = new Date();

const calls: [string, object][] = [
  ['core_course_get_course_module', { cmid: assign?.id ?? 0 }],
  ['core_course_get_course_module_by_instance', { module: 'assign', instance: assign?.instance ?? 0 }],
  ['core_calendar_get_calendar_upcoming_view', { courseid: COURSE, categoryid: 0 }],
  ['core_calendar_get_calendar_monthly_view', { year: d.getFullYear(), month: d.getMonth() + 1, courseid: COURSE, categoryid: 0, includenavigation: false, mini: false }],
  ['core_calendar_get_calendar_event_by_id', { eventid: ev?.id ?? 0 }],
  ['theme_oklass39_get_user_semesters', {}],
  ['theme_oklass39_get_summary_activity', {}],
  ['format_kaistweeks_activity_average', {}],
];
for (const [fn, args] of calls) {
  const r = await ajax(sesskey, fn, args);
  save(`ajax-v7alt-${fn}.json`, r.body);
  const j = JSON.parse(r.body)[0];
  if (j.error) console.log(fn, 'FAIL', j.exception?.errorcode, '|', String(j.exception?.message).slice(0, 150), '|', String(j.exception?.debuginfo ?? '').slice(0, 150));
  else console.log(fn, 'OK', JSON.stringify(j.data).slice(0, 300));
}

const r = await get(`/course/view.php?id=${COURSE}`);
const html = r.status === 200 ? await r.text() : '';
save(`html-course-${COURSE}.html`, html);
console.log('course page', r.status, html.length);
