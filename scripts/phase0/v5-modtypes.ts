// 이번 학기 과목들의 모듈 유형 집계 (영상 제공 방식 파악용)
import fs from 'node:fs';
import path from 'node:path';
import { get, save, LOCAL, BASE } from './http.ts';

const token = fs.readFileSync(path.join(LOCAL, 'wstoken.txt'), 'utf8').trim();
const ws = async (fn: string, params: Record<string, string | number>) => {
  const qs = new URLSearchParams({ moodlewsrestformat: 'json', wsfunction: fn, wstoken: token });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await get(`${BASE}/webservice/rest/server.php`, { method: 'POST', body: qs });
  return r.json() as Promise<any>;
};

const courses = JSON.parse(fs.readFileSync(path.join(LOCAL, 'samples', 'ajax-core_course_get_enrolled_courses_by_timeline_classification.json'), 'utf8'))[0].data.courses
  .filter((c: any) => c.shortname.endsWith('_2026_3'));
const total: Record<string, number> = {};
const examples: Record<string, any> = {};
for (const c of courses) {
  const contents = await ws('core_course_get_contents', { courseid: c.id });
  save(`api-contents-${c.id}.json`, JSON.stringify(contents, null, 2));
  for (const m of contents.flatMap((s: any) => s.modules)) {
    total[m.modname] = (total[m.modname] ?? 0) + 1;
    if (!examples[m.modname]) examples[m.modname] = { url: m.url?.replace(/\d+/g, 'N'), contents: m.contents?.[0] ? { type: m.contents[0].type, mimetype: m.contents[0].mimetype, fileurl: m.contents[0].fileurl?.replace(/\d+/g, 'N').slice(0, 120) } : null, customdata: m.customdata?.slice(0, 120) };
  }
}
console.log('과목 수:', courses.length);
console.log(JSON.stringify(total));
console.log(JSON.stringify(examples, null, 1));
