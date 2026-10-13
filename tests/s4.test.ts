// S4 단위 테스트: 마감 → 캘린더 일정 변환 (합성 데이터)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventFor } from '../src/cal/push.js';

const due = Date.UTC(2026, 9, 15, 4, 0) / 1000; // 2026-10-15 13:00 KST
const base = { cmid: 1, modname: 'assign', name: 'Homework 5', due, needs_review: 0, review_reason: null, submission_code: 'noattempt',
  course_name: '시스템 모델링 및 제어', code: 'ME.30061', url: 'https://klms.kaist.ac.kr/mod/assign/view.php?id=1', removed_at: null, due_source: 'calendar' };
const last = '2026-10-14T03:00:00.000Z';

test('제목, 30분 일정, 마감에 끝남', () => {
  const e = eventFor(base, last);
  assert.equal(e.summary, '[시스템 모델링 및 제어] Homework 5');
  assert.equal(e.end.dateTime, new Date(due * 1000).toISOString());
  assert.equal(Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime), 30 * 60 * 1000);
  assert.equal(e.extendedProperties?.private?.kaistCmid, '1');
});

test('알림은 마감 1일·3일 전 (일정 시작 기준으로 30분 보정)', () => {
  const mins = eventFor(base, last).reminders!.overrides!.map(o => o.minutes);
  assert.deepEqual(mins, [24 * 60 - 30, 72 * 60 - 30]);
});

test('제출함 → ✓, 알림 없음 / 퀴즈 / 확인 필요 / 사라짐', () => {
  const s = eventFor({ ...base, submission_code: 'submitted' }, last);
  assert.ok(s.summary.startsWith('✓ '));
  assert.deepEqual(s.reminders!.overrides, []);
  assert.equal(eventFor({ ...base, modname: 'quiz', name: 'Q1' }, last).summary, '[시스템 모델링 및 제어] 퀴즈: Q1');
  assert.ok(eventFor({ ...base, needs_review: 1, review_reason: 'x' }, last).summary.startsWith('⚠ '));
  assert.ok(eventFor({ ...base, removed_at: 'y' }, last).summary.startsWith('[KLMS에서 사라짐] '));
});

test('설명: 마감 KST, KLMS 링크, 마지막 수집 시각', () => {
  const d = eventFor(base, last).description!;
  assert.match(d, /마감: 2026-10-15 13:00 \(KST\)/);
  assert.match(d, /KLMS: https:\/\/klms/);
  assert.match(d, /마지막 수집: 2026-10-14 12:00/);
});
