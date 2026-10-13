#!/usr/bin/env node
import { Command } from 'commander';
import { KaistError, exitCodeOf } from './errors.js';
import { fetchCurrentCourses, type Course } from './klms/courses.js';
import { KlmsHttp } from './klms/http.js';
import { SessionStore } from './klms/session-store.js';
import { ensureSession, interactiveLogin, probe, resumeSession } from './klms/session.js';
import { loadCourses, saveCourses } from './store/courses-cache.js';

const program = new Command();
program.name('kaist').description('KAIST KLMS 수집 CLI (읽기 전용)');

/** --json이면 stdout에 JSON 한 덩어리, 아니면 사람이 읽는 텍스트 */
function output<T>(json: boolean | undefined, data: T, text: (d: T) => string): void {
  console.log(json ? JSON.stringify({ ok: true, ...data }, null, 2) : text(data));
}

const status = (m: string) => console.error(`[kaist] ${m}`);

function run<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    const opts = args.at(-2) as { json?: boolean } | undefined;
    try {
      await fn(...args);
    } catch (e) {
      const err = e instanceof KaistError ? e : new KaistError('INTERNAL', e instanceof Error ? e.message : String(e));
      if (opts?.json) console.log(JSON.stringify({ ok: false, error: { code: err.code, message: err.message } }, null, 2));
      else console.error(`오류 [${err.code}] ${err.message}`);
      process.exitCode = exitCodeOf(e);
    }
  };
}

const minutesSince = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60000);
const fmtTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

program.command('login')
  .description('세션을 확인하고, 만료됐으면 브라우저 창으로 로그인')
  .option('--force', '세션이 살아 있어도 다시 로그인')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { force?: boolean; json?: boolean }) => {
    const store = new SessionStore();
    let reused = false;
    if (!opts.force) reused = (await resumeSession(store)) !== null;
    if (!reused) await interactiveLogin(store, status);
    output(opts.json, { loggedIn: true, reused }, d => d.reused ? '이미 로그인되어 있습니다 (세션 재사용).' : '로그인했습니다. 세션을 저장했습니다.');
  }));

program.command('status')
  .description('세션 상태, 마지막 수집 시각, 과목 수 (기본은 로컬 정보만)')
  .option('--check', 'KLMS에 접속해 세션이 유효한지 확인 (요청 1건)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { check?: boolean; json?: boolean }) => {
    const store = new SessionStore();
    const saved = store.load();
    let valid: boolean | null = null;
    if (opts.check && saved) {
      const http = new KlmsHttp(saved, store);
      const p = await probe(http);
      valid = p.ok;
      if (p.ok) http.persist();
    } else if (opts.check) valid = false;
    const cache = loadCourses();
    const data = {
      session: saved ? { savedAt: saved.savedAt, lastUsedAt: saved.lastUsedAt, idleMinutes: minutesSince(saved.lastUsedAt), valid } : null,
      courses: cache ? { semester: cache.semester.label, count: cache.courses.length, fetchedAt: cache.fetchedAt } : null,
      lastSync: null as string | null, // S2에서 채움
    };
    output(opts.json, data, d => [
      d.session
        ? `세션: 저장됨 (로그인 ${fmtTime(d.session.savedAt)}, 마지막 사용 ${d.session.idleMinutes}분 전)` +
          (d.session.valid === null ? ' — 유효 여부는 --check로 확인' : d.session.valid ? ' — 유효' : ' — 만료')
        : '세션: 없음 또는 파일 손상 (`kaist login` 필요)',
      d.courses ? `과목: ${d.courses.semester} ${d.courses.count}개 (목록 갱신 ${fmtTime(d.courses.fetchedAt)})` : '과목: 아직 가져오지 않음 (`kaist courses --refresh`)',
      `마지막 수집: ${d.lastSync ?? '없음'}`,
    ].join('\n'));
  }));

program.command('courses')
  .description('이번 학기 수강 과목 (기본은 로컬 데이터)')
  .option('--refresh', 'KLMS에서 다시 가져오기')
  .option('--no-login', '세션이 만료됐으면 로그인 창을 띄우지 않고 실패')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { refresh?: boolean; login: boolean; json?: boolean }) => {
    let cache = loadCourses();
    let source: 'local' | 'klms' = 'local';
    if (opts.refresh || !cache) {
      const session = await ensureSession({ interactive: opts.login, onStatus: status });
      const { semester, courses } = await fetchCurrentCourses(session);
      session.http.persist();
      cache = { fetchedAt: new Date().toISOString(), semester, courses };
      saveCourses(cache);
      source = 'klms';
    }
    const c = cache;
    output(opts.json, { source, fetchedAt: c.fetchedAt, semester: c.semester, courses: c.courses }, d => [
      `${d.semester.label} 수강 과목 ${d.courses.length}개 (${d.source === 'klms' ? 'KLMS에서 방금 가져옴' : `로컬 데이터, ${fmtTime(d.fetchedAt)} 기준`})`,
      ...d.courses.map((x: Course) => `  ${x.code.padEnd(22)} ${x.name}  [id ${x.id}]`),
    ].join('\n'));
  }));

await program.parseAsync();
