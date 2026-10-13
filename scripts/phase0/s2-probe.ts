// S2 사전 확인: updates_since(since=0) 범위, 사이트 전체 월별 캘린더 (요청 4건)
import fs from 'node:fs';
import path from 'node:path';
import { ensureSession } from '../../src/klms/session.ts';

const s = await ensureSession({ interactive: false });
const S = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'samples');
for (const id of [186294, 189782]) {
  const htmlText = await s.http.html(`/course/view.php?id=${id}&section=0`);
  fs.writeFileSync(path.join(S, `html-course-${id}.html`), htmlText);
  const types = new Map([...htmlText.matchAll(/<li class="activity (\w+) modtype_\w+[^"]*" id="module-(\d+)"/g)].map(m => [Number(m[2]), m[1]!]));
  const r: any = await s.ajax('core_course_get_updates_since', { courseid: id, since: 0 });
  const ids = new Set<number>(r.instances.map((i: any) => i.id));
  const onlyHtml = [...types.keys()].filter(x => !ids.has(x)).map(x => types.get(x));
  const onlyUpd = [...ids].filter(x => !types.has(x));
  console.log(`course ${id}: updates ${ids.size}, HTML ${types.size}, HTML-only [${onlyHtml}], updates-only [${onlyUpd}]`);
}
if (process.argv.includes('--calendar')) for (const month of [9, 10]) {
  const r: any = await s.ajax('core_calendar_get_calendar_monthly_view', { year: 2026, month, courseid: 1, categoryid: 0, includenavigation: false, mini: false });
  const evs = r.weeks.flatMap((w: any) => w.days.flatMap((d: any) => d.events));
  const byCourse: Record<string, number> = {};
  for (const e of evs) { const k = `${e.course?.id}:${e.modulename}/${e.eventtype}`; byCourse[k] = (byCourse[k] ?? 0) + 1; }
  console.log(`monthly courseid=1 m${month}: ${evs.length}`, JSON.stringify(byCourse));
}
s.http.persist();
