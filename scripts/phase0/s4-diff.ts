// S4 진단: 캘린더 일정과 로컬에서 만든 일정의 차이 (제목/시각/알림만 출력)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { gcal } from '../../src/google/calendar-api.ts';
import { eventFor } from '../../src/cal/push.ts';
import { getMeta } from '../../src/store/db.ts';

const d = new DatabaseSync(path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'kaist.db'));
const calId = getMeta('gcal_calendar_id')!;
const evs = await gcal.listEvents(calId, { privateExtendedProperty: 'kaist=1' });
const tasks = d.prepare(`select t.*, c.name course_name, c.code, m.url, m.removed_at from tasks t join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid`).all() as any[];
for (const e of evs) {
  const t = tasks.find(x => String(x.cmid) === e.extendedProperties?.private?.kaistCmid);
  if (!t) continue;
  const w = eventFor(t, getMeta('last_sync_at')!);
  const diffs: string[] = [];
  if (w.summary !== e.summary) diffs.push(`summary "${e.summary}" vs "${w.summary}"`);
  if (Date.parse(w.start.dateTime) !== Date.parse(e.start.dateTime)) diffs.push(`start ${e.start.dateTime} vs ${w.start.dateTime}`);
  if (JSON.stringify(w.reminders?.overrides ?? []) !== JSON.stringify(e.reminders?.overrides ?? [])) diffs.push(`reminders ${JSON.stringify(e.reminders)} vs ${JSON.stringify(w.reminders)}`);
  const strip = (s?: string) => (s ?? '').split('\n').filter(l => !l.startsWith('마지막 수집:')).join('\n');
  if (strip(w.description) !== strip(e.description)) diffs.push('description body differs');
  if (diffs.length) console.log(t.name, '|', diffs.join(' | '));
}
