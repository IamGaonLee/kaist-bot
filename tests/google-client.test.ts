// 구글 OAuth 클라이언트 탐색 순서: 사용자 파일 → KAIST_GOOGLE_CLIENT → 빌드에 포함된 공유 클라이언트 (합성 값만, 네트워크 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaist-gclient-'));
process.env.KAIST_HOME = path.join(tmp, 'home');
delete process.env.KAIST_GOOGLE_CLIENT;
const { parseGoogleClient, googleClientFile, hasGoogleClient, setBundledGoogleClientFile } = await import('../src/google/oauth.js');

const clientJson = (id: string) => JSON.stringify({ installed: { client_id: id, client_secret: 's', redirect_uris: ['http://localhost'] } });

test('parseGoogleClient: installed/web 형식만, BOM 허용, 아니면 GOOGLE_BAD_CLIENT', () => {
  assert.deepEqual(parseGoogleClient('﻿' + clientJson('a')), { client_id: 'a', client_secret: 's' });
  assert.deepEqual(parseGoogleClient(JSON.stringify({ web: { client_id: 'w', client_secret: 'x' } })), { client_id: 'w', client_secret: 'x' });
  assert.throws(() => parseGoogleClient('{}'), (e: { code: string }) => e.code === 'GOOGLE_BAD_CLIENT');
  assert.throws(() => parseGoogleClient('not json'), (e: { code: string }) => e.code === 'GOOGLE_BAD_CLIENT');
});

test('googleClientFile: 아무것도 없으면 null, 번들 → 환경변수 → 사용자 파일 순으로 덮어쓴다', () => {
  assert.equal(googleClientFile(), null);
  assert.equal(hasGoogleClient(), false);

  const bundled = path.join(tmp, 'bundle', 'google-client.json');
  setBundledGoogleClientFile(bundled);
  assert.equal(googleClientFile(), null, '등록만 하고 파일이 없으면 여전히 없음');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, clientJson('bundled'));
  assert.deepEqual(googleClientFile(), { file: bundled, source: 'bundled' });

  const envFile = path.join(tmp, 'env.json');
  fs.writeFileSync(envFile, clientJson('env'));
  process.env.KAIST_GOOGLE_CLIENT = envFile;
  assert.deepEqual(googleClientFile(), { file: envFile, source: 'env' });

  const userFile = path.join(tmp, 'home', 'google-client.json');
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, clientJson('user'));
  assert.deepEqual(googleClientFile(), { file: userFile, source: 'user' });
  assert.equal(hasGoogleClient(), true);
  delete process.env.KAIST_GOOGLE_CLIENT;
});
