#!/usr/bin/env node
import { Command } from 'commander';
import { KaistError, exitCodeOf } from './errors.js';
import { fetchCurrentCourses, type Course } from './klms/courses.js';
import { SITES, type SiteId } from './klms/session-store.js';
import { ensureSession } from './klms/session.js';
import { loginAll, probeSite, siteStatuses } from './sites/session.js';
import { dormSummary, listCampusEvents, undoCampus, listCollegePlan, listTimetable, todayKst } from './sites/campus.js';
import { listPortalNotices } from './sites/notices.js';
import { loadCourses, saveCourses } from './store/courses-cache.js';
import { getMeta, setMeta } from './store/db.js';
import { listChanges, listFiles, listNotices, listTasks, listVideos } from './store/queries.js';
import { runDoctor } from './sync/doctor.js';
import { matchCourse, runSync, type SyncResult } from './sync/sync.js';
import { formatKst, nowSec, parseDuration } from './util/time.js';
import { ensureCalendar, pushDeadlines } from './cal/push.js';
import { addEvent, deleteEvent, getEvent, listEvents, parseKstOrThrow, parseReminders, updateEvent } from './cal/manual.js';
import { googleLogin, hasGmailScope } from './google/oauth.js';
import { listMails, rematchMailCourses, showMail, syncMail } from './mail/sync.js';
import { loadSettings } from './config.js';
import { writeMarkdown } from './files/markdown.js';
import { renderPdfs } from './files/pdf.js';
import { listCandidates, rescanCandidates, scanCandidates, setCandidateStatus, type Kind } from './events/candidates.js';
import { addSchoolEvent, importManualExams, lastSyncRun, listSchoolEvents, undoAuto, updateSchoolEvent } from './events/register.js';

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
      if (opts?.json) console.log(JSON.stringify({ ok: false, error: { code: err.code, message: err.message, ...(err.detail ? { detail: err.detail } : {}) } }, null, 2));
      else console.error(`오류 [${err.code}] ${err.message}`);
      process.exitCode = exitCodeOf(e);
    }
  };
}

/** 조회 결과에 붙이는 데이터 신선도 (에이전트가 시간대 계산 없이 쓰도록 KST와 경과 분) */
function syncInfo() {
  const lastSync = getMeta('last_sync_at');
  return { lastSync, lastSyncKst: lastSync ? formatKst(Math.floor(Date.parse(lastSync) / 1000)) : null, lastSyncMinutesAgo: lastSync ? minutesSince(lastSync) : null };
}

const minutesSince = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60000);
const fmtTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

/** 한글은 2칸으로 세어 맞춘다 */
const padWide = (t: string, n: number) => t + ' '.repeat(Math.max(1, n - [...t].reduce((w, ch) => w + (/[ㄱ-힣]/.test(ch) ? 2 : 1), 0)));

const STATE_LABEL: Record<string, string> = { ok: '유효', expired: '만료', 'no-session': '없음', error: '확인 실패' };

program.command('login')
  .description('세션을 확인하고, 만료됐으면 브라우저 창으로 로그인 (포털 → KLMS·ERP·생활관 연쇄, 폰 승인 1회)')
  .option('--force', '세션이 살아 있어도 다시 로그인')
  .option('--only <site>', '이 사이트만 로그인 (klms|portal|erp|kds)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { force?: boolean; only?: string; json?: boolean }) => {
    if (opts.only && !(SITES as readonly string[]).includes(opts.only)) throw new KaistError('BAD_ARGS', `--only는 ${SITES.join('|')} 중 하나입니다.`);
    const only = opts.only as SiteId | undefined;
    const targets: SiteId[] = only ? [only] : [...SITES];
    // 살아 있는 세션은 다시 로그인하지 않는다 (프로브 사이트당 1건)
    const before: Record<string, string> = {};
    if (!opts.force) for (const s of targets) before[s] = await probeSite(s);
    if (!opts.force && targets.every(s => before[s] === 'ok')) {
      output(opts.json, { loggedIn: true, reused: true, sites: targets.map(site => ({ site, chained: false, state: 'ok' })) }, () => '이미 로그인되어 있습니다 (세션 재사용).');
      return;
    }
    const r = await loginAll({ only, onStatus: status });
    const failed = r.sites.filter(x => x.state !== 'ok');
    if (failed.length) process.exitCode = 1;
    output(opts.json, { loggedIn: failed.length === 0, reused: false, sites: r.sites }, d => [
      failed.length ? '로그인했지만 일부 사이트 세션을 확인하지 못했습니다.' : '로그인했습니다. 세션을 저장했습니다.',
      ...d.sites.map(x => `  ${x.site.padEnd(6)} ${STATE_LABEL[x.state]}${x.chained ? '' : ' (연쇄 실패)'}`),
    ].join('\n'));
  }));

program.command('status')
  .description('사이트별 세션 상태, 마지막 수집 시각, 과목 수 (기본은 로컬 정보만)')
  .option('--check', '사이트마다 접속해 세션이 유효한지 확인 (사이트당 요청 1건)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { check?: boolean; json?: boolean }) => {
    const sites = siteStatuses();
    if (opts.check) for (const s of sites) s.state = await probeSite(s.site);
    const klms = sites.find(s => s.site === 'klms')!;
    const cache = loadCourses();
    const data = {
      // 기존 호환: KLMS 세션
      session: klms.saved ? { savedAt: klms.savedAt!, lastUsedAt: klms.lastUsedAt!, idleMinutes: minutesSince(klms.lastUsedAt!), valid: klms.state === null ? null : klms.state === 'ok' } : null,
      sites: sites.map(s => ({ ...s, idleMinutes: s.lastUsedAt ? minutesSince(s.lastUsedAt) : null })),
      courses: cache ? { semester: cache.semester.label, count: cache.courses.length, fetchedAt: cache.fetchedAt } : null,
      ...syncInfo(),
    };
    output(opts.json, data, d => [
      '세션:',
      ...d.sites.map(s => `  ${padWide(s.label, 7)}` + (s.saved
        ? `저장됨 (로그인 ${fmtTime(s.savedAt!)}, 마지막 사용 ${s.idleMinutes}분 전)` + (s.state === null ? '' : ` — ${STATE_LABEL[s.state]}`)
        : '없음' + (s.state === null || s.state === 'no-session' ? '' : ` — ${STATE_LABEL[s.state]}`))),
      ...(d.sites.some(s => s.state === null) && opts.check !== true ? ['  유효 여부는 --check로 확인'] : []),
      ...(d.sites.some(s => !s.saved || (s.state && s.state !== 'ok')) ? ['  다시 로그인: `kaist login` (폰 승인 1회)'] : []),
      d.courses ? `과목: ${d.courses.semester} ${d.courses.count}개 (목록 갱신 ${fmtTime(d.courses.fetchedAt)})` : '과목: 아직 가져오지 않음 (`kaist courses --refresh`)',
      `마지막 수집: ${d.lastSync ? `${fmtTime(d.lastSync)} (${minutesSince(d.lastSync)}분 전)` : '없음'}`,
    ].join('\n'));
  }));

program.command('timetable')
  .description('이번 학기 시간표 (포털, 로컬 데이터. sync가 갱신)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { json?: boolean }) => {
    const t = listTimetable();
    output(opts.json, { ...t, fetchedMinutesAgo: t.fetchedAt ? minutesSince(t.fetchedAt) : null }, d => d.slots.length === 0
      ? '시간표가 아직 없습니다. `kaist login` 뒤 `kaist sync`로 받습니다.'
      : [`시간표 (포털, ${fmtTime(d.fetchedAt!)} 받음)`, ...d.slots.map(s => `  ${s.day} ${s.start}~${s.end} ${s.courseName} (${s.course}) ${s.building} ${s.room}`)].join('\n'));
  }));

const school = program.command('school').description('학사일정 (포털 공식)');

school.command('list', { isDefault: true })
  .description('학사일정 (로컬 데이터). 기본은 주요 일정만, 오늘 이후')
  .option('--all', '주요 일정이 아닌 것도 (학사과정 달력 전체)')
  .option('--from <날짜>', 'YYYY-MM-DD부터')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { all?: boolean; from?: string; json?: boolean }) => {
    const from = opts.from ?? todayKst();
    const fetchedAt = getMeta('college_plan_fetched_at');
    const data = { fetchedAt, items: listCollegePlan({ from, major: !opts.all }), calendar: listCampusEvents({ from }) };
    output(opts.json, data, d => d.items.length === 0 && !d.fetchedAt
      ? '학사일정이 아직 없습니다. `kaist login` 뒤 `kaist sync`로 받습니다.'
      : [`학사일정 (포털, ${d.fetchedAt ? fmtTime(d.fetchedAt) : '-'} 받음)${opts.all ? '' : ' — 주요 일정'}`,
        ...d.items.map(p => `  ${p.startDate}${p.endDate !== p.startDate ? `~${p.endDate}` : ''} ${p.title}${opts.all && p.major ? ' ★' : ''}`)].join('\n'));
  }));

school.command('undo')
  .description('자동 등록한 학사·생활관 일정 되돌리기 (--yes 없으면 대상만 보여줌). 되돌린 일정은 다시 넣지 않음')
  .option('--sync <id>', '특정 sync 회차 (기본은 가장 최근)')
  .option('--yes', '확인했으니 캘린더에서 삭제')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { sync?: string; yes?: boolean; json?: boolean }) => {
    const r = await undoCampus(o.sync ? Number(o.sync) : 'last', !!o.yes);
    if (!r.deleted && r.targets.length) process.exitCode = 4;
    output(o.json, r, d => d.targets.length === 0 ? '되돌릴 자동 등록 일정이 없습니다.'
      : [`${d.deleted ? '되돌렸습니다' : '되돌릴 대상 (실행하려면 --yes)'}: sync ${d.syncId}, ${d.targets.length}건`,
        ...d.targets.map(t => `  ${t.startDate} [${t.kind === 'school' ? '학사' : '생활관'}] ${t.title}`)].join('\n'));
  }));

program.command('dorm')
  .description('생활관 배정 정보·일정 (kds, 로컬 데이터. 드라이브에 올리지 않음)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { json?: boolean }) => {
    const d0 = dormSummary();
    output(opts.json, d0, d => !d.fetchedAt
      ? '생활관 정보가 아직 없습니다. `kaist login` 뒤 `kaist sync`로 받습니다.'
      : [`생활관 (${fmtTime(d.fetchedAt)} 받음)`,
        `  학기 ${d.info.semester ?? '-'}, 생활관 ${d.info.dorm ?? '-'}`,
        `  입사 ${d.info.moveIn ?? '-'}, 퇴사 ${d.info.moveOut ?? '-'}, 거주기간 만료 ${d.info.residenceEnd ?? '-'}`,
        ...(d.schedule as { title: string; startDate: string | null }[]).map(s => `  일정 ${s.startDate ?? '-'} ${s.title}`)].join('\n'));
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
  const interesting = r.changes.filter(c => !(c.courseId !== null && first.has(c.courseId) && c.change === 'new') && (c.kind !== 'module' || c.change !== 'changed'));
  if (interesting.length) {
    lines.push(`변경 ${interesting.length}건:`);
    const shown = interesting.slice(0, 60);
    for (const c of shown) lines.push(`  [${CHANGE_LABEL[c.change]}] ${c.kind === 'course' || c.courseId === null ? '' : (code.get(c.courseId) ?? c.courseId) + ' '}${c.kind === 'portal_notice' ? '학교 공지' : c.kind === 'notice' ? '글' : c.kind === 'task' ? '과제' : c.kind === 'course' ? '과목' : c.detail ?? '활동'}: ${c.title}${c.detail && c.kind === 'task' && c.change !== 'new' ? ` (${c.detail})` : ''}`);
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
    lines.push(`  드라이브 요약 md ${f.markdownWritten}개, PDF ${f.pdfWritten}개 갱신`);
  }
  if (r.calendar) {
    const c = r.calendar;
    lines.push(`캘린더 "KLMS": 새 일정 ${c.created.length}, 수정 ${c.updated.length}, 수집 시각만 갱신 ${c.refreshed}`);
    for (const s of [...c.created.map(x => `+ ${x}`), ...c.updated.map(x => `~ ${x}`)].slice(0, 20)) lines.push(`  ${s}`);
    for (const s of c.skippedReview) lines.push(`  ⚠ 마감 확인 필요라 등록 안 함: ${s}`);
  }
  if (r.mail) lines.push(`메일: 새로 ${r.mail.newMails}통 (나에게 직접 ${r.mail.direct}, 과목 매핑 ${r.mail.courseMatched}) → kaist mail list --academic`);
  if (r.candidates) {
    const c = r.candidates;
    lines.push(`학사 일정 후보: 새로 ${c.newCandidates}건${c.pastSkipped ? ` (지난 학기 자료 ${c.pastSkipped}건 제외)` : ''}${c.newCandidates ? ' → kaist events candidates' : ''}`);
  }
  if (r.campus && r.campus.status !== 'skipped') {
    const c = r.campus;
    const parts = [c.timetable ? `시간표 ${c.timetable.slots}칸` : '', c.plan ? `학사일정 ${c.plan.items}건(주요 ${c.plan.major})` : '', c.dorm ? `생활관 정보${c.dorm.changed ? ' 변경됨' : ''}` : ''].filter(Boolean);
    lines.push(`포털·생활관: ${parts.join(', ') || '받은 것 없음'} (요청 ${c.requests}건)`);
    if (c.notices) {
      const n = c.notices;
      lines.push(`  학교 공지: ${n.boards.map(b => `${b.name} 새 ${b.fresh}${b.changed ? `·수정 ${b.changed}` : ''}`).join(', ')} (목록 ${n.boards.reduce((a, b) => a + b.pages, 0)}쪽, 본문 ${n.bodies}건)`);
    }
    const cal = c.calendar;
    if (cal.created.length + cal.updated.length + cal.removed.length) {
      lines.push(`  학사·생활관 일정: 새로 ${cal.created.length}, 수정 ${cal.updated.length}, 사라짐 ${cal.removed.length}`);
      for (const s of [...cal.created.map(x => `+ ${x}`), ...cal.updated.map(x => `~ ${x}`), ...cal.removed.map(x => `- ${x}`)].slice(0, 20)) lines.push(`    ${s}`);
    }
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
  .option('--no-portal', '포털 시간표·학사일정, 생활관 단계 생략')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { course?: string; files: boolean; confirmDownload?: boolean; calendar: boolean; login: boolean; portal: boolean; json?: boolean }) => {
    const r = await runSync({ course: opts.course, interactive: opts.login, files: opts.files, confirmDownload: opts.confirmDownload, calendar: opts.calendar, portal: opts.portal, onStatus: status });
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
    output(opts.json, { ...syncInfo(), tasks }, d => [
      `과제 ${d.tasks.length}개 (마지막 수집 ${fmtTime(d.lastSync!)})`,
      ...d.tasks.map(t => `  ${t.needsReview ? '⚠ ' : ''}${t.dueKst ?? '마감 없음'.padEnd(16)}  ${t.course.padEnd(13)} ${t.name}` +
        `  [${t.submissionText ?? (t.type === 'quiz' ? '퀴즈' : '상태 미확인')}]${t.removed ? ' (KLMS에서 사라짐)' : ''}` +
        (t.needsReview ? `\n      확인 필요: ${t.reviewReason}` : '') + (t.dueSource === 'html' ? '  (마감: 과목 페이지 기준)' : '')),
    ].join('\n'));
  }));

program.command('notices')
  .description('공지/게시판 글 (로컬 데이터). --source portal은 포털 학사 공지')
  .option('--source <출처>', 'klms | portal', 'klms')
  .option('--board <게시판>', '포털 게시판 번호나 이름 일부 (--source portal)')
  .option('--since <기간>', '이 기간 안에 올라온 글만 (예: 3d)')
  .option('--course <과목>', '특정 과목만')
  .option('--kind <종류>', 'notice | qna | board | all', 'all')
  .option('--body', '본문 텍스트 포함')
  .option('--limit <n>', '최대 개수', '50')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { source: string; board?: string; since?: string; course?: string; kind: string; body?: boolean; limit: string; json?: boolean }) => {
    requireSynced();
    const sinceSec = opts.since ? nowSec() - parseDuration(opts.since) : undefined;
    if (opts.source === 'portal') {
      const fetchedAt = getMeta('portal_notices_fetched_at');
      const notices = listPortalNotices({ sinceSec, board: opts.board, body: opts.body, limit: Number(opts.limit) });
      output(opts.json, { ...syncInfo(), source: 'portal', fetchedAt, notices }, d => [
        `포털 학교 공지 ${d.notices.length}개 (${d.fetchedAt ? fmtTime(d.fetchedAt) : '-'} 받음)`,
        ...d.notices.map(n => `  ${n.postedKst}${n.pinned ? ' 📌' : ''} [${n.board}] ${n.title}${n.dept ? ` — ${n.dept}` : ''}${n.attachmentCount ? ` (첨부 ${n.attachments.map(a => a.name).join(', ') || n.attachmentCount})` : ''}` +
          (n.bodyText ? `\n${n.bodyText.split('\n').map(l => '      ' + l).join('\n')}` : '')),
      ].join('\n'));
      return;
    }
    if (opts.source !== 'klms') throw new KaistError('BAD_ARGS', `--source는 klms 또는 portal입니다 (${opts.source}).`);
    const notices = listNotices({ sinceSec, course: courseIds(opts.course), kind: opts.kind, body: opts.body, limit: Number(opts.limit) });
    output(opts.json, { ...syncInfo(), notices }, d => [
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
    output(opts.json, { ...syncInfo(), videos }, d => [`영상 링크 ${d.videos.length}개`, ...d.videos.map(v => `  ${v.course.padEnd(13)} ${v.section ?? ''} | ${v.name}\n      ${v.url}`)].join('\n'));
  }));

program.command('changes')
  .description('최근 sync에서 새로 생기거나 바뀐 것 (로컬 데이터, 브리핑용)')
  .option('--runs <n>', '최근 몇 번의 sync까지', '1')
  .option('--course <과목>', '특정 과목만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { runs: string; course?: string; json?: boolean }) => {
    requireSynced();
    const r = listChanges({ runs: Math.max(1, Number(opts.runs) || 1), course: courseIds(opts.course) });
    output(opts.json, { ...syncInfo(), ...r }, d => [
      `최근 sync ${d.runs.length}회 (${d.runs.map(x => x.finishedKst).join(', ')}) 변경 ${d.changes.length}건`,
      ...d.changes.map(c => `  [${CHANGE_LABEL[c.change] ?? c.change}] ${c.course ?? ''} ${c.kind === 'notice' ? '글' : c.kind === 'task' ? '과제' : '자료'}: ${c.title}${c.detail ? ` (${c.detail})` : ''}`),
    ].join('\n'));
  }));

program.command('files')
  .description('강의자료·첨부 파일 목록 (로컬 데이터)')
  .option('--new', '마지막 sync에서 새로 받은 것만')
  .option('--course <과목>', '특정 과목만')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { new?: boolean; course?: string; json?: boolean }) => {
    requireSynced();
    const files = listFiles({ course: courseIds(opts.course), onlyNew: opts.new });
    output(opts.json, { ...syncInfo(), files }, d => [
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
      ...d.events.map(e => `  ${e.startKst.endsWith('종일') ? e.startKst.padEnd(16) : `${e.startKst}~${e.endKst.slice(11)}`}  ${e.summary}${e.kind === 'manual' ? '  (직접 추가)' : e.kind === 'school' ? '  (학사 일정)' : ''}  [id ${e.id}]`)].join('\n'));
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

const events = program.command('events').description('학사 일정(시험·휴강·온라인·보강): 후보 확인과 등록 (docs/school-events-design.md)');
const KINDS = ['exam', 'no_class', 'online', 'makeup'];
const kindOf = (k: string): Kind => {
  if (!KINDS.includes(k)) throw new KaistError('BAD_ARGS', `--kind는 ${KINDS.join(' | ')} 중 하나여야 합니다: "${k}"`);
  return k as Kind;
};

events.command('candidates')
  .description('sync가 찾은 일정 후보 (기본: 아직 처리 안 한 new만)')
  .option('--all', '처리한 것·지난 학기 자료까지 전부')
  .option('--course <과목>', '특정 과목만')
  .option('--kind <종류>', KINDS.join(' | '))
  .option('--limit <n>', '최대 개수', '50')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { all?: boolean; course?: string; kind?: string; limit: string; json?: boolean }) => {
    requireSynced();
    const list = listCandidates({ status: opts.all ? undefined : ['new'], course: courseIds(opts.course), kind: opts.kind, limit: Number(opts.limit) });
    output(opts.json, { ...syncInfo(), candidates: list }, d => [`일정 후보 ${d.candidates.length}개`,
      ...d.candidates.map(c => `  #${c.id} [${c.kindHint}] ${c.course} ${c.sourceTitle ?? ''}${c.sourcePostedKst ? ` (${c.sourcePostedKst})` : ''}${opts.all ? ` <${c.status}>` : ''}\n      "${c.snippet}"`)].join('\n'));
  }));

events.command('add')
  .description('후보를 해석해 학사 일정으로 등록 (검사 통과 필수, B등급은 --confirmed 필요)')
  .requiredOption('--course <과목>', '과목 코드·이름')
  .requiredOption('--kind <종류>', KINDS.join(' | '))
  .requiredOption('--date <날짜>', 'YYYY-MM-DD (KST)')
  .option('--start <시각>', 'HH:MM')
  .option('--end <시각>', 'HH:MM')
  .option('--location <장소>')
  .option('--title <이름>', '시험 이름 (예: 중간고사, 기말고사, 퀴즈 3)')
  .option('--from-candidate <id>', '근거 후보 id')
  .option('--quote <원문>', '후보 원문에서 그대로 복사한 근거 문장')
  .option('--manual', '후보 없이 직접 입력 (항상 확인 필요)')
  .option('--confirmed', '사용자가 확인함')
  .option('--dry-run', '검사와 등급만 보고 등록하지 않음')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { course: string; kind: string; date: string; start?: string; end?: string; location?: string; title?: string; fromCandidate?: string; quote?: string; manual?: boolean; confirmed?: boolean; dryRun?: boolean; json?: boolean }) => {
    requireSynced();
    const r = await addSchoolEvent({
      course: o.course, kind: kindOf(o.kind), date: o.date, start: o.start, end: o.end, location: o.location, label: o.title,
      fromCandidate: o.fromCandidate ? Number(o.fromCandidate) : undefined, quote: o.quote, manual: o.manual, confirmed: o.confirmed, dryRun: o.dryRun,
    });
    output(o.json, r, d => d.dryRun
      ? `검사 통과. 등급 ${d.verdict.grade}${d.verdict.needsConfirmReasons.length ? ` (확인 필요: ${d.verdict.needsConfirmReasons.join(', ')})` : ' (확인 없이 등록 가능)'}`
      : `등록했습니다 (${d.confidence === 'auto' ? '자동' : '확인됨'}): ${d.event!.date} ${d.event!.title} [id ${d.event!.id}]`);
  }));

events.command('update')
  .description('학사 일정 변경·취소 (항상 --confirmed 필요, 이력 기록)')
  .argument('<id>', '학사 일정 id (events list)')
  .option('--date <날짜>')
  .option('--start <시각>')
  .option('--end <시각>')
  .option('--location <장소>')
  .option('--title <이름>')
  .option('--cancel', '취소됨으로 표시 (일정은 지우지 않고 [취소])')
  .option('--from-candidate <id>')
  .option('--quote <원문>')
  .option('--confirmed', '사용자가 확인함')
  .option('--json', 'JSON 출력')
  .action(run(async (id: string, o: { date?: string; start?: string; end?: string; location?: string; title?: string; cancel?: boolean; fromCandidate?: string; quote?: string; confirmed?: boolean; json?: boolean }) => {
    const e = await updateSchoolEvent(Number(id), {
      date: o.date, start: o.start, end: o.end, location: o.location, label: o.title, cancel: o.cancel,
      fromCandidate: o.fromCandidate ? Number(o.fromCandidate) : undefined, quote: o.quote, confirmed: o.confirmed,
    });
    output(o.json, { event: e }, d => `수정했습니다: ${d.event.date} [id ${d.event.id}]${d.event.status === 'cancelled' ? ' (취소됨)' : ''}`);
  }));

events.command('dismiss')
  .description('일정이 아닌 후보를 닫기 (원문이 바뀌지 않는 한 다시 나오지 않음)')
  .argument('<ids...>', '후보 id들')
  .option('--reason <이유>', '닫는 이유', '일정 아님')
  .option('--json', 'JSON 출력')
  .action(run(async (ids: string[], o: { reason: string; json?: boolean }) => {
    for (const id of ids) setCandidateStatus(Number(id), 'dismissed', o.reason);
    output(o.json, { dismissed: ids.map(Number) }, d => `후보 ${d.dismissed.length}개를 닫았습니다.`);
  }));

events.command('list')
  .description('등록된 학사 일정 (기본: 오늘 이후)')
  .option('--from <날짜>', 'YYYY-MM-DD')
  .option('--to <날짜>', 'YYYY-MM-DD')
  .option('--auto', '자동 등록분만')
  .option('--sync <id>', '특정 sync 회차에 등록된 것만')
  .option('--course <과목>')
  .option('--cancelled', '취소된 일정 포함')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { from?: string; to?: string; auto?: boolean; sync?: string; course?: string; cancelled?: boolean; json?: boolean }) => {
    const list = listSchoolEvents({
      from: o.from ?? formatKst(nowSec()).slice(0, 10), to: o.to, auto: o.auto, syncId: o.sync ? Number(o.sync) : undefined,
      course: courseIds(o.course), includeCancelled: o.cancelled,
    });
    output(o.json, { ...syncInfo(), events: list }, d => [`학사 일정 ${d.events.length}개`,
      ...d.events.map(e => `  #${e.id} ${e.date} ${e.startKst ? `${e.startKst.slice(11)}~${e.endKst?.slice(11) ?? ''}` : '종일'.padEnd(11)} [${e.courseName}] ${e.title}${e.location ? ` @${e.location}` : ''} (${e.confidence === 'auto' ? '자동' : '확인됨'}${e.status === 'cancelled' ? ', 취소' : ''})`)].join('\n'));
  }));

events.command('undo')
  .description('자동 등록분 되돌리기 (--yes 없으면 대상만 보여줌)')
  .option('--last', '가장 최근 자동 등록 회차 (기본)')
  .option('--sync <id>', '특정 sync 회차')
  .option('--yes', '확인했으니 삭제')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { last?: boolean; sync?: string; yes?: boolean; json?: boolean }) => {
    const r = await undoAuto(o.sync ? Number(o.sync) : 'last', !!o.yes);
    output(o.json, r, d => d.targets.length === 0 ? '되돌릴 자동 등록 일정이 없습니다.' : [
      `${d.deleted ? '삭제했습니다' : '삭제 대상'} (sync ${d.syncId}): ${d.targets.length}개`,
      ...d.targets.map(t => `  ${t.date} [${t.courseName}] ${t.title}`),
      ...(d.deleted ? [] : ['삭제하려면 --yes를 붙여 다시 실행하세요.']),
    ].join('\n'));
    if (!o.yes && r.targets.length) process.exitCode = 4;
  }));

events.command('rescan')
  .description('후보 규칙을 바꾼 뒤 처리 안 한 후보를 다시 뽑기 (로컬 데이터만, KLMS 접속 없음)')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { json?: boolean }) => {
    requireSynced();
    const sem = JSON.parse(getMeta('semester')!) as { year: number };
    const r = await rescanCandidates(lastSyncRun() ?? 0, sem.year, status);
    output(o.json, r, d => `후보 다시 뽑기: 지움 ${d.removed}, 새로 ${d.newCandidates}건 (지난 학기 자료 ${d.pastSkipped}건 제외)`);
  }));

events.command('import-calendar')
  .description('S6 이전에 cal add로 직접 넣은 시험 일정을 학사 일정으로 가져오기 (한 번)')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { json?: boolean }) => {
    const r = await importManualExams();
    output(o.json, r, d => [`가져옴 ${d.imported.length}개, 건너뜀 ${d.skipped.length}개`, ...d.imported.map(x => `  + ${x}`)].join('\n'));
  }));

program.command('summary')
  .description('드라이브 요약(_요약·_과목정보 md/PDF)을 로컬 데이터로 다시 만들기 (KLMS 접속 없음)')
  .option('--no-pdf', 'PDF는 만들지 않음')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { pdf: boolean; json?: boolean }) => {
    requireSynced();
    const cache = loadCourses();
    if (!cache) throw new KaistError('NO_LOCAL_DATA', '로컬 과목 목록이 없습니다.');
    const { driveRoot } = loadSettings();
    const md = writeMarkdown(driveRoot, cache.semester.label, cache.courses.map(c => c.id), getMeta('last_sync_at')!);
    const pdf = o.pdf ? await renderPdfs(md.filter(f => /_(요약|과목정보|학교메일)\.md$/.test(f))) : { written: [], failed: [] };
    output(o.json, { markdown: md.length, pdf: pdf.written.length, failed: pdf.failed }, d =>
      `요약을 다시 만들었습니다: md ${d.markdown}개, PDF ${d.pdf}개${d.failed.length ? `, PDF 실패 ${d.failed.length}개` : ''} → ${driveRoot}`);
  }));

program.command('google')
  .description('구글 연결')
  .command('login')
  .description('구글 승인 (캘린더: 이 앱이 만든 캘린더만 + Gmail 읽기 전용)')
  .option('--json', 'JSON 출력')
  .action(run(async (opts: { json?: boolean }) => {
    await googleLogin(status);
    const id = await ensureCalendar();
    output(opts.json, { calendarId: id, gmail: hasGmailScope() }, d => `구글을 연결했습니다 (캘린더${d.gmail ? ' + Gmail 읽기' : ''}).`);
  }));

const mail = program.command('mail').description('학교 메일 (Dooray → Gmail 전달분, 읽기 전용)');

mail.command('sync')
  .description('Gmail에서 KAIST 메일을 가져와 저장하고 학사 일정 후보를 뽑음 (KLMS 접속 없음)')
  .option('--since <기간>', '이 기간 전부터 다시 확인 (예: 30d). 기본: 마지막으로 받은 메일 이후')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { since?: string; json?: boolean }) => {
    requireSynced();
    const r = await syncMail({ runId: lastSyncRun(), since: o.since ? nowSec() - parseDuration(o.since) : undefined, onStatus: status });
    const sem = JSON.parse(getMeta('semester')!) as { year: number };
    const c = await scanCandidates(lastSyncRun() ?? 0, sem.year, status);
    output(o.json, { ...r, candidates: c }, d => [
      `메일: 새로 ${d.newMails}통 (${d.from} 이후 KAIST 메일 ${d.fetched}통 확인) — 나에게 직접 ${d.direct}통, 과목 매핑 ${d.courseMatched}통`,
      `학사 일정 후보: 새로 ${d.candidates.newCandidates}건${d.candidates.newCandidates ? ' → kaist events candidates' : ''}`,
    ].join('\n'));
  }));

mail.command('list')
  .description('저장된 학교 메일 (본문 제외, 최신순)')
  .option('--since <기간>', '이 기간 안에 받은 것만 (예: 3d)', '7d')
  .option('--course <과목>', '특정 과목으로 매핑된 메일만')
  .option('--direct', '나에게 직접 온 메일만')
  .option('--academic', '과목 매핑됐거나 나에게 직접 온 메일만')
  .option('--limit <n>', '최대 개수', '50')
  .option('--json', 'JSON 출력')
  .action(run(async (o: { since: string; course?: string; direct?: boolean; academic?: boolean; limit: string; json?: boolean }) => {
    const list = listMails({ sinceSec: nowSec() - parseDuration(o.since), course: courseIds(o.course), direct: o.direct, academic: o.academic, limit: Number(o.limit) });
    output(o.json, { lastMailSyncKst: getMeta('mail_last_sync_at') ? formatKst(Math.floor(Date.parse(getMeta('mail_last_sync_at')!) / 1000)) : null, mails: list }, d => [
      `메일 ${d.mails.length}통 (마지막 메일 확인 ${d.lastMailSyncKst ?? '없음'})`,
      ...d.mails.map(m => `  ${m.receivedKst} ${m.direct ? '★' : ' '} ${(m.course ?? '').padEnd(13)} ${m.subject}  — ${m.fromName ?? m.from}${m.attachments.length ? ` (첨부 ${m.attachments.length})` : ''}  [${m.id}]`),
    ].join('\n'));
  }));

mail.command('show')
  .description('메일 본문 보기')
  .argument('<id>', '메일 id (mail list)')
  .option('--json', 'JSON 출력')
  .action(run(async (id: string, o: { json?: boolean }) => {
    const m = showMail(id);
    if (!m) throw new KaistError('NO_MAIL', `메일 ${id}을(를) 찾지 못했습니다.`);
    output(o.json, { mail: m }, d => [`${d.mail.subject}`, `보낸 사람: ${d.mail.fromName ?? ''} <${d.mail.from}>  받은 시각: ${d.mail.receivedKst}${d.mail.course ? `  과목: ${d.mail.course}` : ''}`,
      d.mail.attachments.length ? `첨부: ${d.mail.attachments.join(', ')}` : '', `Gmail: ${d.mail.gmailUrl}`, '', d.mail.body ?? ''].filter(x => x !== '').join('\n'));
  }));

mail.command('alias')
  .description('옛 과목 번호 등 별칭을 과목에 연결 (예: kaist mail alias ME361 ME.30061)')
  .argument('<별칭>').argument('<과목코드>')
  .option('--json', 'JSON 출력')
  .action(run(async (alias: string, code: string, o: { json?: boolean }) => {
    const cache = loadCourses();
    if (!cache?.courses.some(c => c.code === code)) throw new KaistError('NO_COURSE_MATCH', `이번 학기 과목 코드 "${code}"가 없습니다.`);
    const m = JSON.parse(getMeta('mail_course_aliases') ?? '{}') as Record<string, string>;
    m[alias] = code;
    setMeta('mail_course_aliases', JSON.stringify(m));
    const changed = rematchMailCourses();
    output(o.json, { aliases: m, rematched: changed }, d => `별칭 ${alias} → ${code} 저장. 저장된 메일 ${d.rematched}통의 과목 매핑이 바뀌었습니다.`);
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
