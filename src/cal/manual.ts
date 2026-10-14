// kaist cal list/add/update/delete: KLMS 전용 캘린더의 일정 조회·직접 편집
// (권한 범위상 이 앱이 만든 캘린더만 다룰 수 있다)
import { KaistError } from '../errors.js';
import { gcal, type GEvent } from '../google/calendar-api.js';
import { hasGoogleToken } from '../google/oauth.js';
import { getMeta } from '../store/db.js';
import { parseDashKst } from '../util/time.js';

function calendarId(): string {
  if (!hasGoogleToken()) throw new KaistError('GOOGLE_NO_TOKEN', '구글 캘린더가 연결되지 않았습니다. `kaist cal login`을 먼저 실행해 주세요.');
  const id = getMeta('gcal_calendar_id');
  if (!id) throw new KaistError('GCAL_NO_CALENDAR', 'KLMS 캘린더가 아직 없습니다. `kaist cal login`을 다시 실행해 주세요.');
  return id;
}

export function parseKstOrThrow(text: string, what: string): number {
  const t = parseDashKst(text);
  if (t === null) throw new KaistError('BAD_TIME', `${what} 형식은 "YYYY-MM-DD HH:MM" (KST)이어야 합니다: "${text}"`);
  return t;
}

export interface EventView { id: string; summary: string; startKst: string; endKst: string; kind: 'deadline' | 'school' | 'manual'; cmid: string | null; link: string | null; description: string }

const toKst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
/** 종일 일정은 "YYYY-MM-DD 종일" */
const when = (t: { dateTime?: string; date?: string }) => (t.dateTime ? toKst(t.dateTime) : `${t.date} 종일`);
const view = (e: GEvent): EventView => ({
  id: e.id!, summary: e.summary, startKst: when(e.start), endKst: when(e.end),
  kind: e.extendedProperties?.private?.kaistCmid ? 'deadline' : e.extendedProperties?.private?.kaistEvent ? 'school' : 'manual', cmid: e.extendedProperties?.private?.kaistCmid ?? null,
  link: e.htmlLink ?? null, description: e.description ?? '',
});

export async function listEvents(fromSec: number, toSec: number): Promise<EventView[]> {
  const evs = await gcal.listEvents(calendarId(), { timeMin: new Date(fromSec * 1000).toISOString(), timeMax: new Date(toSec * 1000).toISOString(), orderBy: 'startTime' });
  return evs.filter(e => e.start?.dateTime || e.start?.date).map(view);
}

export interface AddOptions {
  title: string;
  /** 시각 일정: 유닉스 초 / 종일 일정: allDay에 "YYYY-MM-DD" */
  start?: number;
  end?: number;
  allDay?: string;
  description?: string;
  location?: string;
  /** 알림 (분, 일정 시작 기준). 생략하면 캘린더 기본값 */
  remindMinutes?: number[];
  colorId?: string;
  kind?: string;
}

export async function addEvent(o: AddOptions): Promise<EventView> {
  let start: GEvent['start'];
  let end: GEvent['end'];
  if (o.allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.allDay)) throw new KaistError('BAD_TIME', `종일 일정 날짜는 YYYY-MM-DD여야 합니다: "${o.allDay}"`);
    const next = new Date(Date.parse(o.allDay + 'T00:00:00Z') + 86400e3).toISOString().slice(0, 10);
    start = { date: o.allDay };
    end = { date: next };
  } else {
    if (o.start === undefined || o.end === undefined || o.end <= o.start) throw new KaistError('BAD_TIME', '끝 시각이 시작 시각보다 뒤여야 합니다.');
    start = { dateTime: new Date(o.start * 1000).toISOString(), timeZone: 'Asia/Seoul' };
    end = { dateTime: new Date(o.end * 1000).toISOString(), timeZone: 'Asia/Seoul' };
  }
  const ev = await gcal.insertEvent(calendarId(), {
    summary: o.title, description: o.description ?? '', start, end,
    ...(o.location ? { location: o.location } : {}),
    ...(o.colorId ? { colorId: o.colorId } : {}),
    ...(o.remindMinutes ? { reminders: { useDefault: false, overrides: o.remindMinutes.map(m => ({ method: 'popup' as const, minutes: m })) } } : {}),
    extendedProperties: { private: { kaistManual: '1', ...(o.kind ? { kaistKind: o.kind } : {}) } },
  });
  return view(ev);
}

/** "7d,1d,2h,30m" → 분 목록 */
export function parseReminders(text: string): number[] {
  return text.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(\d+)\s*([dhm])$/i);
    if (!m) throw new KaistError('BAD_REMINDER', `알림 형식이 잘못됐습니다: "${s}" (예: 7d,1d,2h)`);
    return +m[1]! * ({ d: 1440, h: 60, m: 1 } as const)[m[2]!.toLowerCase() as 'd' | 'h' | 'm'];
  });
}

export async function getEvent(id: string): Promise<EventView> {
  return view(await gcal.getEvent(calendarId(), id));
}

export async function updateEvent(id: string, o: { title?: string; start?: number; end?: number; description?: string }): Promise<EventView> {
  const cur = await gcal.getEvent(calendarId(), id);
  if (cur.extendedProperties?.private?.kaistCmid && (o.start !== undefined || o.end !== undefined)) {
    throw new KaistError('GCAL_DEADLINE_EVENT', '자동 등록된 마감 일정의 시각은 바꾸지 않습니다 (다음 sync가 KLMS 값으로 되돌림). 별도 작업 일정은 `kaist cal add`로 만드세요.');
  }
  const patch: Partial<GEvent> = {};
  if (o.title !== undefined) patch.summary = o.title;
  if (o.description !== undefined) patch.description = o.description;
  if (o.start !== undefined) patch.start = { dateTime: new Date(o.start * 1000).toISOString(), timeZone: 'Asia/Seoul' };
  if (o.end !== undefined) patch.end = { dateTime: new Date(o.end * 1000).toISOString(), timeZone: 'Asia/Seoul' };
  return view(await gcal.patchEvent(calendarId(), id, patch));
}

export async function deleteEvent(id: string): Promise<void> {
  await gcal.deleteEvent(calendarId(), id);
}
