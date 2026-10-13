// V7: 쿠키 + sesskey만으로 service.php AJAX 함수 범위 확인 (토큰 사용 안 함, launch.php 호출 안 함)
import fs from 'node:fs';
import path from 'node:path';
import { get, ajax, sesskeyOf, save, short, LOCAL } from './http.ts';

const COURSE = Number(process.argv[2] ?? 186294);
const SAMPLES = path.join(LOCAL, 'samples');
const now = Math.floor(Date.now() / 1000);

const probe = await get('/my/');
const sesskey = probe.status === 200 ? sesskeyOf(await probe.text()) : null;
if (!sesskey) { console.log('세션 만료:', probe.status, short(probe.headers.get('location'))); process.exit(1); }

// 기존 토큰 방식 샘플(디스크)에서 cmid/assign instance 확보 — 새 토큰 요청 없음
const tokContents = JSON.parse(fs.readFileSync(path.join(SAMPLES, `api-contents-${COURSE}.json`), 'utf8'));
const tokMods = tokContents.flatMap((s: any) => s.modules);
const assignMod = tokMods.find((m: any) => m.modname === 'assign');
const resMod = tokMods.find((m: any) => m.modname === 'resource');

// 키 경로 집합 (배열은 첫 원소만, 깊이 4)
function keys(v: any, p = '', d = 0, out = new Set<string>()): Set<string> {
  if (d > 4 || v === null || typeof v !== 'object') return out;
  if (Array.isArray(v)) return v.length ? keys(v[0], p + '[]', d + 1, out) : out;
  for (const k of Object.keys(v)) { out.add(p + '.' + k); keys(v[k], p + '.' + k, d + 1, out); }
  return out;
}
function diff(a: any, b: any) {
  const ka = keys(a), kb = keys(b);
  return { onlyAjax: [...ka].filter(k => !kb.has(k)), onlyToken: [...kb].filter(k => !ka.has(k)) };
}
const tokenSample = (f: string) => { const p = path.join(SAMPLES, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

const ids = { courseids: [COURSE] };
const calls: [string, object, string | null][] = [
  ['core_course_get_enrolled_courses_by_timeline_classification', { offset: 0, limit: 0, classification: 'inprogress', sort: 'fullname' }, null],
  ['core_calendar_get_action_events_by_timesort', { limitnum: 50, timesortfrom: now - 86400 }, null],
  ['core_course_get_contents', { courseid: COURSE }, `api-contents-${COURSE}.json`],
  ['mod_assign_get_assignments', ids, 'api-mod_assign_get_assignments.json'],
  ['mod_assign_get_submission_status', { assignid: assignMod?.instance ?? 0 }, 'api-mod_assign_get_submission_status.json'],
  ['mod_quiz_get_quizzes_by_courses', ids, 'api-mod_quiz_get_quizzes_by_courses.json'],
  ['mod_resource_get_resources_by_courses', ids, 'api-mod_resource_get_resources_by_courses.json'],
  ['mod_folder_get_folders_by_courses', ids, 'api-mod_folder_get_folders_by_courses.json'],
  ['mod_url_get_urls_by_courses', ids, 'api-mod_url_get_urls_by_courses.json'],
  ['mod_page_get_pages_by_courses', ids, 'api-mod_page_get_pages_by_courses.json'],
  ['mod_lti_get_ltis_by_courses', ids, 'api-mod_lti_get_ltis_by_courses.json'],
  ['core_course_get_updates_since', { courseid: COURSE, since: now - 7 * 86400 }, null],
  ['core_course_check_updates', { courseid: COURSE, tocheck: [{ contextlevel: 'module', id: resMod?.id ?? 0, since: now - 7 * 86400 }] }, null],
  ['core_calendar_get_calendar_events', { events: { courseids: [COURSE] }, options: { userevents: false, siteevents: false, timestart: now - 30 * 86400, timeend: now + 120 * 86400 } }, null],
  ['core_calendar_get_action_events_by_course', { courseid: COURSE, timesortfrom: now - 30 * 86400 }, null],
];

const results: any[] = [];
for (const [fn, args, sampleFile] of calls) {
  const r = await ajax(sesskey, fn, args);
  save(`ajax-v7-${fn}.json`, r.body);
  let row: any = { fn, http: r.status };
  try {
    const j = JSON.parse(r.body)[0];
    if (j.error) {
      row.ok = false;
      row.errorcode = j.exception?.errorcode;
      row.message = j.exception?.message;
    } else {
      row.ok = true;
      const d = j.data;
      const list = Array.isArray(d) ? d : (Object.values(d ?? {}).find(v => Array.isArray(v) && (v as any[]).length) as any[] | undefined) ?? [];
      row.count = Array.isArray(d) ? d.length : list.length;
      const tok = sampleFile ? tokenSample(sampleFile) : null;
      if (tok) {
        const dd = diff(d, tok);
        row.onlyAjax = dd.onlyAjax.slice(0, 15);
        row.onlyToken = dd.onlyToken.slice(0, 15);
      }
    }
  } catch (e) { row.ok = false; row.raw = r.body.slice(0, 200); }
  results.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(LOCAL, 'v7-results.json'), JSON.stringify(results, null, 2));

// 파일 URL 형식 + 쿠키 HEAD 1건 (get_contents가 성공한 경우)
const gc = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'ajax-v7-core_course_get_contents.json'), 'utf8'))[0];
if (!gc.error) {
  const f = gc.data.flatMap((s: any) => s.modules).find((m: any) => m.contents?.length)?.contents[0];
  console.log('fileurl 형식:', f?.fileurl?.replace(/\d+/g, 'N').slice(0, 140));
  if (f) {
    const h = await get(f.fileurl, { method: 'HEAD' });
    console.log('HEAD(쿠키, URL 그대로):', h.status, h.headers.get('content-type'), short(h.headers.get('location')));
  }
}
