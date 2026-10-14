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
