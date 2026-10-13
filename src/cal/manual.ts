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

export interface EventView { id: string; summary: string; startKst: string; endKst: string; kind: 'deadline' | 'manual'; cmid: string | null; link: string | null; description: string }

const toKst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const view = (e: GEvent): EventView => ({
  id: e.id!, summary: e.summary, startKst: toKst(e.start.dateTime), endKst: toKst(e.end.dateTime),
  kind: e.extendedProperties?.private?.kaistCmid ? 'deadline' : 'manual', cmid: e.extendedProperties?.private?.kaistCmid ?? null,
  link: e.htmlLink ?? null, description: e.description ?? '',
});

export async function listEvents(fromSec: number, toSec: number): Promise<EventView[]> {
  const evs = await gcal.listEvents(calendarId(), { timeMin: new Date(fromSec * 1000).toISOString(), timeMax: new Date(toSec * 1000).toISOString(), orderBy: 'startTime' });
  return evs.filter(e => e.start?.dateTime).map(view);
}

export async function addEvent(o: { title: string; start: number; end: number; description?: string }): Promise<EventView> {
  if (o.end <= o.start) throw new KaistError('BAD_TIME', '끝 시각이 시작 시각보다 뒤여야 합니다.');
  const ev = await gcal.insertEvent(calendarId(), {
    summary: o.title, description: o.description ?? '',
    start: { dateTime: new Date(o.start * 1000).toISOString(), timeZone: 'Asia/Seoul' },
    end: { dateTime: new Date(o.end * 1000).toISOString(), timeZone: 'Asia/Seoul' },
    extendedProperties: { private: { kaistManual: '1' } },
  });
  return view(ev);
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
