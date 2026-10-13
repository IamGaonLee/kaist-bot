// V7: 과목 HTML이 API(core_course_get_contents)를 대체할 수 있는지 비교 (네트워크 요청 없음)
import fs from 'node:fs';
import path from 'node:path';
import { LOCAL } from './http.ts';

const COURSE = Number(process.argv[2] ?? 186294);
const S = path.join(LOCAL, 'samples');
const html = fs.readFileSync(path.join(S, `html-course-${COURSE}.html`), 'utf8');
const api = JSON.parse(fs.readFileSync(path.join(S, `api-contents-${COURSE}.json`), 'utf8'));
const apiMods = api.flatMap((s: any) => s.modules);

const htmlMods = [...html.matchAll(/<li class="activity (\w+) modtype_\w+[^"]*" id="module-(\d+)"/g)].map(m => ({ type: m[1], cmid: Number(m[2]) }));
const count = (xs: { type?: string; modname?: string }[]) => xs.reduce((a: any, x: any) => { const t = x.type ?? x.modname; a[t] = (a[t] ?? 0) + 1; return a; }, {});
console.log('HTML 모듈:', JSON.stringify(count(htmlMods)));
console.log('API  모듈:', JSON.stringify(count(apiMods)));
const htmlIds = new Set(htmlMods.map(m => m.cmid));
console.log('API에만 있는 cmid:', apiMods.filter((m: any) => !htmlIds.has(m.id)).map((m: any) => `${m.modname}:${m.visible}/${m.uservisible}`));

const sections = [...html.matchAll(/<span class="sectionname">([\s\S]*?)<\/span>/g)].map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
console.log('섹션(HTML):', sections.length, sections.slice(0, 3));
const dl = [...html.matchAll(/downloadFile\((?:'|&#039;)([^'&]+)(?:'|&#039;)/g)].map(m => m[1]);
console.log('파일 링크(HTML):', dl.length, dl[0]?.replace(/\d+/g, 'N'));
const endDt = [...html.matchAll(/<strong class="end-dt">([^<]*)<\/strong>/g)].map(m => m[1].trim());
console.log('end-dt 예:', endDt.slice(0, 4));
// API 과제 마감과 HTML end-dt 대조
const assigns = apiMods.filter((m: any) => m.modname === 'assign').map((m: any) => m.id);
for (const cmid of assigns.slice(0, 5)) {
  const li = html.match(new RegExp(`id="module-${cmid}"[\\s\\S]*?</li>`))?.[0] ?? '';
  console.log(`  assign ${cmid}: end-dt="${li.match(/<strong class="end-dt">([^<]*)</)?.[1]?.trim() ?? '-'}" status="${li.match(/<strong class="status[^"]*">([^<]*)</)?.[1]?.trim() ?? '-'}"`);
}
const lti = [...html.matchAll(/modtype_lti[^"]*" id="module-(\d+)"[\s\S]*?<span class="instancename[^"]*">([^<]*)/g)].map(m => `${m[1]} ${m[2].trim()}`);
console.log('LTI 제목(HTML):', lti.length, lti.slice(0, 3));

const month = JSON.parse(fs.readFileSync(path.join(S, 'ajax-v7alt-core_calendar_get_calendar_monthly_view.json'), 'utf8'))[0].data;
const evs = month.weeks.flatMap((w: any) => w.days.flatMap((d: any) => d.events));
console.log('월간 일정 이벤트:', evs.length, evs[0] ? Object.keys(evs[0]).join(',') : '-');
console.log('  예:', evs.slice(0, 3).map((e: any) => `${e.modulename}/${e.eventtype} instance=${e.instance} timestart=${e.timestart} course=${e.course?.id}`));
