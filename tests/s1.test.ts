// S1 단위 테스트. 합성 데이터만 사용 (개인정보 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResponse } from '../src/klms/http.js';
import { interpretAjax, InvalidSesskeyError, AjaxNotAllowedError, AjaxAccessError } from '../src/klms/ajax.js';
import { filterCurrentSemester, type RawCourse } from '../src/klms/courses.js';
import { applySetCookies, cookieHeaderFor, type StoredCookie } from '../src/klms/session-store.js';
import { extractSesskey, hasNotLoggedInClass, isLoginRedirect } from '../src/klms/site.js';
import { SessionExpiredError } from '../src/errors.js';

test('만료 판별: 로그인으로 가는 리다이렉트', () => {
  assert.equal(classifyResponse({ status: 303, location: 'https://klms.kaist.ac.kr/login/index.php', contentType: null }, 'html'), 'expired');
  assert.equal(classifyResponse({ status: 302, location: '/login/ssologin.php', contentType: null }, 'html'), 'expired');
  assert.equal(classifyResponse({ status: 303, location: 'https://klms.kaist.ac.kr/pluginfile.php/1/x.pdf', contentType: null }, 'html'), 'redirect');
  assert.equal(classifyResponse({ status: 200, location: null, contentType: 'text/html; charset=utf-8' }, 'html'), null);
});

test('만료 판별: 파일을 기대했는데 HTML', () => {
  assert.equal(classifyResponse({ status: 200, location: null, contentType: 'text/html' }, 'file'), 'expired');
  assert.equal(classifyResponse({ status: 200, location: null, contentType: 'application/pdf' }, 'file'), null);
});

test('차단 판별', () => {
  for (const status of [400, 403, 429]) assert.equal(classifyResponse({ status, location: null, contentType: null }, 'html'), 'blocked');
});

test('AJAX 오류 코드 분류', () => {
  const err = (code: string) => JSON.stringify([{ error: true, exception: { errorcode: code, message: 'm' } }]);
  assert.throws(() => interpretAjax('f', err('servicerequireslogin')), SessionExpiredError);
  assert.throws(() => interpretAjax('f', err('invalidsesskey')), InvalidSesskeyError);
  assert.throws(() => interpretAjax('f', err('servicenotavailable')), AjaxNotAllowedError);
  assert.throws(() => interpretAjax('f', err('accessexception')), AjaxAccessError);
  assert.deepEqual(interpretAjax('f', JSON.stringify([{ error: false, data: { a: 1 } }])), { a: 1 });
});

test('sesskey와 notloggedin 추출', () => {
  assert.equal(extractSesskey('M.cfg = {"wwwroot":"x","sesskey":"Ab12Cd34Ef","x":1}'), 'Ab12Cd34Ef');
  assert.equal(extractSesskey('<html></html>'), null);
  assert.equal(hasNotLoggedInClass('<body id="page-login-index" class="format-site notloggedin lang-ko">'), true);
  assert.equal(hasNotLoggedInClass('<body id="page-my-index" class="format-site lang-ko">'), false);
  assert.equal(isLoginRedirect('https://sso.kaist.ac.kr/auth/x'), true);
});

const day = 86400;
const now = Date.UTC(2026, 9, 14) / 1000;
const course = (id: number, shortname: string, start: number, end: number, cat = 'Fall'): RawCourse =>
  ({ id, fullname: `과목${id}`, shortname, startdate: start, enddate: end, coursecategory: cat });

test('이번 학기 필터: 접미사와 기간', () => {
  const raw = [
    course(1, 'AA.10000_2026_3', now - 40 * day, now + 60 * day),
    course(2, 'BB.20000(A)_2026_3', now - 40 * day, now + 60 * day),
    course(3, 'CC100_2024_3', now - 800 * day, now - 700 * day),   // 지난 학기
    course(4, 'DD201_(AH)', now - 900 * day, 0, 'Spring'),          // 접미사·종료일 없음
  ];
  const { semester, courses } = filterCurrentSemester(raw, now);
  assert.deepEqual(semester, { year: 2026, term: 3, label: '2026-가을' });
  assert.deepEqual(courses.map(c => c.code), ['AA.10000', 'BB.20000(A)']);
});

test('이번 학기 필터: 0건이면 실패', () => {
  assert.throws(() => filterCurrentSemester([course(3, 'CC100_2024_3', 1, 2)], now), /이번 학기 과목을 찾지 못했습니다/);
});

test('이번 학기 필터: 학기가 겹치면 늦게 시작한 학기', () => {
  const raw = [
    course(1, 'AA_2026_1', now - 200 * day, now + 1 * day, 'Spring'),
    course(2, 'BB_2026_3', now - 40 * day, now + 60 * day),
  ];
  assert.equal(filterCurrentSemester(raw, now).semester.label, '2026-가을');
});

test('쿠키: 헤더 생성과 Set-Cookie 반영', () => {
  const jar: StoredCookie[] = [
    { name: 'MoodleSession', value: 'old', domain: 'klms.kaist.ac.kr', path: '/', expires: -1 },
    { name: 'gone', value: 'x', domain: 'klms.kaist.ac.kr', path: '/', expires: 1 },
  ];
  const url = new URL('https://klms.kaist.ac.kr/my/');
  assert.equal(cookieHeaderFor(jar, url, 1000), 'MoodleSession=old');
  assert.equal(applySetCookies(jar, ['MoodleSession=new; path=/; secure; HttpOnly'], 'klms.kaist.ac.kr'), true);
  assert.equal(jar[0]!.value, 'new');
  assert.equal(applySetCookies(jar, ['MoodleSession=new; path=/'], 'klms.kaist.ac.kr'), false);
  assert.equal(applySetCookies(jar, ['MoodleSession=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/'], 'klms.kaist.ac.kr'), true);
  assert.equal(jar.some(c => c.name === 'MoodleSession'), false);
});
