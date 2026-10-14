// S8a 단위 테스트: 세션 파일 v2, 허용 목록, 금지 경로, 사이트별 만료 판별. 합성 데이터만 사용 (개인정보 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Cookie } from 'playwright';
import { SessionStore, parseSessionFile, type SessionFile } from '../src/klms/session-store.js';
import { assertAllowed, type SiteResponse } from '../src/sites/http.js';
import { MUTATING_VERB, SITE_DEFS, type PortalSite } from '../src/sites/sites.js';
import { classifyProbe, splitCookies } from '../src/sites/session.js';

const sess = (v: string): SessionFile => ({ savedAt: 't', lastUsedAt: 't', cookies: [{ name: 'A', value: v, domain: 'x', path: '/', expires: -1 }] });
const res = (status: number, contentType: string, text = '', location: string | null = null): SiteResponse => ({ status, contentType, text, location });

test('세션 파일: v1(KLMS만)은 klms로 옮겨 읽는다', () => {
  const v1 = JSON.stringify(sess('k1'));
  assert.deepEqual(parseSessionFile(v1).sites.klms?.cookies[0]?.value, 'k1');
  assert.deepEqual(parseSessionFile('﻿' + v1).sites.klms?.cookies[0]?.value, 'k1');
  assert.deepEqual(parseSessionFile('{broken').sites, {});
  assert.deepEqual(parseSessionFile(JSON.stringify({ version: 2, sites: { portal: sess('p'), erp: { nope: 1 } } })).sites, { portal: sess('p') });
});

test('세션 파일: 사이트별 저장이 서로 덮어쓰지 않는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaist-s8-'));
  const file = path.join(dir, 'session.json');
  fs.writeFileSync(file, JSON.stringify(sess('old-klms'))); // v1 파일
  const store = new SessionStore(file);
  assert.equal(store.load()?.cookies[0]?.value, 'old-klms');
  store.forSite('portal').save(sess('p'));
  store.forSite('kds').save(sess('d'));
  store.save(sess('new-klms'));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.version, 2);
  assert.deepEqual(Object.keys(data.sites).sort(), ['kds', 'klms', 'portal']);
  store.forSite('kds').clear();
  assert.equal(store.forSite('kds').load(), null);
  assert.equal(store.forSite('portal').load()?.cookies[0]?.value, 'p');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('허용 목록: 조회 경로만 있고 상태를 바꾸는 동사가 없다', () => {
  for (const [site, def] of Object.entries(SITE_DEFS)) {
    for (const [name, e] of Object.entries(def.endpoints)) {
      const p = typeof e.path === 'string' ? e.path : e.path.source;
      assert.ok(!MUTATING_VERB.test(p), `${site}.${name}: ${p}`);
      assert.ok(e.purpose.length > 0);
    }
  }
});

test('허용 목록: 목록 밖·다른 호스트·http·금지 경로는 거부', () => {
  const ok = (site: PortalSite, m: string, u: string) => assertAllowed(site, m, new URL(u));
  const no = (site: PortalSite, m: string, u: string) => assert.throws(() => ok(site, m, u), /NOT_ALLOWED|허용|호출하지/);
  assert.equal(ok('portal', 'POST', 'https://portal.kaist.ac.kr/wz/api/widget/schedule/stulist'), 'timetable');
  assert.equal(ok('portal', 'GET', 'https://portal.kaist.ac.kr/wz/api/board/recents/17919611193950?boardNo=31'), 'post');
  assert.equal(ok('erp', 'POST', 'https://erp.kaist.ac.kr/com/cnst/PropCtr/findViewSession.do'), 'viewSession');
  no('portal', 'GET', 'https://portal.kaist.ac.kr/wz/api/widget/schedule/stulist'); // 메서드 다름
  no('portal', 'GET', 'https://portal.kaist.ac.kr/wz/api/board/recents/abc');
  no('portal', 'GET', 'http://portal.kaist.ac.kr/wz/api/board/recents');
  no('erp', 'POST', 'https://portal.kaist.ac.kr/com/cnst/PropCtr/findViewSession.do');
  no('erp', 'POST', 'https://erp.kaist.ac.kr/com/cmsv/ReportCtr/saveReport.do');
  for (const p of ['/myDorm/dropOutAply.do', '/myDorm/cancelDropOut.do', '/myDorm/asignCancl.do', '/myDorm/modifyAplyReason.do', '/myDorm/selectDormAplyInfo.do']) {
    no('kds', 'POST', 'https://kds.kaist.ac.kr' + p);
  }
});

test('만료 판별: 포털은 401·HTML이면 만료, JSON이면 정상', () => {
  assert.equal(classifyProbe('portal', res(200, 'application/json;charset=utf-8', '{"data":[]}')), 'ok');
  assert.equal(classifyProbe('portal', res(401, 'text/html')), 'expired');
  assert.equal(classifyProbe('portal', res(200, 'text/html')), 'expired');
  assert.equal(classifyProbe('portal', res(302, 'text/html', '', 'https://portal.kaist.ac.kr/common/login/login.do')), 'expired');
  assert.equal(classifyProbe('portal', res(502, 'text/html')), 'error');
});

test('만료 판별: ERP는 isLogin 값으로 (success=true는 믿지 않음)', () => {
  assert.equal(classifyProbe('erp', res(200, 'application/json', '{"dmLoginConfirm":{"isLogin":"1"}}')), 'ok');
  assert.equal(classifyProbe('erp', res(200, 'application/json', '{"dmLoginConfirm":{"isLogin":"0"}}')), 'expired');
  assert.equal(classifyProbe('erp', res(200, 'application/json', '{"_METADATA_":{"success":true}}')), 'error');
  assert.equal(classifyProbe('erp', res(200, 'text/html', '<!doctype html>')), 'expired');
});

test('만료 판별: kds는 배정 정보 500이면 만료', () => {
  assert.equal(classifyProbe('kds', res(200, 'text/html', '<ul class="info-ulbox">')), 'ok');
  assert.equal(classifyProbe('kds', res(500, 'text/html')), 'expired');
  assert.equal(classifyProbe('kds', res(302, 'text/html', '', '/login/ssoLogin.do')), 'expired');
  assert.equal(classifyProbe('kds', res(404, 'text/html')), 'error');
});

test('쿠키 분리: 사이트 자기 호스트만, SSO·상위 도메인 제외', () => {
  const c = (domain: string, name: string): Cookie => ({ name, value: 'v', domain, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' });
  const split = splitCookies([
    c('sso.kaist.ac.kr', 'authTk'), c('.kaist.ac.kr', 'parent'),
    c('portal.kaist.ac.kr', 'JSESSIONID'), c('klms.kaist.ac.kr', 'MoodleSession'),
    c('erp.kaist.ac.kr', 'JSESSIONID'), c('.erp.kaist.ac.kr', 'locale'), c('kds.kaist.ac.kr', 'JSESSIONID'),
  ], 't');
  assert.deepEqual(Object.keys(split).sort(), ['erp', 'kds', 'klms', 'portal']);
  assert.deepEqual(split.erp?.cookies.map(x => `${x.domain}:${x.name}`), ['erp.kaist.ac.kr:JSESSIONID', 'erp.kaist.ac.kr:locale']);
  const all = Object.values(split).flatMap(s => s!.cookies.map(x => x.name));
  assert.ok(!all.includes('authTk') && !all.includes('parent'));
});

// ---------- S8b ----------
import { isMajorPlan, parseCollegePlan, parseDormInfo, parseStulist, quietWindows, type PlanItem } from '../src/sites/parse.js';
import { campusGEvent, dormTargets, planTargets } from '../src/sites/campus.js';
import { verifyEvent } from '../src/events/verify.js';

const slot = (subjtCd: string, dw: number, s: string, e: string, sec: string | null = null) =>
  ({ subjtCd, corseDvclsNo: sec, daywDivCd: String(dw), lessnNm: s, lessnNmEnd: e, subjtNm: '과목', buldNm: '건물', lecrmNm: '(101호)강의실' });

test('시간표: 30분 칸을 합치고 요일을 월=1로 바꾼다', () => {
  const s = parseStulist({ data: [slot('AB.100', 2, '09:00', '09:30', 'A'), slot('AB.100', 2, '09:30', '10:00', 'A'), slot('AB.100', 2, '10:00', '10:30', 'A'),
    slot('CD.200', 1, '13:00', '13:30'), slot('CD.200', 1, '15:00', '15:30')] });
  assert.deepEqual(s.map(x => `${x.courseCode} ${x.weekday} ${x.start}-${x.end} ${x.room}`), ['AB.100(A) 1 09:00-10:30 101호', 'CD.200 7 13:00-13:30 101호', 'CD.200 7 15:00-15:30 101호']);
  assert.throws(() => parseStulist({}), /PARSE_ERROR|data/);
  assert.throws(() => parseStulist({ data: [slot('X', 2, '9시', '10:00')] }), /시각/);
});

const plan = (title: string, cldrNo = '38', s = '20261019', e = '20261023') => ({ schdlNo: 'D' + title.length, schdlTtl: title, bgngDt: s, endDt: e, cldrNo });

test('학사일정: 날짜 YYYYMMDD → YYYY-MM-DD, 주요 일정 선별', () => {
  const items = parseCollegePlan({ data: [plan('가을학기 중간고사')] });
  assert.deepEqual(items[0], { schdlNo: 'D9', title: '가을학기 중간고사', startDate: '2026-10-19', endDate: '2026-10-23', cldrNo: '38' });
  const major = (t: string, c = '38') => isMajorPlan({ schdlNo: 'x', title: t, startDate: '2026-10-19', endDate: '2026-10-19', cldrNo: c });
  for (const t of ['가을학기 중간고사', '가을학기 학기말 시험', '가을학기 개강', '가을학기 종강', '겨울학기 수강신청', '가을학기 수강신청 변경 마감',
    '2026학년도 가을학기 학·석·박사과정 재학생 등록 (납입금 납부)', '가을학기 성적입력 마감', '학사과정 2006 이전 학번 및 학·석·박사과정 2009 이후 학번 가을학기 수강신청 취소']) assert.ok(major(t), t);
  for (const t of ['가을학기 강의평가', '여름학기 종강', '학사과정 2007, 2008 학번 및 석·박사과정 2008 이전 학번 가을학기 수강신청 취소', '학사과정 가을학기 학점인정시험',
    '박사학위 청구 심사용 논문 제출 마감', '가을학기 학사·대학원 외국인 신입생 오리엔테이션', 'KAIST 학생문화제']) assert.ok(!major(t), t);
  assert.ok(!major('가을학기 중간고사', '39'), '대학원 사본 달력은 쓰지 않음');
  assert.ok(!major('가을학기 중간고사', '57'));
  assert.throws(() => parseCollegePlan({ data: [plan('x', '38', '2026-10-19')] }), /필드/);
});

test('수강신청 조용한 기간: 신청·변경만 (취소 기간은 제외)', () => {
  const p = (title: string, s: string, e: string): PlanItem => ({ schdlNo: title, title, startDate: s, endDate: e, cldrNo: '38' });
  const w = quietWindows([p('가을학기 수강신청 변경', '2026-08-24', '2026-09-07'), p('겨울학기 수강신청', '2026-11-23', '2026-11-26'),
    p('학사과정 2006 이전 학번 및 학·석·박사과정 2009 이후 학번 가을학기 수강신청 취소', '2026-09-08', '2026-10-16'), p('여름학기 수강신청', '2026-06-01', '2026-06-03'), p('가을학기 중간고사', '2026-10-19', '2026-10-23')]);
  assert.deepEqual(w.map(x => x.title), ['가을학기 수강신청 변경', '겨울학기 수강신청']);
});

test('학사·생활관 캘린더 일정: 여러 날 종일, 끝 날짜는 다음 날(배타)', () => {
  const [t] = planTargets([{ schdlNo: 'D10100', title: '가을학기 중간고사', startDate: '2026-10-19', endDate: '2026-10-23', cldrNo: '38' }]);
  const ev = campusGEvent(t!);
  assert.equal(ev.start.date, '2026-10-19');
  assert.equal(ev.end.date, '2026-10-24');
  assert.equal(ev.colorId, '10');
  assert.equal(ev.summary, '[학사] 가을학기 중간고사');
  assert.equal(ev.extendedProperties?.private?.kaistCampusKey, 'plan:D10100');
  assert.equal(ev.reminders?.overrides?.[0]?.minutes, 900); // 전날 09:00
});

const dormHtml = (rows: [string, string][]) => `<ul class="info-ulbox">${rows.map(([k, v]) => `<li><dl class="nopm"><dt>${k}</dt><dd>${v}</dd></dl></li>`).join('')}</ul>`;

test('생활관: 필요한 칸만 읽고 이름·학번·금액은 버린다', () => {
  const d = parseDormInfo(dormHtml([['학기', '2026 Autumn'], ['이름(학번)', '홍길동(20000000)'], ['배정생활관', ' A동\n 101-a '], ['입사일', '2026. 09. 01'], ['퇴사일', '-'], ['거주기간만료', '2026.12'], ['환불예정금액', '100,000원']]));
  assert.deepEqual(d, { semester: '2026 Autumn', dorm: 'A동 101-a', moveIn: '2026-09-01', moveOut: null, residenceEnd: '2026-12' });
  assert.ok(!JSON.stringify(d).includes('홍길동') && !JSON.stringify(d).includes('20000000') && !JSON.stringify(d).includes('100,000'));
  assert.throws(() => parseDormInfo('<html></html>'), /info-ulbox/);
  assert.deepEqual(dormTargets(d).map(t => `${t.title} ${t.startDate}`), ['생활관 입사 2026-09-01']);
  assert.deepEqual(dormTargets({ ...d, moveOut: '2026-12-20' }).map(t => t.sourceKey), ['dorm:2026 Autumn:moveIn', 'dorm:2026 Autumn:moveOut']);
});

test('휴강 시각 규칙: 그날 수업이 1개가 아니면 B등급', () => {
  const base = { kind: 'no_class' as const, date: '2026-10-27', quote: '10/27(화) 휴강입니다', context: '공지: 10/27(화) 휴강입니다', sourceType: 'notice' as const,
    semester: { start: Date.parse('2026-08-31') / 1000, end: Date.parse('2026-12-18') / 1000 }, now: Date.parse('2026-10-15') / 1000, existing: false };
  assert.equal(verifyEvent({ ...base, classCount: 1 }).grade, 'A');
  assert.equal(verifyEvent({ ...base }).grade, 'A', '시간표가 없으면 기존 규칙(종일)');
  assert.deepEqual(verifyEvent({ ...base, classCount: 0 }).needsConfirmReasons, ['그날 시간표에 이 과목 수업이 없음']);
  assert.deepEqual(verifyEvent({ ...base, classCount: 2 }).needsConfirmReasons, ['그날 이 과목 수업이 여러 개']);
  assert.equal(verifyEvent({ ...base, kind: 'exam', classCount: 0, start: '10:30', quote: '10/27(화) 10:30 시험', context: '10/27(화) 10:30 시험' }).needsConfirmReasons.includes('그날 시간표에 이 과목 수업이 없음'), false, '시험에는 적용 안 함');
});

import { replaceTimes } from '../src/events/register.js';

test('일정 수정: 종일↔시각 전환 시 이전 칸을 null로 지운다 (구글 PATCH는 start 안을 합침)', () => {
  const timed = replaceTimes({ summary: 's', start: { dateTime: '2026-10-19T04:00:00.000Z', timeZone: 'Asia/Seoul' }, end: { dateTime: '2026-10-19T06:45:00.000Z', timeZone: 'Asia/Seoul' } });
  assert.equal((timed.start as Record<string, unknown>).date, null);
  const allDay = replaceTimes({ summary: 's', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } });
  assert.equal((allDay.start as Record<string, unknown>).dateTime, null);
  assert.equal(allDay.start.date, '2026-10-19');
});
