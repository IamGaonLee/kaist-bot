// kaist sync: 과목 구성, 과제, 공지(S2) + 파일 다운로드와 드라이브 요약(S3). 캘린더 반영은 S4
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from '../config.js';
import { BlockedError, KaistError, NotAvailableError, SessionExpiredError } from '../errors.js';
import { collectCandidates, executeDownloads, planFiles, recordPlan } from '../files/download.js';
import { writeMarkdown } from '../files/markdown.js';
import { renderPdfs } from '../files/pdf.js';
import { pushDeadlines, type PushResult } from '../cal/push.js';
import { hasGoogleToken } from '../google/oauth.js';
import { parseAssignPage } from '../klms/adapters/assign-page.js';
import { parseCoursePage, type ParsedModule } from '../klms/adapters/course-page.js';
import { parseArticle, parseBoardList } from '../klms/adapters/courseboard.js';
import { fetchCalendarEvents, type CalendarEvent } from '../klms/calendar.js';
import { fetchCurrentCourses, type Course } from '../klms/courses.js';
import { ensureSession, type KlmsSession } from '../klms/session.js';
import { saveCourses } from '../store/courses-cache.js';
import { getMeta, openDb, setMeta, tx } from '../store/db.js';
import { saveSnapshot, sha1 } from '../store/snapshots.js';
import { acquireSyncLock } from '../store/lock.js';
import { nowSec } from '../util/time.js';
import { resolveDeadline, type Deadline } from './deadlines.js';
import { checkCoursePage, HANDLED, InvariantError } from './invariants.js';

const MAX_BOARD_PAGES = 30;

export interface Change {
  courseId: number;
  kind: 'module' | 'task' | 'notice';
  ref: number;
  change: 'new' | 'changed' | 'removed' | 'due_changed' | 'status_changed' | 'needs_review';
  title: string;
  detail?: string;
}

export interface CourseOutcome {
  id: number;
  code: string;
  name: string;
  ok: boolean;
  error?: { code: string; message: string };
  stats?: Record<string, number>;
}

export interface FileStage {
  root: string;
  awaitingConfirm: boolean;
  planned: { download: number; update: number; unavailable: number; same: number; bytes: number };
  downloaded: number;
  updated: number;
  failed: { file: string; error: string }[];
  unavailable: { file: string; reason: string }[];
  markdownWritten: number;
  pdfWritten: number;
}

export interface SyncResult {
  runId: number;
  files?: FileStage;
  calendar?: PushResult;
  startedAt: string;
  finishedAt: string;
  status: 'ok' | 'partial' | 'aborted';
  semester: string;
  courses: CourseOutcome[];
  changes: Change[];
  unprocessed: Record<string, number>;
  warnings: string[];
  requests: number;
  abortReason?: { code: string; message: string };
}

export interface SyncOptions {
  course?: string;
  interactive: boolean;
  /** false면 파일 다운로드와 드라이브 md 생성을 건너뜀 */
  files?: boolean;
  /** 첫 전체 다운로드를 승인 */
  confirmDownload?: boolean;
  /** false면 구글 캘린더 반영 생략 */
  calendar?: boolean;
  onStatus?: (m: string) => void;
}

const iso = () => new Date().toISOString();
const moduleHash = (m: ParsedModule) => sha1(m.name, m.url, m.file?.url, m.file?.filename, m.endDtText, m.boardKind, m.text);

export function matchCourse(c: Course, q: string): boolean {
  const s = q.trim().toLowerCase();
  return String(c.id) === s || c.code.toLowerCase() === s || c.code.toLowerCase().startsWith(s) || c.name.toLowerCase().includes(s);
}

export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const release = acquireSyncLock();
  try {
    return await runSyncLocked(opts);
  } finally {
    release();
  }
}

async function runSyncLocked(opts: SyncOptions): Promise<SyncResult> {
  const log = opts.onStatus ?? (() => {});
  const db = openDb();
  const startedAt = iso();
  const runId = Number(db.prepare('insert into sync_runs(started_at, status) values(?, ?)').run(startedAt, 'running').lastInsertRowid);
  const result: SyncResult = {
    runId, startedAt, finishedAt: startedAt, status: 'ok', semester: '', courses: [], changes: [], unprocessed: {}, warnings: [], requests: 0,
  };
  let session: KlmsSession | null = null;

  try {
    session = await ensureSession({ interactive: opts.interactive, onStatus: log });
    const { semester, courses } = await fetchCurrentCourses(session);
    saveCourses({ fetchedAt: iso(), semester, courses });
    result.semester = semester.label;

    const targets = opts.course ? courses.filter(c => matchCourse(c, opts.course!)) : courses;
    if (targets.length === 0) throw new KaistError('NO_COURSE_MATCH', `"${opts.course}"에 해당하는 이번 학기 과목이 없습니다.`);

    // 마감: 사이트 전체 월별 캘린더 (학기 시작 ~ 종료+1개월)
    const from = Math.min(...targets.map(c => c.startdate));
    const to = Math.max(...targets.map(c => c.enddate)) + 31 * 86400;
    log(`캘린더 조회 중...`);
    const events = await fetchCalendarEvents(session, from, to);
    const eventsByCmid = new Map<number, CalendarEvent[]>();
    for (const e of events) if (e.instance !== null) eventsByCmid.set(e.instance, [...(eventsByCmid.get(e.instance) ?? []), e]);

    for (const course of targets) {
      log(`${course.code} ${course.name} 수집 중...`);
      try {
        const stats = await syncCourse(session, course, eventsByCmid, result);
        result.courses.push({ id: course.id, code: course.code, name: course.name, ok: true, stats });
        db.prepare('update courses set last_synced_at = ? where id = ?').run(iso(), course.id);
      } catch (e) {
        // 세션 만료·차단은 전체 중단, 파싱·불변식 실패는 그 과목만 중단
        if (e instanceof SessionExpiredError || e instanceof BlockedError) throw e;
        const err = e instanceof KaistError ? e : new KaistError('INTERNAL', e instanceof Error ? e.message : String(e));
        result.courses.push({ id: course.id, code: course.code, name: course.name, ok: false, error: { code: err.code, message: err.message } });
        result.status = 'partial';
      }
    }

    // 이벤트 instance가 cmid라는 KLMS 특이사항 검사: 과제/퀴즈 이벤트의 instance가 우리가 아는 cmid여야 한다
    const known = new Set((db.prepare('select cmid from modules').all() as { cmid: number }[]).map(r => r.cmid));
    const targetIds = new Set(targets.map(c => c.id));
    const strange = events.filter(e => (e.modulename === 'assign' || e.modulename === 'quiz') && e.courseId !== null && targetIds.has(e.courseId) && e.instance !== null && !known.has(e.instance));
    if (strange.length) {
      result.warnings.push(`캘린더 이벤트 ${strange.length}개의 instance가 알려진 cmid가 아닙니다. KLMS가 instance 의미를 바꿨을 수 있습니다 (마감 매핑 확인 필요).`);
    }

    // 파일 다운로드와 드라이브 요약 (S3)
    const okIds = result.courses.filter(c => c.ok).map(c => c.id);
    if (opts.files !== false && okIds.length) result.files = await fileStage(session, semester.label, okIds, runId, opts, result);

    // 구글 캘린더 반영 (S4). 실패해도 수집 결과는 유지하고 경고로 알린다
    if (opts.calendar !== false) {
      if (!hasGoogleToken()) result.warnings.push('구글 캘린더가 연결되지 않아 마감 반영을 건너뛰었습니다 (`kaist cal login`).');
      else {
        log('구글 캘린더 반영 중...');
        try { result.calendar = await pushDeadlines(new Date().toISOString()); }
        catch (e) { result.warnings.push(`구글 캘린더 반영 실패: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
  } catch (e) {
    result.status = 'aborted';
    const err = e instanceof KaistError ? e : new KaistError('INTERNAL', e instanceof Error ? e.message : String(e));
    result.abortReason = { code: err.code, message: err.message };
  } finally {
    session?.http.persist();
    result.requests = session?.http.requestCount ?? 0;
    result.finishedAt = iso();
    const summary = { ...result, changes: result.changes.length };
    db.prepare('update sync_runs set finished_at = ?, status = ?, summary_json = ? where id = ?').run(result.finishedAt, result.status, JSON.stringify(summary), runId);
    const ins = db.prepare('insert into changes(run_id, course_id, kind, ref, change, title, detail) values(?, ?, ?, ?, ?, ?, ?)');
    tx(() => { for (const c of result.changes) ins.run(runId, c.courseId, c.kind, c.ref, c.change, c.title, c.detail ?? null); });
    if (result.status !== 'aborted') setMeta('last_sync_at', result.finishedAt);
  }
  return result;
}

async function fileStage(session: KlmsSession, semesterLabel: string, courseIds: number[], runId: number, opts: SyncOptions, result: SyncResult): Promise<FileStage | undefined> {
  const log = opts.onStatus ?? (() => {});
  const { driveRoot } = loadSettings();
  // 드라이브 루트의 상위(예: G:\내 드라이브)가 없으면 동기화 폴더가 아니므로 쓰지 않는다
  if (!fs.existsSync(path.dirname(driveRoot))) {
    result.warnings.push(`드라이브 폴더 ${path.dirname(driveRoot)}가 없어 파일 다운로드와 요약 md를 건너뛰었습니다. Google Drive 실행 여부나 config.json의 driveRoot를 확인해 주세요.`);
    return undefined;
  }
  const db = openDb();
  log('받을 파일 확인 중...');
  const cands = collectCandidates(driveRoot, semesterLabel, courseIds);
  const plan = await planFiles(session, cands);
  recordPlan(plan);
  const stage: FileStage = {
    root: driveRoot, awaitingConfirm: false,
    planned: {
      download: plan.filter(p => p.action === 'download').length,
      update: plan.filter(p => p.action === 'update').length,
      unavailable: plan.filter(p => p.action === 'unavailable').length,
      same: plan.filter(p => p.action === 'skip').length,
      bytes: plan.filter(p => p.action === 'download' || p.action === 'update').reduce((s, p) => s + (p.head?.length ?? 0), 0),
    },
    downloaded: 0, updated: 0, failed: [],
    unavailable: plan.filter(p => p.action === 'unavailable').map(p => ({ file: p.cand.filename, reason: p.reason })),
    markdownWritten: 0,
    pdfWritten: 0,
  };
  // "받지 않음"은 상태가 바뀌었을 때만 변경으로 기록 (매 sync 반복 방지)
  for (const p of plan.filter(x => x.action === 'unavailable' && x.prevStatus !== x.head?.status)) {
    result.changes.push({ courseId: p.cand.courseId, kind: 'module', ref: p.cand.ref, change: 'changed', title: p.cand.filename, detail: `받지 않음: ${p.reason}` });
  }

  // 첫 전체 다운로드는 예상 개수·용량을 보여주고 승인을 받는다
  const anyDownloaded = (db.prepare(`select count(*) n from files where status = 'ok' and local_path is not null`).get() as { n: number }).n > 0;
  if (opts.confirmDownload) setMeta('download_confirmed', '1');
  if (!anyDownloaded && getMeta('download_confirmed') !== '1') {
    stage.awaitingConfirm = true;
  } else {
    const outcomes = await executeDownloads(session, plan, runId, log);
    stage.downloaded = outcomes.filter(o => o.ok && o.action === 'download').length;
    stage.updated = outcomes.filter(o => o.ok && o.action === 'update').length;
    stage.failed = outcomes.filter(o => !o.ok).map(o => ({ file: path.basename(o.target), error: o.error ?? '' }));
    for (const o of outcomes.filter(x => x.ok)) {
      const cand = plan.find(p => p.cand.key === o.key)!.cand;
      result.changes.push({ courseId: cand.courseId, kind: 'module', ref: cand.ref, change: o.action === 'update' ? 'changed' : 'new', title: cand.filename, detail: o.action === 'update' ? '파일 새 버전' : '파일 받음' });
    }
  }
  log('드라이브 요약 파일 작성 중...');
  const mdFiles = writeMarkdown(driveRoot, semesterLabel, courseIds, new Date().toISOString());
  stage.markdownWritten = mdFiles.length;
  // 사람이 볼 PDF: 학기 요약과 과목 정보만 (과제 설명.md는 제외). 실패해도 수집 결과는 유지
  log('요약 PDF 만드는 중...');
  try {
    const pdf = await renderPdfs(mdFiles.filter(f => /_(요약|과목정보)\.md$/.test(f)));
    stage.pdfWritten = pdf.written.length;
    for (const [file, err] of pdf.failed) result.warnings.push(`PDF 생성 실패: ${path.basename(file)} — ${err}`);
  } catch (e) {
    result.warnings.push(`요약 PDF를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return stage;
}

async function syncCourse(session: KlmsSession, course: Course, eventsByCmid: Map<number, CalendarEvent[]>, result: SyncResult): Promise<Record<string, number>> {
  const db = openDb();
  const now = iso();
  const where = `${course.code} 과목 페이지`;
  const html = await session.http.html(`/course/view.php?id=${course.id}&section=0`);
  saveSnapshot(`course-${course.id}`, html);
  const page = parseCoursePage(html, where);

  // 불변식 3: 테마/리비전 변화 감지
  const themeKey = `${page.theme}@${page.themerev}`;
  const prevTheme = getMeta('theme');
  if (prevTheme && prevTheme !== themeKey && !result.warnings.some(w => w.startsWith('KLMS 변경 감지'))) {
    result.warnings.push(`KLMS 변경 감지: 테마 ${prevTheme} → ${themeKey}. 불변식은 모두 다시 검사했습니다. 결과를 KLMS 화면과 한 번 대조해 주세요.`);
  }
  setMeta('theme', themeKey);

  // 불변식 1·2
  const upd = await session.ajax<{ instances?: { contextlevel: string; id: number; updates: unknown[] }[] }>('core_course_get_updates_since', { courseid: course.id, since: 0 });
  const updSig = new Map<number, string>();
  for (const i of upd?.instances ?? []) if (i.contextlevel === 'module') updSig.set(i.id, sha1(JSON.stringify(i.updates)));
  const inv = checkCoursePage(page, new Set(updSig.keys()));
  if (!inv.ok) throw new InvariantError(`${course.code} ${course.name}`, inv.failures);

  for (const m of page.modules) if (!HANDLED.has(m.modname)) result.unprocessed[m.modname] = (result.unprocessed[m.modname] ?? 0) + 1;

  const push = (c: Omit<Change, 'courseId'>) => result.changes.push({ courseId: course.id, ...c });

  // 섹션과 활동
  const prevMods = new Map((db.prepare('select cmid, content_hash, updates_sig, removed_at from modules where course_id = ?').all(course.id) as { cmid: number; content_hash: string; updates_sig: string | null; removed_at: string | null }[]).map(r => [r.cmid, r]));
  tx(() => {
    db.prepare('delete from sections where course_id = ?').run(course.id);
    const insSec = db.prepare('insert into sections(course_id, number, name, date_range, summary) values(?, ?, ?, ?, ?)');
    for (const s of page.sections) insSec.run(course.id, s.number, s.name, s.dateRange, s.summaryText);

    const upMod = db.prepare(`insert into modules(cmid, course_id, section, modname, name, url, file_url, file_name, end_dt_text, status_text, board_kind, label_text, updates_sig, content_hash, first_seen_at, last_seen_at, removed_at)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      on conflict(cmid) do update set course_id=excluded.course_id, section=excluded.section, modname=excluded.modname, name=excluded.name, url=excluded.url,
        file_url=excluded.file_url, file_name=excluded.file_name, end_dt_text=excluded.end_dt_text, status_text=excluded.status_text, board_kind=excluded.board_kind,
        label_text=excluded.label_text, updates_sig=excluded.updates_sig, content_hash=excluded.content_hash, last_seen_at=excluded.last_seen_at, removed_at=null`);
    for (const m of page.modules) {
      const hash = moduleHash(m);
      const sig = updSig.get(m.cmid) ?? null;
      const prev = prevMods.get(m.cmid);
      if (!prev || prev.removed_at) push({ kind: 'module', ref: m.cmid, change: 'new', title: m.name || m.modname, detail: m.modname });
      else if (prev.content_hash !== hash) push({ kind: 'module', ref: m.cmid, change: 'changed', title: m.name || m.modname, detail: m.modname });
      upMod.run(m.cmid, course.id, m.section, m.modname, m.name, m.url, m.file?.url ?? null, m.file?.filename ?? null, m.endDtText, m.status, m.boardKind, m.text, sig, hash, now, now);
    }
    const present = new Set(page.modules.map(m => m.cmid));
    const rm = db.prepare('update modules set removed_at = ? where cmid = ?');
    for (const [cmid, prev] of prevMods) {
      if (!present.has(cmid) && !prev.removed_at) {
        rm.run(now, cmid);
        const name = (db.prepare('select name, modname from modules where cmid = ?').get(cmid) as { name: string; modname: string });
        push({ kind: 'module', ref: cmid, change: 'removed', title: name.name || name.modname, detail: name.modname });
      }
    }
  });

  // 과제·퀴즈
  let pagesFetched = 0;
  const t = nowSec();
  for (const m of page.modules.filter(x => x.modname === 'assign' || x.modname === 'quiz')) {
    const prev = db.prepare('select * from tasks where cmid = ?').get(m.cmid) as Record<string, unknown> | undefined;
    const prevDue = (prev?.due as number | null) ?? null;
    let parsed: ReturnType<typeof parseAssignPage> | null = null;
    const sig = updSig.get(m.cmid) ?? null;
    // 링크가 없는 활동(조건부 공개 등)은 페이지를 열지 않는다
    if (m.modname === 'assign' && m.url) {
      // 변경 신호는 과제 페이지를 성공적으로 처리했을 때의 서명(page_sig)과 비교한다 — 실패해도 다음에 다시 시도
      // 페이지를 열면 KLMS에 조회 기록이 남으므로 횟수를 줄인다 (사용자 결정):
      // 새 과제, KLMS가 변경을 알린 과제, 마감 전이고 아직 제출하지 않은 과제만
      const open = prev?.submission_code !== 'submitted' && (prevDue === null || prevDue >= t);
      const needPage = !prev || !prev.page_fetched_at || prev.page_sig !== sig || open;
      if (needPage) {
        try {
          const ah = await session.http.html(`/mod/assign/view.php?id=${m.cmid}`);
          saveSnapshot(`assign-${m.cmid}`, ah);
          parsed = parseAssignPage(ah, `${course.code} 과제 "${m.name}" (cmid ${m.cmid})`);
          pagesFetched++;
        } catch (e) {
          if (!(e instanceof NotAvailableError)) throw e;
          result.warnings.push(`${course.code} 과제 "${m.name}": 페이지를 열 수 없어 건너뜀 (조건부 공개일 수 있음)`);
        }
      }
    }
    const pageDue = parsed ? parsed.due : ((prev?.page_due as number | null) ?? null);
    const evs = eventsByCmid.get(m.cmid) ?? [];
    let dl = resolveDeadline({ cmid: m.cmid, modname: m.modname, htmlEnd: m.endDt?.end ?? null, pageDue, events: evs, myUserId: page.userId });
    // 마감을 하나로 정하지 못했으면(needs_review) 이전 값을 지우지 않고 유지한다 — 캘린더 일정이 "사라짐"으로 바뀌지 않게
    if (dl.due === null && dl.needsReview && prevDue !== null) dl = { ...dl, due: prevDue, source: (prev?.due_source as Deadline['source']) ?? 'calendar' };
    const openAt = m.modname === 'quiz' ? (evs.find(e => e.eventtype === 'open')?.timestart ?? m.endDt?.start ?? null) : (m.endDt?.start ?? null);
    // 설명 영역(#intro)이 없으면 설명·첨부는 기존 값을 유지한다
    const hasIntro = !!parsed && (parsed.introHtml !== null || parsed.attachments.length > 0);
    const introHash = hasIntro ? sha1(parsed!.introHtml, JSON.stringify(parsed!.attachments)) : ((prev?.intro_hash as string | null) ?? null);

    if (!prev) push({ kind: 'task', ref: m.cmid, change: 'new', title: m.name, detail: m.modname });
    else {
      if (prevDue !== dl.due) push({ kind: 'task', ref: m.cmid, change: 'due_changed', title: m.name, detail: `${prevDue ?? '-'} → ${dl.due ?? '-'}` });
      if (parsed && prev.submission_code !== null && prev.submission_code !== parsed.submissionCode) push({ kind: 'task', ref: m.cmid, change: 'status_changed', title: m.name, detail: `${prev.submission_code ?? '-'} → ${parsed.submissionCode ?? '-'}` });
      if (parsed && prev.intro_hash && prev.intro_hash !== introHash) push({ kind: 'task', ref: m.cmid, change: 'changed', title: m.name, detail: '설명/첨부 변경' });
    }
    if (dl.needsReview && !(prev?.needs_review)) push({ kind: 'task', ref: m.cmid, change: 'needs_review', title: m.name, detail: dl.reason ?? undefined });

    db.prepare(`insert into tasks(cmid, course_id, modname, name, due, due_source, html_end, page_due, open_at, needs_review, review_reason, calendar_event_id,
        submission_code, submission_text, grading_code, grading_text, last_modified_text, intro_html, intro_hash, attachments_json, page_fetched_at, updated_at, page_sig)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(cmid) do update set course_id=excluded.course_id, modname=excluded.modname, name=excluded.name, due=excluded.due, due_source=excluded.due_source,
        html_end=excluded.html_end, page_due=excluded.page_due, open_at=excluded.open_at, needs_review=excluded.needs_review, review_reason=excluded.review_reason,
        calendar_event_id=excluded.calendar_event_id,
        submission_code=coalesce(excluded.submission_code, tasks.submission_code), submission_text=coalesce(excluded.submission_text, tasks.submission_text),
        grading_code=coalesce(excluded.grading_code, tasks.grading_code), grading_text=coalesce(excluded.grading_text, tasks.grading_text),
        last_modified_text=coalesce(excluded.last_modified_text, tasks.last_modified_text), intro_html=coalesce(excluded.intro_html, tasks.intro_html),
        intro_hash=coalesce(excluded.intro_hash, tasks.intro_hash), attachments_json=coalesce(excluded.attachments_json, tasks.attachments_json),
        page_fetched_at=coalesce(excluded.page_fetched_at, tasks.page_fetched_at), updated_at=excluded.updated_at,
        page_sig=case when excluded.page_fetched_at is not null then excluded.page_sig else tasks.page_sig end`)
      .run(m.cmid, course.id, m.modname, m.name, dl.due, dl.source, m.endDt?.end ?? null, pageDue, openAt, dl.needsReview ? 1 : 0, dl.reason, dl.calendarEventId,
        parsed?.submissionCode ?? null, parsed?.submissionText ?? null, parsed?.gradingCode ?? null, parsed?.gradingText ?? null, parsed?.lastModifiedText ?? null,
        hasIntro ? parsed!.introHtml : null, hasIntro ? introHash : null, hasIntro ? JSON.stringify(parsed!.attachments) : null, parsed ? now : null, now, parsed ? sig : null);
  }

  // 게시판: 목록 1쪽부터, 모르는 글만 본문을 받는다. 1쪽이 전부 새 글이면 다음 쪽으로
  let listPages = 0;
  let articles = 0;
  for (const b of page.modules.filter(x => x.modname === 'courseboard')) {
    const knownBefore = new Set((db.prepare('select bwid from notices where board_cmid = ?').all(b.cmid) as { bwid: number }[]).map(r => r.bwid));
    const known = new Set(knownBefore);
    const seenThisRun = new Set<number>();
    let pageNo = 1;
    for (;;) {
      let lh: string;
      try {
        lh = await session.http.html(`/mod/courseboard/view.php?id=${b.cmid}${pageNo > 1 ? `&page=${pageNo}` : ''}`);
      } catch (e) {
        if (!(e instanceof NotAvailableError)) throw e;
        result.warnings.push(`${course.code} 게시판 "${b.name}": 열 수 없어 건너뜀`);
        break;
      }
      if (pageNo === 1) saveSnapshot(`board-${b.cmid}`, lh);
      const list = parseBoardList(lh, `${course.code} 게시판 "${b.name}" ${pageNo}쪽`);
      listPages++;
      // 고정 글처럼 여러 쪽에 반복되는 글은 "다음 쪽으로 갈지" 판단에서 뺀다
      const unseen = list.posts.filter(p => !seenThisRun.has(p.bwid));
      for (const p of list.posts) seenThisRun.add(p.bwid);
      const fresh = unseen.filter(p => !known.has(p.bwid));
      for (const p of fresh) {
        let ah: string;
        try {
          ah = await session.http.html(p.url);
        } catch (e) {
          if (!(e instanceof NotAvailableError)) throw e;
          result.warnings.push(`${course.code} 게시판 글 "${p.title}": 열 수 없어 건너뜀 (비밀글일 수 있음)`);
          continue;
        }
        const art = parseArticle(ah, `${course.code} 게시판 글 (bwid ${p.bwid})`);
        articles++;
        db.prepare(`insert into notices(bwid, board_cmid, course_id, board_kind, title, author, list_date, posted_at, posted_text, body_html, body_hash, has_attachment, attachments_json, first_seen_at, updated_at)
          values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(bwid) do update set title=excluded.title, body_html=excluded.body_html, body_hash=excluded.body_hash, attachments_json=excluded.attachments_json, updated_at=excluded.updated_at`)
          .run(p.bwid, b.cmid, course.id, b.boardKind ?? 'board', art.title, art.author, p.listDate, art.postedAt, art.postedText, art.bodyHtml, sha1(art.bodyHtml),
            p.hasAttachment ? 1 : 0, JSON.stringify(art.attachments), now, now);
        known.add(p.bwid);
        push({ kind: 'notice', ref: p.bwid, change: 'new', title: art.title, detail: b.boardKind ?? 'board' });
      }
      // 이 쪽의 마지막 글(고정 글 제외, 가장 오래된 글)이 새 글이면 다음 쪽에도 새 글이 있을 수 있다
      const last = unseen.at(-1);
      const mayContinue = !!last && !knownBefore.has(last.bwid);
      if (!mayContinue || pageNo >= list.maxPage || pageNo >= MAX_BOARD_PAGES) break;
      pageNo++;
    }
    const count = (db.prepare('select count(*) n from notices where board_cmid = ?').get(b.cmid) as { n: number }).n;
    db.prepare(`insert into boards(cmid, course_id, kind, name, last_checked_at, post_count) values(?, ?, ?, ?, ?, ?)
      on conflict(cmid) do update set kind=excluded.kind, name=excluded.name, last_checked_at=excluded.last_checked_at, post_count=excluded.post_count`)
      .run(b.cmid, course.id, b.boardKind ?? 'board', b.name, now, count);
  }

  return { ...inv.stats, assignPages: pagesFetched, boardListPages: listPages, newArticles: articles, firstSync: prevMods.size === 0 ? 1 : 0 };
}
