// 새 버전 감지: 버전 비교와 릴리스 응답 해석 (네트워크 없음, fetch는 가짜)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate, isNewer, parseVersion } from '../app/update-check.js';

test('parseVersion은 v 접두사를 허용한다', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.10.0'), [1, 10, 0]);
  assert.equal(parseVersion('latest'), null);
});

test('isNewer는 숫자 단위로 비교한다', () => {
  assert.equal(isNewer('1.0.1', '1.0.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.0.0', '1.0.0'), false);
  assert.equal(isNewer('0.9.9', '1.0.0'), false);
  assert.equal(isNewer('abc', '1.0.0'), false);
});

const fake = (status: number, body: unknown): typeof fetch =>
  (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;

test('checkForUpdate: 새 태그가 있으면 설치 파일 링크를 돌려준다', async () => {
  const r = await checkForUpdate('1.0.0', fake(200, {
    tag_name: 'v1.1.0', html_url: 'https://github.com/x/releases/tag/v1.1.0',
    assets: [{ name: 'KAISTBOT-Setup-1.1.0.exe', browser_download_url: 'https://dl/KAISTBOT-Setup-1.1.0.exe' }],
  }));
  assert.equal(r.available, true);
  assert.equal(r.latest, '1.1.0');
  assert.equal(r.url, 'https://dl/KAISTBOT-Setup-1.1.0.exe');
});

test('checkForUpdate: 같은 버전이면 available=false', async () => {
  const r = await checkForUpdate('1.0.0', fake(200, { tag_name: 'v1.0.0', assets: [] }));
  assert.equal(r.available, false);
  assert.equal(r.latest, '1.0.0');
});

test('checkForUpdate: 오류는 삼키고 error 필드로 알린다', async () => {
  const r = await checkForUpdate('1.0.0', fake(403, {}));
  assert.equal(r.available, false);
  assert.match(r.error ?? '', /403/);
  const r2 = await checkForUpdate('1.0.0', (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
  assert.equal(r2.available, false);
  assert.equal(r2.error, 'offline');
});
