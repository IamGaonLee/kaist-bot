// S2 단위 테스트: 날짜 변환(Asia/Seoul 고정), 마감 결정, 불변식. 합성 데이터만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKst, parseDashKst, parseDuration, parseEndDt, parseKoreanDateTime } from '../src/util/time.js';
import { resolveDeadline } from '../src/sync/deadlines.js';
import { checkCoursePage } from '../src/sync/invariants.js';
import { monthsCovering, type CalendarEvent } from '../src/klms/calendar.js';
import { parseListDate } from '../src/klms/adapters/courseboard.js';
import type { ParsedCoursePage, ParsedModule } from '../src/klms/adapters/course-page.js';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

test('KST 대시 형식', () => {
  assert.equal(parseDashKst('2026-09-15 00:00'), utc(2026, 9, 14, 15));
  assert.equal(parseDashKst('2026-10-13 23:59'), utc(2026, 10, 13, 14, 59));
  assert.equal(parseDashKst('2026-09-07'), utc(2026, 9, 6, 15));
  assert.equal(parseDashKst('2026/09/07'), null);
});

test('end-dt 기간', () => {
  assert.deepEqual(parseEndDt('2026-09-07 00:00 ~ 2026-09-15 00:00'), { start: utc(2026, 9, 6, 15), end: utc(2026, 9, 14, 15) });
  assert.deepEqual(parseEndDt(' ~ 2026-09-15 00:00'), { start: null, end: utc(2026, 9, 14, 15) });
  assert.equal(parseEndDt('2026-09-07 ~ 이상한값'), null);
});

test('한국어 날짜: 오전 12:00 = 00:00, 오후 12:00 = 12:00', () => {
  assert.equal(parseKoreanDateTime('2026년 9월 15일(화요일) 오전 12:00'), utc(2026, 9, 14, 15));
  assert.equal(parseKoreanDateTime('2026년 9월 15일(화요일) 오후 12:00'), utc(2026, 9, 15, 3));
  assert.equal(parseKoreanDateTime('2026년 9월 11일(금요일) 오후 6:09'), utc(2026, 9, 11, 9, 9));
  assert.equal(parseKoreanDateTime('2026년 1월 1일 오전 9:05'), utc(2026, 1, 1, 0, 5));
  assert.equal(parseKoreanDateTime('2024년 6월 6일(목요일) 오후 8:11'), utc(2024, 6, 6, 11, 11));
  assert.equal(parseKoreanDateTime('2026년 9월 15일 오전 13:00'), null);
});

test('formatKst, parseDuration', () => {
  assert.equal(formatKst(utc(2026, 9, 14, 15)), '2026-09-15 00:00');
  assert.equal(parseDuration('7d'), 7 * 86400);
  assert.equal(parseDuration('48h'), 48 * 3600);
  assert.throws(() => parseDuration('soon'));
});

test('캘린더 월 범위 (KST 기준)', () => {
  assert.deepEqual(monthsCovering(utc(2026, 8, 30, 15), utc(2026, 12, 20)), [
    { year: 2026, month: 8 }, { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 }, { year: 2026, month: 12 },
  ]);
  // 8월 31일 KST 00시 = 8월 30일 15시 UTC → 8월부터가 아니라 8월 31일이 속한 8월
  assert.equal(monthsCovering(utc(2026, 12, 31, 16), utc(2027, 1, 2))[0]!.year, 2027);
});

const ev = (id: number, timestart: number, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id, name: 'x', courseId: 1, modulename: 'assign', instance: 100, eventtype: 'due', timestart, userid: 9, groupid: 0, url: null, ...extra });
const due = utc(2026, 9, 14, 15);

test('마감: 캘린더 = HTML = 과제 페이지 → 정상', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due, pageDue: due, events: [ev(1, due)], myUserId: 5 });
  assert.deepEqual(d, { due, source: 'calendar', needsReview: false, reason: null, calendarEventId: 1 });
});

test('마감: 캘린더와 HTML이 다르면 needs_review (값은 캘린더)', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due + 3600, pageDue: null, events: [ev(1, due)], myUserId: 5 });
  assert.equal(d.due, due);
  assert.equal(d.needsReview, true);
  assert.match(d.reason!, /과목 페이지/);
});

test('마감: 캘린더에 없으면 HTML로 보충 (source=html)', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due, pageDue: due, events: [], myUserId: 5 });
  assert.deepEqual([d.due, d.source, d.needsReview], [due, 'html', false]);
});

test('마감: 본인 연장 이벤트가 우선', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due, pageDue: null, events: [ev(1, due), ev(2, due + 86400, { userid: 5 })], myUserId: 5 });
  assert.deepEqual([d.due, d.calendarEventId, d.needsReview], [due + 86400, 2, false]);
});

test('마감: 그룹 이벤트, 후보가 둘 이상이면 needs_review', () => {
  const g = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due, pageDue: null, events: [ev(1, due), ev(2, due + 60, { groupid: 3 })], myUserId: 5 });
  assert.equal(g.calendarEventId, 2);
  const many = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: due, pageDue: null, events: [ev(1, due), ev(2, due + 60)], myUserId: 5 });
  assert.deepEqual([many.due, many.needsReview], [null, true]);
});

test('마감: 과제 페이지에만 있으면 그 값을 쓰되 needs_review', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'assign', htmlEnd: null, pageDue: due, events: [], myUserId: 5 });
  assert.deepEqual([d.due, d.source, d.needsReview], [due, 'page', true]);
});

test('게시판 목록 날짜: YYYY-MM-DD 또는 오늘의 HH:MM', () => {
  const now = Date.UTC(2026, 9, 14, 3, 0); // 2026-10-14 12:00 KST
  assert.equal(parseListDate('2026-10-11', now), utc(2026, 10, 10, 15));
  assert.equal(parseListDate('09:05', now), utc(2026, 10, 14, 0, 5));
  assert.equal(parseListDate('어제', now), null);
});

test('마감: 퀴즈는 close 이벤트', () => {
  const d = resolveDeadline({ cmid: 100, modname: 'quiz', htmlEnd: null, pageDue: null, events: [ev(1, due - 3600, { eventtype: 'open', modulename: 'quiz' }), ev(2, due, { eventtype: 'close', modulename: 'quiz' })], myUserId: 5 });
  assert.deepEqual([d.due, d.calendarEventId], [due, 2]);
});

const mod = (cmid: number, modname: string, extra: Partial<ParsedModule> = {}): ParsedModule =>
  ({ cmid, modname, section: 1, name: 'm', url: null, file: modname === 'resource' ? { url: 'u', filename: 'f' } : null, endDtText: null, endDt: null, status: null, boardKind: null, text: null, ...extra });
const page = (modules: ParsedModule[], resourceWithoutLink = 0): ParsedCoursePage =>
  ({ theme: 't', themerev: '1', userId: 1, sections: [{ number: 0, name: 's', dateRange: null, summaryText: '' }], modules, resourceWithoutLink });

test('불변식 1: 게시판 제외하고 비교', () => {
  const p = page([mod(1, 'resource'), mod(2, 'assign'), mod(3, 'courseboard')]);
  assert.equal(checkCoursePage(p, new Set([1, 2])).ok, true);
  const missing = checkCoursePage(p, new Set([1, 2, 4]));
  assert.equal(missing.ok, false);
  assert.match(missing.failures[0]!, /못 찾은 활동 1개/);
});

test('불변식 2: 파일 링크 누락, 게시판 0개', () => {
  assert.match(checkCoursePage(page([mod(1, 'resource'), mod(3, 'courseboard')], 1), new Set([1])).failures.join(), /다운로드 링크/);
  assert.match(checkCoursePage(page([mod(1, 'resource')]), new Set([1])).failures.join(), /게시판 0개/);
});
