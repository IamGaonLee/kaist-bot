// S8d 성적 격리 테스트 (합성 데이터만). 임시 KAIST_HOME에서 실행한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaist-grades-'));
process.env.KAIST_HOME = path.join(tmp, 'home');
const { parseGrades, saveGrades, listGrades, cumulativeGpa } = await import('../src/sites/grades.js');
const { openDb } = await import('../src/store/db.js');
const { writeMarkdown } = await import('../src/files/markdown.js');
const { listChanges } = await import('../src/store/queries.js');

// 다른 데이터에 우연히 나오지 않을 값
const SECRET_NAME = '격리검사과목QX';
const SECRET_GPA = 3.1416;
const sample = {
  dsSgra100: [
    { syy: '2025', smtDivCd: '3', subjtCd: 'ZZ.99999', corseDvclsNo: 'A', subjtNm: SECRET_NAME, cdt: 3, gradeDivCd: 'B+', subjcDivNm: '전선', stuno: '20259999' },
    { syy: '2025', smtDivCd: '3', subjtCd: 'ZZ.88888', corseDvclsNo: '', subjtNm: '두번째과목QX', cdt: 1, gradeDivCd: 'S', subjcDivNm: '기필' },
    { syy: '2024', smtDivCd: '10', subjtCd: 'ZZ.77777', subjtNm: '인정과목QX', cdt: 2, gradeDivCd: 'P' },
  ],
  dsSgra120: [
    { syy: '2025', smtDivCd: '3', gpa: String(SECRET_GPA), aplyCdt: 3, cmpsjCdt: 4, stuno: '20259999', percnSco: '88.8' },
    { syy: '2025', smtDivCd: '1', gpa: '4.00', aplyCdt: 9, cmpsjCdt: 9 },
    { syy: '2024', smtDivCd: '5', gpa: '-', aplyCdt: 0, cmpsjCdt: 0 },
  ],
  dsSyySmt: [{ syy: '2025', smtDivCd: '3', syySmtNm: '2025년 가을학기' }],
};

test('성적 파서: 필요한 칸만, 학번·백분율은 읽지 않는다', () => {
  const g = parseGrades(sample);
  assert.equal(g.courses.length, 3);
  assert.deepEqual(g.courses[0], { year: '2025', termCode: '3', courseCode: 'ZZ.99999', section: 'A', name: SECRET_NAME, credits: 3, grade: 'B+', category: '전선' });
  assert.equal(g.terms[0]!.termName, '2025년 가을학기');
  assert.equal(g.terms[1]!.termName, '2025년 봄학기');
  assert.equal(g.terms[2]!.gpa, null);
  assert.ok(!JSON.stringify(g).includes('20259999') && !JSON.stringify(g).includes('88.8'));
  assert.throws(() => parseGrades({}), /dsSgra100/);
  try { parseGrades({ ...sample, dsSgra100: [{ ...sample.dsSgra100[0], gradeDivCd: '' }] }); assert.fail(); }
  catch (e) { assert.ok(!String((e as Error).message).includes(SECRET_NAME), '오류 메시지에 값이 없다'); }
});

test('누적 평점: 평점 반영 학점 가중 평균, computed 표시', () => {
  const c = cumulativeGpa(parseGrades(sample).terms);
  assert.equal(c.credits, 12);
  assert.equal(c.gpa, Math.round(((SECRET_GPA * 3 + 4 * 9) / 12) * 100) / 100);
  assert.equal(c.computed, true);
});

test('격리: 성적을 저장해도 드라이브 요약·changes에 값이 나가지 않는다', () => {
  const g = parseGrades(sample);
  saveGrades(g.courses, g.terms);
  assert.equal(listGrades().terms.length, 3);
  assert.equal(listGrades().otherCourses.length, 1, '학기 행이 없는 인정 과목');
  const db = openDb();
  db.prepare(`insert into courses(id, code, name, shortname, semester) values(1, 'AB.10000', '테스트과목', 'AB', '2026-가을')`).run();
  db.prepare(`insert into meta(key, value) values('last_sync_at', ?)`).run(new Date().toISOString());
  const root = path.join(tmp, 'drive');
  const written = writeMarkdown(root, '2026-가을', [1], new Date().toISOString());
  assert.ok(written.length >= 2);
  const all = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of all(root)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const v of [SECRET_NAME, String(SECRET_GPA), 'QX', 'ZZ.99999']) assert.ok(!text.includes(v), `${path.basename(f)}에 성적 값(${v})이 있음`);
  }
  assert.ok(!JSON.stringify(listChanges({ runs: 5 })).includes('QX'));
  assert.equal((db.prepare('select count(*) n from changes').get() as { n: number }).n, 0);
});

test('격리: grade_* 테이블과 ERP 성적 경로는 grades.ts에서만, sync는 grades.ts를 쓰지 않는다', () => {
  const src = path.join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
  for (const f of files(src)) {
    const rel = path.relative(src, f).replace(/\\/g, '/');
    const t = fs.readFileSync(f, 'utf8');
    if (rel !== 'sites/grades.ts' && rel !== 'store/db.ts') assert.ok(!/grade_(terms|courses)/.test(t), `${rel}가 성적 테이블을 읽음`);
    if (rel !== 'sites/grades.ts' && rel !== 'sites/sites.ts') assert.ok(!t.includes('findStdntEtcGradeList') && !t.includes('ERP_GRADES_FORM'), `${rel}가 ERP 성적 경로를 씀`);
    if (rel !== 'cli.ts' && rel !== 'sites/grades.ts') assert.ok(!t.includes('grades.js'), `${rel}가 grades 모듈을 가져옴`);
  }
});

test.after(() => {
  openDb().close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows가 파일을 늦게 놓으면 임시 폴더는 남는다 (합성 데이터) */ }
});
