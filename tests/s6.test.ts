// S6 단위 테스트: 후보 추출, 등록 전 검사·등급 (합성 데이터)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSnippets, isPastFile } from '../src/events/candidates.js';
import { quoteHasDate, quoteHasTime, verifyEvent, type VerifyInput } from '../src/events/verify.js';

test('후보: 키워드와 날짜가 함께 있어야 함', () => {
  const s = findSnippets('공지입니다. Midterm Exam (10/22, THU, 13:00 ~ 15:45, YBS 207) 범위는 1~13강.', 2026);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.kindHint, 'exam');
  assert.equal(s[0]!.past, false);
  assert.equal(findSnippets('This problem is about the midterm score distribution.', 2026).length, 0);
});

test('후보: 종류 힌트 (휴강·보강·온라인)', () => {
  assert.equal(findSnippets('다음 주 화요일(10/27)은 휴강입니다.', 2026)[0]!.kindHint, 'no_class');
  assert.equal(findSnippets('보강은 11월 21일(토) 10:00에 진행합니다.', 2026)[0]!.kindHint, 'makeup');
  assert.equal(findSnippets('Oct 14 class will be held online via Zoom.', 2026)[0]!.kindHint, 'online');
});

test('후보: 다른 연도만 적힌 구간과 기출 파일은 past', () => {
  assert.equal(findSnippets('2025 Fall Midterm Exam Date: 2025 Oct. 23', 2026)[0]!.past, true);
  assert.equal(findSnippets('2026 Midterm Exam Date: Oct. 22', 2026)[0]!.past, false);
  assert.equal(isPastFile('2025_BiS252_Midterm_Exam_v2.pdf', 2026), true);
  assert.equal(isPastFile('HW3_solution.pdf', 2026), true);
  assert.equal(isPastFile('BiS25002_Syllabus2026Fall_v3.pdf', 2026), false);
});

test('인용문 날짜·시각 인식', () => {
  assert.ok(quoteHasDate('Midterm Exam (10/22, THU, 13:00 ~ 15:45)', '2026-10-22'));
  assert.ok(quoteHasDate('Thursday, October 22, 2026', '2026-10-22'));
  assert.ok(quoteHasDate('10월 22일(목) 오후 1시', '2026-10-22'));
  assert.ok(!quoteHasDate('다음 주 목요일', '2026-10-22'));
  assert.ok(!quoteHasDate('10/2 quiz', '2026-10-22'));
  assert.ok(quoteHasTime('Time: 9:00–11:45 AM', '09:00'));
  assert.ok(quoteHasTime('13:00 ~ 15:45', '13:00'));
  assert.ok(quoteHasTime('오후 1시', '13:00'));
  assert.ok(quoteHasTime('1:00 PM', '13:00'));
  assert.ok(!quoteHasTime('9:00 AM', '13:00'));
});

const sem = { start: Date.UTC(2026, 7, 30, 15) / 1000, end: Date.UTC(2026, 11, 20, 15) / 1000 };
const now = Date.UTC(2026, 9, 14, 3) / 1000;
const ctx = '공지: Midterm Exam (10/22, THU, 13:00 ~ 15:45, YBS 207) Coverage: Lecture 1 ~ 13';
const base: VerifyInput = { kind: 'exam', date: '2026-10-22', start: '13:00', end: '15:45', quote: 'Midterm Exam (10/22, THU, 13:00 ~ 15:45, YBS 207)', context: ctx, sourceType: 'notice', semester: sem, now, existing: false };

test('검사: 공지 + 절대 날짜·시각 → A등급', () => {
  const v = verifyEvent(base);
  assert.deepEqual([v.ok, v.grade, v.needsConfirmReasons], [true, 'A', []]);
});

test('검사: 인용문이 원문에 없으면 실패 (지어낸 값 차단)', () => {
  const v = verifyEvent({ ...base, quote: 'Midterm Exam (10/23, FRI)' });
  assert.equal(v.ok, false);
  assert.match(v.errors.join(), /원문에 없습니다/);
});

test('검사: 요일 불일치, 학기 밖, 너무 지난 날짜는 실패', () => {
  assert.match(verifyEvent({ ...base, date: '2026-10-23' }).errors.join(), /요일/);
  assert.match(verifyEvent({ ...base, date: '2027-03-02', quote: 'Midterm', context: 'Midterm' }).errors.join(), /학기 범위/);
  assert.match(verifyEvent({ ...base, date: '2026-09-01', quote: 'Midterm', context: 'Midterm' }).errors.join(), /지난 날짜/);
});

test('검사: B등급 사유 (계획서, 시각 미상, 상대 표현, 이미 있음, 보강)', () => {
  assert.ok(verifyEvent({ ...base, sourceType: 'file' }).needsConfirmReasons.some(r => r.includes('강의계획서')));
  assert.ok(verifyEvent({ ...base, start: undefined, end: undefined }).needsConfirmReasons.includes('시험 시각 미상'));
  const rel = verifyEvent({ ...base, quote: 'Midterm Exam', context: 'Midterm Exam next Thursday', start: undefined, end: undefined });
  assert.equal(rel.grade, 'B');
  assert.ok(verifyEvent({ ...base, existing: true }).needsConfirmReasons.some(r => r.includes('이미 있음')));
  assert.ok(verifyEvent({ ...base, kind: 'makeup' }).needsConfirmReasons.some(r => r.includes('보강')));
});

test('후보: 파일에서는 점 날짜·단어 일부 일치를 인정하지 않음', () => {
  assert.equal(findSnippets('Final remarks in section 6.6 and 7.4', 2026, { file: true }).length, 0);
  assert.equal(findSnippets('Final exam 12/14 9:00-11:45', 2026, { file: true }).length, 1);
  assert.equal(findSnippets('nonlinear relation 7/3 Zooming in', 2026, { file: true }).length, 0);
  assert.equal(findSnippets('Exam- ple 13.1 on 10/22', 2026, { file: true }).length, 0);
});

test('일정 파일 이름 규칙', async () => {
  const { SCHEDULE_FILE } = await import('../src/events/candidates.js');
  for (const n of ['Syllabus2026Fall.pdf', 'Syll-2026-MAE341.doc', 'ME30040_Syllabus_260909.pdf', 'Week01_1_Introduction.pdf', '2026-ME30061-HO-01-Introduction.pdf']) assert.ok(SCHEDULE_FILE.test(n), n);
  for (const n of ['Lecture4_Node_Mesh_Method.pdf', 'HW5.pdf', 'matlab-introduction.pdf'.replace('introduction', 'manual')]) assert.ok(!SCHEDULE_FILE.test(n), n);
});

test('메일 과목 매핑: 코드·이름·별칭, 여러 과목이면 제목 기준', async () => {
  const { matchCourse } = await import('../src/mail/sync.js');
  const courses = [
    { id: 1, code: 'ME.30061', name: '시스템 모델링 및 제어', aliases: ['ME361'] },
    { id: 2, code: 'MAS.20050(B)', name: '확률및통계', aliases: [] },
  ];
  assert.equal(matchCourse('[ME30061] Midterm notice', '', courses)?.id, 1);
  assert.equal(matchCourse('ME361 HW5', '', courses)?.id, 1);
  assert.equal(matchCourse('공지', '확률및통계 중간고사 안내', courses)?.id, 2);
  assert.equal(matchCourse('학과 공지', 'ME.30061과 MAS.20050 모두', courses), null);
  assert.equal(matchCourse('MAS.20050 시험', 'ME.30061 참고', courses)?.id, 2);
  assert.equal(matchCourse('ME3006 seminar', '', courses), null);
});

test('메일 인용 잘라내기', async () => {
  const { stripQuoted } = await import('../src/events/candidates.js');
  assert.equal(stripQuoted('퀴즈는 10/20입니다.\n\n-----Original Message-----From: x\n시험 10/19'), '퀴즈는 10/20입니다.\n\n');
  assert.equal(stripQuoted('본문\n> 인용\n'), '본문\n');
  assert.equal(stripQuoted('인용 없음'), '인용 없음');
});
