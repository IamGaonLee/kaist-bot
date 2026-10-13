#!/usr/bin/env node
import { Command } from 'commander';
import { KaistError, exitCodeOf } from './errors.js';
import { fetchCurrentCourses, type Course } from './klms/courses.js';
import { KlmsHttp } from './klms/http.js';
import { SessionStore } from './klms/session-store.js';
import { ensureSession, interactiveLogin, probe, resumeSession } from './klms/session.js';
import { loadCourses, saveCourses } from './store/courses-cache.js';
import { getMeta } from './store/db.js';
import { listFiles, listNotices, listTasks, listVideos } from './store/queries.js';
import { runDoctor } from './sync/doctor.js';
import { matchCourse, runSync, type SyncResult } from './sync/sync.js';
import { formatKst, nowSec, parseDuration } from './util/time.js';
import { ensureCalendar, pushDeadlines } from './cal/push.js';
import { addEvent, deleteEvent, getEvent, listEvents, parseKstOrThrow, parseReminders, updateEvent } from './cal/manual.js';
import { googleLogin } from './google/oauth.js';

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
      lastSync: getMeta('last_sync_at'),
    };
    output(opts.json, data, d => [
      d.session
        ? `세션: 저장됨 (로그인 ${fmtTime(d.session.savedAt)}, 마지막 사용 ${d.session.idleMinutes}분 전)` +
          (d.session.valid === null ? ' — 유효 여부는 --check로 확인' : d.session.valid ? ' — 유효' : ' — 만료')
        : '세션: 없음 또는 파일 손상 (`kaist login` 필요)',
      d.courses ? `과목: ${d.courses.semester} ${d.courses.count}개 (목록 갱신 ${fmtTime(d.courses.fetchedAt)})` : '과목: 아직 가져오지 않음 (`kaist courses --refresh`)',
      `마지막 수집: ${d.lastSync ? `${fmtTime(d.lastSync)} (${minutesSince(d.lastSync)}분 전)` : '없음'}`,
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

/** --course 값을 로컬 과목 id 목록으로. 없으면 undefined(전체) */
function courseIds(q: string | undefined): number[] | undefined {
  if (!q) return undefined;
  const cache = loadCourses();
  if (!cache) throw new KaistError('NO_LOCAL_DATA', '로컬 과목 목록이 없습니다. `kaist sync`를 먼저 실행해 주세요.');
  const ids = cache.courses.filter(c => matchCourse(c, q)).map(c => c.id);
  if (ids.length === 0) throw new KaistError('NO_COURSE_MATCH', `"${q}"에 해당하는 과목이 없습니다.`);
  return ids;
}

function requireSynced(): void {
  if (!getMeta('last_sync_at')) throw new KaistError('NO_LOCAL_DATA', '아직 수집한 데이터가 없습니다. `kaist sync`를 먼저 실행해 주세요.');
}

const CHANGE_LABEL: Record<string, string> = {
  new: '새로 생김', changed: '바뀜', removed: '사라짐', due_changed: '마감 변경', status_changed: '제출 상태 변경', needs_review: '마감 확인 필요',
};

function syncText(r: SyncResult): string {
  const lines: string[] = [];
  const head = r.status === 'ok' ? '수집 완료' : r.status === 'partial' ? '수집 일부 실패' : '수집 중단';
  lines.push(`${head} — ${r.semester} (${fmtTime(r.finishedAt)}, 요청 ${r.requests}건)`);
  if (r.abortReason) lines.push(`  중단 이유 [${r.abortReason.code}] ${r.abortReason.message}`);
  for (const c of r.courses) {
    lines.push(c.ok
      ? `  ✓ ${c.code} ${c.name}: 활동 ${c.stats?.modules}, 과제페이지 ${c.stats?.assignPages}, 게시판목록 ${c.stats?.boardListPages}쪽, 새 글 ${c.stats?.newArticles}`
      : `  ✗ ${c.code} ${c.name}: [${c.error?.code}] ${c.error?.message}`);
  }
  const code = new Map(r.courses.map(c => [c.id, c.code]));
  // 첫 수집 과목은 "새로 생김"을 하나하나 나열하지 않고 개수만
  const first = new Set(r.courses.filter(c => c.stats?.firstSync).map(c => c.id));
  for (const id of first) {
    const n = (kind: string) => r.changes.filter(c => c.courseId === id && c.change === 'new' && c.kind === kind).length;
    lines.push(`  첫 수집 ${code.get(id)}: 활동 ${n('module')}개, 과제·퀴즈 ${n('task')}개, 게시판 글 ${n('notice')}개 등록`);
  }
  const interesting = r.changes.filter(c => !(first.has(c.courseId) && c.change === 'new') && (c.kind !== 'module' || c.change !== 'changed'));
  if (interesting.length) {
    lines.push(`변경 ${interesting.length}건:`);
    const shown = interesting.slice(0, 60);
    for (const c of shown) lines.push(`  [${CHANGE_LABEL[c.change]}] ${code.get(c.courseId) ?? c.courseId} ${c.kind === 'notice' ? '글' : c.kind === 'task' ? '과제' : c.detail ?? '활동'}: ${c.title}${c.detail && c.kind === 'task' && c.change !== 'new' ? ` (${c.detail})` : ''}`);
    if (interesting.length > shown.length) lines.push(`  … 외 ${interesting.length - shown.length}건 (--json으로 전체 확인)`);
  } else lines.push('변경 없음');
  if (r.files) {
    const f = r.files;
    const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
    if (f.awaitingConfirm) {
      lines.push(`파일: 첫 다운로드 대기 — 새 파일 ${f.planned.download}개, 약 ${mb(f.planned.bytes)} → ${f.root}`);
      lines.push('  진행하려면 `kaist sync --confirm-download`를 실행해 주세요 (한 번만 필요).');
    } else {
      lines.push(`파일: 새로 받음 ${f.downloaded}, 새 버전 ${f.updated}, 그대로 ${f.planned.same}${f.failed.length ? `, 실패 ${f.failed.length}` : ''} → ${f.root}`);
      for (const x of f.failed) lines.push(`  실패: ${x.file} — ${x.error}`);
    }
    if (f.unavailable.length) {
      lines.push(`  받지 않은 파일 ${f.unavailable.length}개 (뷰어 전용 등):`);
      for (const u of f.unavailable.slice(0, 10)) lines.push(`    ${u.file} — ${u.reason}`);
    }
    lines.push(`  드라이브 요약 md ${f.markdownWritten}개 갱신`);
  }
  if (r.calendar) {
    const c = r.calendar;
    lines.push(`캘린더 "KLMS": 새 일정 ${c.created.length}, 수정 ${c.updated.length}, 수집 시각만 갱신 ${c.refreshed}`);
    for (const s of [...c.created.map(x => `+ ${x}`), ...c.updated.map(x => `~ ${x}`)].slice(0, 20)) lines.push(`  ${s}`);
    for (const s of c.skippedReview) lines.push(`  ⚠ 마감 확인 필요라 등록 안 함: ${s}`);
  }
  if (Object.keys(r.unprocessed).length) lines.push(`처리하지 못한 활동 유형: ${Object.entries(r.unprocessed).map(([k, v]) => `${k} ${v}개`).join(', ')}`);
  for (const w of r.warnings) lines.push(`경고: ${w}`);
  return lines.join('\n');
}

program.command('sync')
  .description('KLMS에서 과목 구성, 과제, 공지, 강의자료를 증분 수집하고 드라이브 요약을 갱신')
  .option('--course <과목>', '특정 과목만 (코드, id, 이름 일부)')
  .option('--no-files', '파일 다운로드와 드라이브 md 생성 건너뛰기')
  .option('--confirm-download', '첫 전체 다운로드 승인 (한 번만)')
  .option('--no-calendar', '구글 캘린더 반영 생략')
  .option('--no-login', '세션이 만료됐으면 로그인 창을 띄우지 않고 실패')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { course?: string; files: boolean; confirmDownload?: boolean; calendar: boolean; login: boolean; json?: boolean }) => {
    const r = await runSync({ course: opts.course, interactive: opts.login, files: opts.files, confirmDownload: opts.confirmDownload, calendar: opts.calendar, onStatus: status });
    if (opts.json) console.log(JSON.stringify({ ok: r.status === 'ok', ...r }, null, 2));
    else console.log(syncText(r));
    if (r.status === 'aborted') process.exitCode = r.abortReason?.code === 'SESSION_EXPIRED' ? 2 : 1;
    else if (r.status === 'partial') process.exitCode = 1;
  }));

program.command('assignments')
  .description('과제·퀴즈와 마감 (로컬 데이터). 기본: 지난 1일 이후 마감 + 확인 필요 항목')
  .option('--due <기간>', '앞으로 이 기간 안에 마감인 것만 (예: 7d, 48h)')
  .option('--all', '지난 과제와 마감 없는 과제까지 전부')
  .option('--course <과목>', '특정 과목만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { due?: string; all?: boolean; course?: string; json?: boolean }) => {
    requireSynced();
    const tasks = listTasks({ now: nowSec(), withinSec: opts.due ? parseDuration(opts.due) : undefined, all: opts.all, course: courseIds(opts.course) });
    const lastSync = getMeta('last_sync_at');
    output(opts.json, { lastSync, tasks }, d => [
      `과제 ${d.tasks.length}개 (마지막 수집 ${fmtTime(d.lastSync!)})`,
      ...d.tasks.map(t => `  ${t.needsReview ? '⚠ ' : ''}${t.dueKst ?? '마감 없음'.padEnd(16)}  ${t.course.padEnd(13)} ${t.name}` +
        `  [${t.submissionText ?? (t.type === 'quiz' ? '퀴즈' : '상태 미확인')}]${t.removed ? ' (KLMS에서 사라짐)' : ''}` +
        (t.needsReview ? `\n      확인 필요: ${t.reviewReason}` : '') + (t.dueSource === 'html' ? '  (마감: 과목 페이지 기준)' : '')),
    ].join('\n'));
  }));

program.command('notices')
  .description('공지/게시판 글 (로컬 데이터)')
  .option('--since <기간>', '이 기간 안에 올라온 글만 (예: 3d)')
  .option('--course <과목>', '특정 과목만')
  .option('--kind <종류>', 'notice | qna | board | all', 'all')
  .option('--body', '본문 텍스트 포함')
  .option('--limit <n>', '최대 개수', '50')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { since?: string; course?: string; kind: string; body?: boolean; limit: string; json?: boolean }) => {
    requireSynced();
    const notices = listNotices({ sinceSec: opts.since ? nowSec() - parseDuration(opts.since) : undefined, course: courseIds(opts.course), kind: opts.kind, body: opts.body, limit: Number(opts.limit) });
    output(opts.json, { lastSync: getMeta('last_sync_at'), notices }, d => [
      `글 ${d.notices.length}개 (마지막 수집 ${fmtTime(d.lastSync!)})`,
      ...d.notices.map(n => `  ${n.postedKst ?? '-'}  ${n.course.padEnd(13)} [${n.board}] ${n.title}${n.attachments.length ? ` (첨부 ${n.attachments.length})` : ''}` +
        (n.bodyText ? `\n${n.bodyText.split('\n').map(l => '      ' + l).join('\n')}` : '')),
    ].join('\n'));
  }));

program.command('videos')
  .description('영상(LTI/Panopto) 제목과 링크 (로컬 데이터, 영상은 받지 않음)')
  .option('--course <과목>', '특정 과목만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { course?: string; json?: boolean }) => {
    requireSynced();
    const videos = listVideos({ course: courseIds(opts.course) });
    output(opts.json, { videos }, d => [`영상 링크 ${d.videos.length}개`, ...d.videos.map(v => `  ${v.course.padEnd(13)} ${v.section ?? ''} | ${v.name}\n      ${v.url}`)].join('\n'));
  }));

program.command('files')
  .description('강의자료·첨부 파일 목록 (로컬 데이터)')
  .option('--new', '마지막 sync에서 새로 받은 것만')
  .option('--course <과목>', '특정 과목만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { new?: boolean; course?: string; json?: boolean }) => {
    requireSynced();
    const files = listFiles({ course: courseIds(opts.course), onlyNew: opts.new });
    output(opts.json, { files }, d => [
      `파일 ${d.files.length}개${opts.new ? ' (마지막 sync에서 받음)' : ''}`,
      ...d.files.map(f => `  ${f.course.padEnd(13)} [${f.statusLabel}] ${f.filename}${f.localPath ? `\n      ${f.localPath}` : ''}`),
    ].join('\n'));
  }));

const cal = program.command('cal').description('구글 "KLMS" 전용 캘린더 (이 CLI가 만든 캘린더만 접근 가능)');

cal.command('login')
  .description('구글 계정 승인 (브라우저). 범위: 이 앱이 만든 캘린더만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { json?: boolean }) => {
    await googleLogin(status);
    const id = await ensureCalendar();
    output(opts.json, { calendarId: id }, () => '구글 캘린더를 연결했습니다. "KLMS" 캘린더를 준비했습니다.');
  }));

cal.command('push')
  .description('로컬 마감 데이터를 KLMS 캘린더에 반영 (KLMS에 접속하지 않음)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { json?: boolean }) => {
    requireSynced();
    const r = await pushDeadlines(getMeta('last_sync_at')!);
    output(opts.json, r, d => [`KLMS 캘린더: 새 일정 ${d.created.length}, 수정 ${d.updated.length}, 수집 시각만 갱신 ${d.refreshed}`,
      ...d.created.map(x => `  + ${x}`), ...d.updated.map(x => `  ~ ${x}`), ...d.skippedReview.map(x => `  ⚠ 확인 필요라 등록 안 함: ${x}`)].join('\n'));
  }));

cal.command('list')
  .description('KLMS 캘린더 일정 (기본: 오늘부터 14일)')
  .option('--from <날짜>', 'YYYY-MM-DD 또는 "YYYY-MM-DD HH:MM" (KST)')
  .option('--to <날짜>', 'YYYY-MM-DD 또는 "YYYY-MM-DD HH:MM" (KST)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { from?: string; to?: string; json?: boolean }) => {
    const today = parseKstOrThrow(formatKst(nowSec()).slice(0, 10), '오늘');
    const from = opts.from ? parseKstOrThrow(opts.from, '--from') : today;
    const to = opts.to ? parseKstOrThrow(opts.to, '--to') + (opts.to.length === 10 ? 86400 : 0) : from + 14 * 86400;
    const events = await listEvents(from, to);
    output(opts.json, { events }, d => [`KLMS 캘린더 일정 ${d.events.length}개`,
      ...d.events.map(e => `  ${e.startKst.endsWith('종일') ? e.startKst.padEnd(16) : `${e.startKst}~${e.endKst.slice(11)}`}  ${e.summary}${e.kind === 'manual' ? '  (직접 추가)' : ''}  [id ${e.id}]`)].join('\n'));
  }));

cal.command('add')
  .description('KLMS 캘린더에 일정 직접 추가 (예: 과제 작업 시간)')
  .requiredOption('--title <제목>', '일정 제목')
  .option('--start <시각>', '"YYYY-MM-DD HH:MM" (KST)')
  .option('--end <시각>', '"YYYY-MM-DD HH:MM" (KST)')
  .option('--minutes <분>', '--end 대신 길이', '60')
  .option('--all-day <날짜>', '종일 일정 (YYYY-MM-DD), --start 대신')
  .option('--location <장소>', '장소')
  .option('--remind <목록>', '알림, 예: 7d,1d (일정 시작 기준)')
  .option('--color <id>', '구글 캘린더 색 번호 1~11 (11=빨강)')
  .option('--kind <종류>', 'exam | no_class | online | makeup | task 등 (기록용)')
  .option('--desc <설명>', '설명')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { title: string; start?: string; end?: string; minutes: string; allDay?: string; location?: string; remind?: string; color?: string; kind?: string; desc?: string; json?: boolean }) => {
    if (!opts.allDay && !opts.start) throw new KaistError('BAD_TIME', '--start 또는 --all-day 중 하나가 필요합니다.');
    const start = opts.start ? parseKstOrThrow(opts.start, '--start') : undefined;
    const end = start === undefined ? undefined : opts.end ? parseKstOrThrow(opts.end, '--end') : start + Number(opts.minutes) * 60;
    const e = await addEvent({
      title: opts.title, start, end, allDay: opts.allDay, description: opts.desc, location: opts.location,
      remindMinutes: opts.remind ? parseReminders(opts.remind) : undefined, colorId: opts.color, kind: opts.kind,
    });
    output(opts.json, { event: e }, d => `추가했습니다: ${d.event.startKst}${d.event.startKst.endsWith('종일') ? '' : '~' + d.event.endKst.slice(11)} ${d.event.summary} [id ${d.event.id}]`);
  }));

cal.command('update')
  .description('KLMS 캘린더 일정 수정 (자동 마감 일정은 제목·설명만)')
  .argument('<id>', '일정 id (cal list에서 확인)')
  .option('--title <제목>').option('--start <시각>').option('--end <시각>').option('--desc <설명>')
  .option('--json', 'JSON 출력')
  .action(run(async (id: string, opts: { title?: string; start?: string; end?: string; desc?: string; json?: boolean }) => {
    const e = await updateEvent(id, {
      title: opts.title, description: opts.desc,
      start: opts.start ? parseKstOrThrow(opts.start, '--start') : undefined,
      end: opts.end ? parseKstOrThrow(opts.end, '--end') : undefined,
    });
    output(opts.json, { event: e }, d => `수정했습니다: ${d.event.startKst}~${d.event.endKst.slice(11)} ${d.event.summary}`);
  }));

cal.command('delete')
  .description('KLMS 캘린더 일정 삭제 (--yes 없으면 대상만 보여주고 멈춤)')
  .argument('<id>', '일정 id')
  .option('--yes', '확인했으니 삭제')
  .option('--json', 'JSON 출력')
  .action(run(async (id: string, opts: { yes?: boolean; json?: boolean }) => {
    const e = await getEvent(id);
    if (!opts.yes) {
      output(opts.json, { deleted: false, event: e }, d => `삭제 대상: ${d.event.startKst} ${d.event.summary}${d.event.kind === 'deadline' ? ' (자동 마감 일정 — 다음 sync에서 다시 만들어집니다)' : ''}\n삭제하려면 --yes를 붙여 다시 실행하세요.`);
      process.exitCode = 4;
      return;
    }
    await deleteEvent(id);
    output(opts.json, { deleted: true, event: e }, d => `삭제했습니다: ${d.event.summary}`);
  }));

program.command('doctor')
  .description('불변식 검사: 파서가 KLMS 화면과 맞는지 (DB는 바꾸지 않음)')
  .argument('[과목]', '특정 과목만')
  .option('--offline', '접속하지 않고 마지막으로 보관한 HTML로 검사')
  .option('--no-login', '세션이 만료됐으면 로그인 창을 띄우지 않고 실패')
  .option('--json', 'JSON 출력')
  .action(run(async (q: string | undefined, opts: { offline?: boolean; login: boolean; json?: boolean }) => {
    const cache = loadCourses();
    if (!cache) throw new KaistError('NO_LOCAL_DATA', '로컬 과목 목록이 없습니다. `kaist courses --refresh` 또는 `kaist sync`를 먼저 실행해 주세요.');
    const targets = q ? cache.courses.filter(c => matchCourse(c, q)) : cache.courses;
    if (targets.length === 0) throw new KaistError('NO_COURSE_MATCH', `"${q}"에 해당하는 과목이 없습니다.`);
    const r = await runDoctor(targets, { offline: !!opts.offline, interactive: opts.login, onStatus: status });
    const allOk = r.courses.every(c => c.ok);
    if (opts.json) console.log(JSON.stringify({ ok: allOk, ...r }, null, 2));
    else console.log([
      `불변식 검사 (${r.mode === 'online' ? 'KLMS 접속' : '보관 원문'}, 테마 ${r.theme ?? '-'}): ${allOk ? '모두 통과' : '실패 있음'}`,
      ...r.courses.map(c => c.ok
        ? `  ✓ ${c.code} ${c.name}: 섹션 ${c.stats?.sections}, 활동 ${c.stats?.modules} (게시판 ${c.stats?.boards}, 파일 ${c.stats?.resources})`
        : `  ✗ ${c.code} ${c.name}: ${c.failures.join(' / ')}`),
    ].join('\n'));
    if (!allOk) process.exitCode = 1;
  }));

await program.parseAsync();
