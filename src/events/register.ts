// 학사 일정 등록·변경·되돌리기 + 구글 "KLMS" 캘린더 반영 (S6 설계 2~4절)
import { KaistError } from '../errors.js';
import { gcal, type GEvent } from '../google/calendar-api.js';
import { ensureCalendar } from '../cal/push.js';
import { getMeta, openDb, tx } from '../store/db.js';
import { formatKst, nowSec, parseDashKst } from '../util/time.js';
import { setCandidateStatus, type Kind } from './candidates.js';
import { dayInfo, verifyEvent, type Verdict } from './verify.js';

export class NeedsConfirmationError extends KaistError {
  constructor(public readonly verdict: Verdict) {
    super('NEEDS_CONFIRMATION', `사용자 확인이 필요한 일정입니다 (${verdict.needsConfirmReasons.join(', ')}). 사용자에게 확인받은 뒤 --confirmed를 붙여 다시 실행하세요.`, { reasons: verdict.needsConfirmReasons });
  }
}

const KIND_LABEL: Record<Kind, string> = { exam: '시험', no_class: '휴강', online: '온라인 수업', makeup: '보강' };
const COLOR: Record<Kind, string> = { exam: '11', no_class: '8', online: '9', makeup: '6' };
/** 알림(분, 일정 시작 기준). 종일 일정은 0시 기준이라 전날 09:00이 되도록 보정 */
const REMIND: Record<Kind, number[]> = { exam: [7 * 1440, 1440], no_class: [1440], online: [1440], makeup: [1440] };
const allDayRemind = (mins: number[]) => mins.map(m => m - 9 * 60);

export interface SchoolEventRow {
  id: number; course_id: number; kind: Kind; title: string; date: string; start_at: number | null; end_at: number | null; all_day: number; time_known: number;
  location: string | null; source_type: string; source_id: string | null; source_url: string | null; quote: string | null; confidence: string;
  created_by_sync_id: number | null; gcal_event_id: string | null; status: string;
}

function semesterRange(): { start: number; end: number } {
  const r = openDb().prepare('select min(startdate) s, max(enddate) e from courses where active = 1').get() as { s: number | null; e: number | null };
  if (!r.s || !r.e) throw new KaistError('NO_LOCAL_DATA', '이번 학기 과목 정보가 없습니다. `kaist sync`를 먼저 실행해 주세요.');
  return { start: r.s, end: r.e };
}

const lastRunId = () => (openDb().prepare(`select max(id) r from sync_runs where finished_at is not null`).get() as { r: number | null }).r;

function courseOf(q: string): { id: number; code: string; name: string } {
  const rows = openDb().prepare('select id, code, name from courses where active = 1').all() as { id: number; code: string; name: string }[];
  const s = q.trim().toLowerCase();
  const hit = rows.filter(c => String(c.id) === s || c.code.toLowerCase() === s || c.code.toLowerCase().startsWith(s) || c.name.toLowerCase().includes(s));
  if (hit.length !== 1) throw new KaistError('NO_COURSE_MATCH', hit.length ? `"${q}"에 해당하는 과목이 여러 개입니다: ${hit.map(c => c.code).join(', ')}` : `"${q}"에 해당하는 과목이 없습니다.`);
  return hit[0]!;
}

function eventTitle(courseName: string, kind: Kind, label: string | undefined, sourceType: string, timeKnown: boolean, status: string): string {
  const base = kind === 'exam' ? (label || '시험') : KIND_LABEL[kind];
  const tags = [sourceType === 'file' ? '계획서 기준' : '', !timeKnown && (kind === 'exam' || kind === 'makeup') ? '시간 미정' : ''].filter(Boolean);
  return `${status === 'cancelled' ? '[취소] ' : ''}[${courseName}] ${base}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}

function toGEvent(e: SchoolEventRow, courseName: string, label: string | undefined, prev: string[] = []): GEvent {
  const timed = !e.all_day && e.start_at !== null;
  const next = new Date(Date.parse(e.date + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
  const desc = [
    `※ 수집한 글에서 해석한 일정 (${e.confidence === 'auto' ? '자동 등록' : '확인 후 등록'}). 원문과 다르면 KLMS를 따르세요.`,
    e.source_type === 'file' ? '※ 학기 초 강의계획서 기준이라 바뀌었을 수 있습니다.' : '',
    e.quote ? `원문: "${e.quote}"` : '',
    `출처: ${e.source_type === 'manual' ? '직접 입력' : e.source_type}${e.source_url ? ` — ${e.source_url}` : ''}`,
    ...prev,
    `기록: ${formatKst(nowSec())} (KST)`,
  ].filter(Boolean).join('\n');
  return {
    summary: eventTitle(courseName, e.kind, label, e.source_type, !!e.time_known, e.status),
    description: desc,
    ...(e.location ? { location: e.location } : {}),
    start: timed ? { dateTime: new Date(e.start_at! * 1000).toISOString(), timeZone: 'Asia/Seoul' } : { date: e.date },
    end: timed ? { dateTime: new Date((e.end_at ?? e.start_at! + 3600) * 1000).toISOString(), timeZone: 'Asia/Seoul' } : { date: next },
    colorId: e.status === 'cancelled' ? '8' : COLOR[e.kind],
    reminders: e.status === 'cancelled'
      ? { useDefault: false, overrides: [] }
      : { useDefault: false, overrides: (timed ? REMIND[e.kind] : allDayRemind(REMIND[e.kind])).map(m => ({ method: 'popup' as const, minutes: m })) },
    extendedProperties: { private: { kaistEvent: '1', kaistEventKey: `ev:${e.course_id}:${e.kind}:${e.date}`, kaistKind: e.kind } },
  };
}

export interface AddOptions {
  course: string; kind: Kind; date: string; start?: string; end?: string; location?: string; label?: string;
  fromCandidate?: number; quote?: string; manual?: boolean; confirmed?: boolean; dryRun?: boolean;
}

export interface AddResult { verdict: Verdict; event: SchoolEventRow | null; confidence: 'auto' | 'confirmed' | null; dryRun: boolean }

export async function addSchoolEvent(o: AddOptions): Promise<AddResult> {
  const db = openDb();
  const course = courseOf(o.course);
  let context: string | null = null;
  let sourceType = 'manual';
  let sourceId: string | null = null;
  let sourceUrl: string | null = null;
  if (!o.manual) {
    if (!o.fromCandidate) throw new KaistError('BAD_ARGS', '--from-candidate <후보 id> 또는 --manual이 필요합니다.');
    const c = db.prepare('select * from event_candidates where id = ?').get(o.fromCandidate) as Record<string, any> | undefined;
    if (!c) throw new KaistError('NO_CANDIDATE', `후보 ${o.fromCandidate}을(를) 찾지 못했습니다.`);
    // 과목을 모르는 후보(학과 공지 메일 등)는 에이전트가 정한 과목을 쓴다. 메일 출처라 B등급(확인 필요)이다
    if (c.course_id !== null && c.course_id !== course.id) throw new KaistError('BAD_ARGS', `후보 ${o.fromCandidate}은(는) ${course.code} 과목의 글이 아닙니다.`);
    context = c.context; sourceType = c.source_type; sourceId = c.source_id; sourceUrl = c.source_url;
  }
  const existing = db.prepare('select id from school_events where course_id = ? and kind = ? and date = ?').get(course.id, o.kind, o.date) as { id: number } | undefined;
  const verdict = verifyEvent({
    kind: o.kind, date: o.date, start: o.start, end: o.end, quote: o.quote ?? '', context, sourceType: sourceType as never,
    semester: semesterRange(), now: nowSec(), existing: !!existing,
  });
  if (!verdict.ok) throw new KaistError('VERIFY_FAILED', `등록 전 검사 실패: ${verdict.errors.join(' / ')}`, { errors: verdict.errors });
  if (existing) throw new KaistError('EVENT_EXISTS', `같은 과목·종류·날짜 일정이 이미 있습니다 (id ${existing.id}). 바꾸려면 \`kaist events update ${existing.id}\`를 쓰세요.`);
  if (o.dryRun) return { verdict, event: null, confidence: null, dryRun: true };
  if (verdict.grade === 'B' && !o.confirmed) throw new NeedsConfirmationError(verdict);

  const confidence = verdict.grade === 'A' && !o.confirmed ? 'auto' : 'confirmed';
  const startAt = o.start ? parseDashKst(`${o.date} ${o.start.padStart(5, '0')}`) : null;
  const endAt = o.end ? parseDashKst(`${o.date} ${o.end.padStart(5, '0')}`) : null;
  const now = new Date().toISOString();
  const id = Number(db.prepare(`insert into school_events(course_id, kind, title, date, start_at, end_at, all_day, time_known, location, source_type, source_id, source_url, quote,
      confidence, created_by_sync_id, status, created_at, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(course.id, o.kind, o.label ?? KIND_LABEL[o.kind], o.date, startAt, endAt, startAt ? 0 : 1, startAt ? 1 : 0, o.location ?? null, sourceType, sourceId, sourceUrl,
      o.quote ?? null, confidence, lastRunId(), now, now).lastInsertRowid);
  const row = db.prepare('select * from school_events where id = ?').get(id) as unknown as SchoolEventRow;
  try {
    const calId = await ensureCalendar();
    const ev = await gcal.insertEvent(calId, toGEvent(row, course.name, o.label));
    db.prepare('update school_events set gcal_event_id = ? where id = ?').run(ev.id!, id);
    row.gcal_event_id = ev.id!;
  } catch (e) {
    db.prepare('delete from school_events where id = ?').run(id); // 캘린더 반영 실패면 기록도 남기지 않는다
    throw e;
  }
  if (o.fromCandidate) setCandidateStatus(o.fromCandidate, 'linked', null, id);
  return { verdict, event: row, confidence, dryRun: false };
}

export interface UpdateOptions { date?: string; start?: string; end?: string; location?: string; label?: string; cancel?: boolean; fromCandidate?: number; quote?: string; confirmed?: boolean }

/** 변경·취소는 항상 확인 필요(B). 이력을 남기고 일정을 제자리에서 수정한다 */
export async function updateSchoolEvent(id: number, o: UpdateOptions): Promise<SchoolEventRow> {
  const db = openDb();
  const e = db.prepare('select * from school_events where id = ?').get(id) as unknown as SchoolEventRow | undefined;
  if (!e) throw new KaistError('NO_EVENT', `학사 일정 ${id}을(를) 찾지 못했습니다.`);
  if (!o.confirmed) throw new KaistError('NEEDS_CONFIRMATION', '일정 변경·취소는 사용자 확인이 필요합니다. 확인받은 뒤 --confirmed를 붙여 다시 실행하세요.');
  const course = db.prepare('select name from courses where id = ?').get(e.course_id) as { name: string };
  if (o.fromCandidate) {
    const c = db.prepare('select context from event_candidates where id = ?').get(o.fromCandidate) as { context: string } | undefined;
    if (!c) throw new KaistError('NO_CANDIDATE', `후보 ${o.fromCandidate}을(를) 찾지 못했습니다.`);
    if (o.quote && !c.context.replace(/\s+/g, ' ').toLowerCase().includes(o.quote.replace(/\s+/g, ' ').toLowerCase())) throw new KaistError('VERIFY_FAILED', '인용문이 후보 원문에 없습니다.');
  }
  const date = o.date ?? e.date;
  if (!dayInfo(date)) throw new KaistError('BAD_TIME', `날짜 형식이 잘못됐습니다: ${date}`);
  const startAt = o.start ? parseDashKst(`${date} ${o.start.padStart(5, '0')}`) : (o.date && e.start_at !== null ? parseDashKst(`${date} ${formatKst(e.start_at).slice(11)}`) : e.start_at);
  const endAt = o.end ? parseDashKst(`${date} ${o.end.padStart(5, '0')}`) : (o.date && e.end_at !== null ? parseDashKst(`${date} ${formatKst(e.end_at).slice(11)}`) : e.end_at);
  const next: SchoolEventRow = { ...e, date, start_at: startAt, end_at: endAt, all_day: startAt ? 0 : 1, time_known: startAt ? 1 : 0, location: o.location ?? e.location,
    status: o.cancel ? 'cancelled' : e.status, confidence: 'confirmed', quote: o.quote ?? e.quote };
  const fields: [string, unknown, unknown][] = [['date', e.date, next.date], ['start_at', e.start_at, next.start_at], ['end_at', e.end_at, next.end_at], ['location', e.location, next.location], ['status', e.status, next.status]];
  const changed = fields.filter(([, a, b]) => a !== b);
  if (changed.length === 0 && !o.label) throw new KaistError('NO_CHANGE', '바뀐 내용이 없습니다.');
  const prevLines = changed.map(([f, a]) => `이전 ${f === 'start_at' || f === 'end_at' ? (f === 'start_at' ? '시작' : '끝') : f === 'date' ? '날짜' : f === 'location' ? '장소' : '상태'}: ${typeof a === 'number' ? formatKst(a) : a ?? '-'}`);
  tx(() => {
    db.prepare(`update school_events set date=?, start_at=?, end_at=?, all_day=?, time_known=?, location=?, status=?, confidence='confirmed', quote=?, title=coalesce(?, title), updated_at=? where id=?`)
      .run(next.date, next.start_at, next.end_at, next.all_day, next.time_known, next.location, next.status, next.quote, o.label ?? null, new Date().toISOString(), id);
    const h = db.prepare('insert into school_event_history(event_id, changed_at, field, old, new, source_id, by_sync_id) values(?, ?, ?, ?, ?, ?, ?)');
    for (const [f, a, b] of changed) h.run(id, new Date().toISOString(), f, a === null ? null : String(a), b === null ? null : String(b), o.fromCandidate ? String(o.fromCandidate) : null, lastRunId());
  });
  if (e.gcal_event_id) await gcal.patchEvent(await ensureCalendar(), e.gcal_event_id, toGEvent(next, course.name, o.label ?? e.title, prevLines));
  if (o.fromCandidate) setCandidateStatus(o.fromCandidate, 'linked', null, id);
  return db.prepare('select * from school_events where id = ?').get(id) as unknown as SchoolEventRow;
}

export interface EventListItem { id: number; course: string; courseName: string; kind: Kind; title: string; date: string; startKst: string | null; endKst: string | null; allDay: boolean; location: string | null; status: string; confidence: string; sourceType: string; quote: string | null; createdBySyncId: number | null }

export function listSchoolEvents(opts: { from?: string; to?: string; auto?: boolean; syncId?: number; course?: number[]; includeCancelled?: boolean }): EventListItem[] {
  const rows = openDb().prepare(`select e.*, c.code, c.name cname from school_events e join courses c on c.id = e.course_id order by e.date, e.start_at`).all() as Record<string, any>[];
  return rows
    .filter(r => (!opts.from || r.date >= opts.from) && (!opts.to || r.date <= opts.to))
    .filter(r => !opts.auto || r.confidence === 'auto')
    .filter(r => opts.syncId === undefined || r.created_by_sync_id === opts.syncId)
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => opts.includeCancelled || r.status === 'active')
    .map(r => ({ id: r.id, course: r.code, courseName: r.cname, kind: r.kind, title: r.title, date: r.date, startKst: r.start_at ? formatKst(r.start_at) : null, endKst: r.end_at ? formatKst(r.end_at) : null,
      allDay: !!r.all_day, location: r.location, status: r.status, confidence: r.confidence, sourceType: r.source_type, quote: r.quote, createdBySyncId: r.created_by_sync_id }));
}

/** 자동 등록분 되돌리기: 그 sync 회차에 자동(auto)으로 들어간 일정을 지우고 후보를 dismissed로 */
export async function undoAuto(syncId: number | 'last', yes: boolean): Promise<{ syncId: number | null; targets: EventListItem[]; deleted: boolean }> {
  const db = openDb();
  const sid = syncId === 'last'
    ? (db.prepare(`select max(created_by_sync_id) s from school_events where confidence = 'auto' and status = 'active'`).get() as { s: number | null }).s
    : syncId;
  if (sid === null) return { syncId: null, targets: [], deleted: false };
  const targets = listSchoolEvents({ auto: true, syncId: sid });
  if (!yes || targets.length === 0) return { syncId: sid, targets, deleted: false };
  const calId = await ensureCalendar();
  for (const t of targets) {
    const r = db.prepare('select gcal_event_id from school_events where id = ?').get(t.id) as { gcal_event_id: string | null };
    if (r.gcal_event_id) await gcal.deleteEvent(calId, r.gcal_event_id).catch(e => { if (!(e instanceof KaistError && e.code === 'GCAL_NOT_FOUND')) throw e; });
    tx(() => {
      db.prepare(`update event_candidates set status = 'dismissed', status_reason = '자동 등록 되돌림', linked_event_id = null where linked_event_id = ?`).run(t.id);
      db.prepare('insert into school_event_history(event_id, changed_at, field, old, new, source_id, by_sync_id) values(?, ?, ?, ?, ?, ?, ?)').run(t.id, new Date().toISOString(), 'undo', 'active', 'deleted', null, sid);
      db.prepare('delete from school_events where id = ?').run(t.id);
    });
  }
  return { syncId: sid, targets, deleted: true };
}

/** S6 이전에 `cal add`로 직접 넣은 시험 일정(kaistManual + kaistKind=exam)을 school_events로 가져온다 */
export async function importManualExams(): Promise<{ imported: string[]; skipped: string[] }> {
  const db = openDb();
  const calId = await ensureCalendar();
  const evs = await gcal.listEvents(calId, { privateExtendedProperty: 'kaistKind=exam' });
  const courses = db.prepare('select id, code, name from courses where active = 1').all() as { id: number; code: string; name: string }[];
  const out = { imported: [] as string[], skipped: [] as string[] };
  for (const ev of evs) {
    const p = ev.extendedProperties?.private ?? {};
    if (p.kaistEvent === '1' || p.kaistManual !== '1') { out.skipped.push(ev.summary); continue; }
    const m = ev.summary.match(/^\[([^\]]+)\]\s*(중간고사|기말고사|퀴즈[^\s(]*|시험)/);
    const course = m ? courses.find(c => c.name === m[1]) : undefined;
    if (!m || !course) { out.skipped.push(ev.summary); continue; }
    const date = ev.start.date ?? new Date(Date.parse(ev.start.dateTime!) + 9 * 3600e3).toISOString().slice(0, 10);
    if (db.prepare('select 1 from school_events where course_id = ? and kind = ? and date = ?').get(course.id, 'exam', date)) { out.skipped.push(ev.summary); continue; }
    const quote = (ev.description ?? '').match(/원문: "([^"]*)"/)?.[1] ?? null;
    const startAt = ev.start.dateTime ? Math.floor(Date.parse(ev.start.dateTime) / 1000) : null;
    const endAt = ev.end.dateTime ? Math.floor(Date.parse(ev.end.dateTime) / 1000) : null;
    const now = new Date().toISOString();
    db.prepare(`insert into school_events(course_id, kind, title, date, start_at, end_at, all_day, time_known, location, source_type, source_id, source_url, quote,
        confidence, created_by_sync_id, gcal_event_id, status, created_at, updated_at) values(?, 'exam', ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, 'confirmed', null, ?, 'active', ?, ?)`)
      .run(course.id, m[2]!, date, startAt, endAt, startAt ? 0 : 1, startAt ? 1 : 0, ev.location ?? null, ev.summary.includes('계획서') ? 'file' : 'notice', quote, ev.id!, now, now);
    await gcal.patchEvent(calId, ev.id!, { extendedProperties: { private: { ...p, kaistEvent: '1', kaistEventKey: `ev:${course.id}:exam:${date}` } } });
    out.imported.push(ev.summary);
  }
  return out;
}

export const lastSyncRun = lastRunId;
export const getSemesterMeta = () => getMeta('semester');
