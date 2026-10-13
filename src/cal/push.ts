// 로컬 마감 → 구글 "KLMS" 캘린더 (설계 9절, S4 결정)
// - 마감 시각에 끝나는 30분 일정, 제목 "[과목명] 과제명", 알림은 마감 1일·3일 전
// - 제출한 과제는 제목 앞 ✓, 알림 없음
// - needs_review 과제는 새로 등록하지 않음(이미 있으면 ⚠ 표시), 사라진 과제(활동 삭제 또는 이번 학기 과제 목록에 없음)는 지우지 않고 제목에 표시
// - 비공개 속성 kaistCmid로 중복 방지
import { KaistError } from '../errors.js';
import { gcal, type GEvent } from '../google/calendar-api.js';
import { getMeta, openDb, setMeta } from '../store/db.js';
import { formatKst } from '../util/time.js';

export const CALENDAR_NAME = 'KLMS';
const EVENT_MINUTES = 30;
/** 마감 기준 알림(분). 구글 알림은 일정 시작 기준이라 30분을 빼서 넣는다 */
const REMIND_BEFORE_DUE = [24 * 60, 72 * 60];

export async function ensureCalendar(): Promise<string> {
  const saved = getMeta('gcal_calendar_id');
  if (saved) {
    try { await gcal.getCalendar(saved); return saved; }
    catch (e) { if (!(e instanceof KaistError && e.code === 'GCAL_NOT_FOUND')) throw e; }
  }
  const c = await gcal.createCalendar(CALENDAR_NAME, 'kaist CLI가 KLMS 과제 마감을 자동 등록하는 전용 캘린더입니다. 개인 일정을 여기에 넣지 마세요.');
  setMeta('gcal_calendar_id', c.id);
  return c.id;
}

interface TaskRow { cmid: number; modname: string; name: string; due: number | null; needs_review: number; review_reason: string | null;
  submission_code: string | null; course_name: string; code: string; url: string | null; removed_at: string | null; due_source: string | null }

const iso = (sec: number) => new Date(sec * 1000).toISOString();

export function eventFor(t: TaskRow, lastSync: string): GEvent {
  const submitted = t.submission_code === 'submitted';
  const prefix = t.removed_at ? '[KLMS에서 사라짐] ' : t.needs_review ? '⚠ ' : submitted ? '✓ ' : '';
  const label = t.modname === 'quiz' ? `퀴즈: ${t.name}` : t.name;
  const desc = [
    `마감: ${formatKst(t.due!)} (KST)${t.due_source === 'html' ? ' — 과목 페이지 기준' : ''}`,
    t.needs_review ? `⚠ 마감 정보가 서로 달라 확인이 필요합니다: ${t.review_reason}. KLMS에서 직접 확인하세요.` : '',
    t.removed_at ? 'KLMS 과목 페이지에서 이 활동이 사라졌습니다 (오탐일 수 있어 일정은 지우지 않았습니다).' : '',
    `과목: ${t.code} ${t.course_name}`,
    `KLMS: ${t.url ?? ''}`,
    '',
    `마지막 수집: ${formatKst(Math.floor(Date.parse(lastSync) / 1000))} (KST). PC에서 kaist sync를 해야 갱신됩니다.`,
  ].filter(s => s !== '').join('\n');
  return {
    summary: `${prefix}[${t.course_name}] ${label}`,
    description: desc,
    start: { dateTime: iso(t.due! - EVENT_MINUTES * 60), timeZone: 'Asia/Seoul' },
    end: { dateTime: iso(t.due!), timeZone: 'Asia/Seoul' },
    reminders: submitted || t.removed_at
      ? { useDefault: false, overrides: [] }
      : { useDefault: false, overrides: REMIND_BEFORE_DUE.map(m => ({ method: 'popup' as const, minutes: m - EVENT_MINUTES })) },
    extendedProperties: { private: { kaist: '1', kaistCmid: String(t.cmid) } },
  };
}

/** 마지막 수집 시각 줄을 뺀 설명 (내용 변경 판단용) */
const descBody = (d: string | undefined) => (d ?? '').split('\n').filter(l => !l.startsWith('마지막 수집:')).join('\n');

const sameContent = (a: GEvent, b: GEvent) =>
  a.summary === b.summary && descBody(a.description) === descBody(b.description)
  && Date.parse(a.start.dateTime) === Date.parse(b.start.dateTime) && Date.parse(a.end.dateTime) === Date.parse(b.end.dateTime)
  && reminderKey(a) === reminderKey(b);

/** 구글은 알림 순서를 임의로 바꿔 돌려준다 → 정렬해서 비교 */
const reminderKey = (e: GEvent) => (e.reminders?.overrides ?? []).map(o => `${o.method}:${o.minutes}`).sort().join(',');

export interface PushResult { calendarId: string; created: string[]; updated: string[]; refreshed: number; skippedReview: string[] }

export async function pushDeadlines(lastSync: string): Promise<PushResult> {
  const calId = await ensureCalendar();
  const db = openDb();
  const tasks = db.prepare(`select t.*, c.name course_name, c.code, m.url, m.removed_at from tasks t
    join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid
    where c.active = 1 order by t.due`).all() as unknown as TaskRow[];

  const existing = await gcal.listEvents(calId, { privateExtendedProperty: 'kaist=1', showDeleted: 'false' });
  const byCmid = new Map<string, GEvent>();
  const dupes: GEvent[] = [];
  for (const e of existing) {
    const k = e.extendedProperties?.private?.kaistCmid;
    if (!k) continue;
    if (byCmid.has(k)) dupes.push(e); else byCmid.set(k, e);
  }
  if (dupes.length) throw new KaistError('GCAL_DUPLICATES', `KLMS 캘린더에 같은 과제의 일정이 중복돼 있습니다 (${dupes.length}개). 정리 전에는 반영하지 않습니다.`);

  const res: PushResult = { calendarId: calId, created: [], updated: [], refreshed: 0, skippedReview: [] };
  for (const t of tasks) {
    const have = byCmid.get(String(t.cmid));
    if (t.due === null) {
      // 마감을 모르게 된 과제: 일정은 지우지 않고 ⚠만 붙인다 (마감이 처음부터 없으면 등록하지 않음)
      if (have && !have.summary.startsWith('⚠ ')) {
        await gcal.patchEvent(calId, have.id!, { summary: `⚠ ${have.summary.replace(/^✓ /, '')}`, description: `⚠ 마감 정보를 확인할 수 없습니다. KLMS에서 직접 확인하세요.\n\n${have.description ?? ''}` });
        res.updated.push(have.summary);
      }
      continue;
    }
    const want = eventFor(t, lastSync);
    if (!have) {
      if (t.needs_review) { res.skippedReview.push(want.summary); continue; }
      const ev = await gcal.insertEvent(calId, want);
      res.created.push(ev.summary);
    } else if (!sameContent(have, want)) {
      await gcal.patchEvent(calId, have.id!, want);
      res.updated.push(want.summary);
    } else if (have.description !== want.description) {
      // 내용은 같고 "마지막 수집" 시각만 새로 고침 (모바일에서 정보 신선도 확인용)
      await gcal.patchEvent(calId, have.id!, { description: want.description });
      res.refreshed++;
    }
  }
  // 로컬에 없는 일정(과목이 학기에서 빠졌거나 마감이 사라진 경우): 지우지 않고 표시만
  const known = new Set(tasks.map(t => String(t.cmid)));
  for (const [cmid, e] of byCmid) {
    if (known.has(cmid) || e.summary.startsWith('[KLMS에서 사라짐]')) continue;
    await gcal.patchEvent(calId, e.id!, { summary: `[KLMS에서 사라짐] ${e.summary}`, reminders: { useDefault: false, overrides: [] } });
    res.updated.push(e.summary);
  }
  setMeta('gcal_last_push', new Date().toISOString());
  return res;
}
