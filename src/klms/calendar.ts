// 마감 이벤트: AJAX core_calendar_get_calendar_monthly_view (사이트 전체, 월별)
import { ParseError } from '../errors.js';
import type { KlmsSession } from './session.js';

export interface CalendarEvent {
  id: number;
  name: string;
  courseId: number | null;
  modulename: string | null;
  /** KLMS에서는 과제 ID가 아니라 cmid다 (0단계 V7) */
  instance: number | null;
  eventtype: string;
  timestart: number;
  userid: number | null;
  groupid: number | null;
  url: string | null;
}

interface RawEvent {
  id: number; name: string; modulename?: string; instance?: number; eventtype: string; timestart: number;
  userid?: number; groupid?: number; url?: string; course?: { id?: number };
}

/** fromSec~toSec를 덮는 (연, 월) 목록 (KST 기준) */
export function monthsCovering(fromSec: number, toSec: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  const toKst = (s: number) => new Date((s + 9 * 3600) * 1000);
  const a = toKst(fromSec);
  const b = toKst(toSec);
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth() + 1;
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth() + 1)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function fetchCalendarEvents(session: KlmsSession, fromSec: number, toSec: number): Promise<CalendarEvent[]> {
  const byId = new Map<number, CalendarEvent>();
  for (const { year, month } of monthsCovering(fromSec, toSec)) {
    const data = await session.ajax<{ weeks?: { days?: { events?: RawEvent[] }[] }[] }>('core_calendar_get_calendar_monthly_view', {
      year, month, courseid: 1, categoryid: 0, includenavigation: false, mini: false,
    });
    if (!Array.isArray(data?.weeks)) throw new ParseError(`캘린더 ${year}-${month}`, '`weeks` 배열이 없습니다');
    for (const w of data.weeks) for (const d of w.days ?? []) for (const e of d.events ?? []) {
      if (typeof e.id !== 'number' || typeof e.timestart !== 'number') throw new ParseError(`캘린더 ${year}-${month}`, '이벤트에 id/timestart가 없습니다');
      byId.set(e.id, {
        id: e.id,
        name: e.name,
        courseId: e.course?.id ?? null,
        modulename: e.modulename ?? null,
        instance: e.instance ?? null,
        eventtype: e.eventtype,
        timestart: e.timestart,
        userid: e.userid ?? null,
        groupid: e.groupid ?? null,
        url: e.url ?? null,
      });
    }
  }
  return [...byId.values()];
}
