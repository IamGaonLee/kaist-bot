// 마감 결정 (보고서 3.2). 값은 캘린더 유닉스 초만, HTML은 검증에만. 순수 함수.
import type { CalendarEvent } from '../klms/calendar.js';

/** 활동 유형별 마감 이벤트 종류 */
export const DUE_EVENT_TYPES: Record<string, string[]> = {
  assign: ['due'],
  quiz: ['close'],
};

export interface DeadlineInput {
  cmid: number;
  modname: string;
  /** 과목 페이지 strong.end-dt의 끝 시각 */
  htmlEnd: number | null;
  /** 과제 페이지 "마감 일시" */
  pageDue: number | null;
  /** 이 cmid의 캘린더 이벤트 (instance === cmid) */
  events: CalendarEvent[];
  myUserId: number | null;
}

export interface Deadline {
  due: number | null;
  source: 'calendar' | 'html' | 'none';
  needsReview: boolean;
  reason: string | null;
  calendarEventId: number | null;
}

const MINUTE = 60;

export function resolveDeadline(input: DeadlineInput): Deadline {
  const types = DUE_EVENT_TYPES[input.modname] ?? [];
  const evs = input.events.filter(e => types.includes(e.eventtype));

  // 같은 cmid에 여럿이면: 본인 → 그룹 → 과목 전체. 그래도 둘 이상이면 needs_review
  let picked: CalendarEvent | null = null;
  let isOverride = false;
  if (evs.length === 1) picked = evs[0]!;
  else if (evs.length > 1) {
    const mine = input.myUserId === null ? [] : evs.filter(e => e.userid === input.myUserId && !e.groupid);
    const group = evs.filter(e => (e.groupid ?? 0) > 0);
    const tier = mine.length ? mine : group.length ? group : evs;
    if (tier.length !== 1) {
      return { due: null, source: 'none', needsReview: true, reason: `마감 이벤트가 ${tier.length}개라 하나로 정할 수 없음`, calendarEventId: null };
    }
    picked = tier[0]!;
    isOverride = tier !== evs;
  }

  if (!picked) {
    // 캘린더에 없으면 HTML end-dt로 보충 (source=html). 페이지 마감과 다르면 검토
    if (input.htmlEnd !== null) {
      const off = input.pageDue !== null && Math.abs(input.pageDue - input.htmlEnd) >= MINUTE;
      return { due: input.htmlEnd, source: 'html', needsReview: off, reason: off ? '과목 페이지 기간과 과제 페이지 마감이 다름' : null, calendarEventId: null };
    }
    return { due: null, source: 'none', needsReview: false, reason: null, calendarEventId: null };
  }

  const due = picked.timestart;
  const mismatches: string[] = [];
  // 개인/그룹 연장 이벤트를 골랐다면 과목 페이지 기간(공통 마감)과 다른 게 정상일 수 있어 비교하지 않는다
  if (input.htmlEnd !== null && !isOverride && Math.abs(due - input.htmlEnd) >= MINUTE) mismatches.push('과목 페이지 기간');
  if (input.pageDue !== null && Math.abs(due - input.pageDue) >= MINUTE) mismatches.push('과제 페이지 마감');
  return {
    due,
    source: 'calendar',
    needsReview: mismatches.length > 0,
    reason: mismatches.length ? `캘린더 마감과 ${mismatches.join(', ')}이 다름` : null,
    calendarEventId: picked.id,
  };
}
