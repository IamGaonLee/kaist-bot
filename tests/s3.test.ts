// S3 단위 테스트: 드라이브 폴더 이름 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { courseDir, materialPath, previousVersionPath, safeName } from '../src/files/layout.js';

test('safeName: Windows 금지 문자, 끝 점/공백, 예약어, 길이', () => {
  assert.equal(safeName('HW1: 답안/풀이?'), 'HW1_ 답안_풀이_');
  assert.equal(safeName('파일 이름.  '), '파일 이름');
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('a'.repeat(200) + '.pdf', 50).length, 50);
  assert.ok(safeName('a'.repeat(200) + '.pdf', 50).endsWith('.pdf'));
  assert.equal(safeName('   '), '_');
});

test('과목 폴더: <코드> <과목명>', () => {
  const d = courseDir('G:\\내 드라이브\\KAIST', '2026-가을', { code: 'MAS.20050(B)', name: '확률및통계' });
  assert.equal(d, path.join('G:\\내 드라이브\\KAIST', '2026-가을', 'MAS.20050(B) 확률및통계'));
});

test('강의자료 경로와 이전 버전 경로', () => {
  const f = materialPath('C:\\x', '1주차', 'Week01.pdf');
  assert.equal(f, path.join('C:\\x', '강의자료', '1주차', 'Week01.pdf'));
  assert.equal(previousVersionPath(f, '2026-10-14'), path.join('C:\\x', '강의자료', '1주차', '_이전버전', 'Week01 (2026-10-14).pdf'));
});
