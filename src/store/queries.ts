// 조회 명령용 로컬 데이터 쿼리 (KLMS에 접속하지 않음)
import { formatKst } from '../util/time.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from '../config.js';
import { taskFolder } from '../files/download.js';
import { courseDir } from '../files/layout.js';
import { getMeta, openDb } from './db.js';

export interface TaskView {
  cmid: number;
  course: string;
  courseName: string;
  type: string;
  name: string;
  due: number | null;
  dueKst: string | null;
  dueSource: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  submission: string | null;
  submissionText: string | null;
  grading: string | null;
  removed: boolean;
  url: string;
  /** 마감까지 남은 시간(시간 단위, 지났으면 음수) */
  hoursLeft: number | null;
  /** 드라이브의 과제 폴더와 설명 파일 (과제를 같이 풀 때 읽을 곳) */
  folder: string | null;
  descriptionFile: string | null;
  attachments: { filename: string; localPath: string | null }[];
}

/** 과제 폴더 경로 계산에 필요한 값 */
function driveContext(): { root: string; semester: string } | null {
  const sem = getMeta('semester');
  if (!sem) return null;
  return { root: loadSettings().driveRoot, semester: (JSON.parse(sem) as { label: string }).label };
}

export function listTasks(opts: { now: number; withinSec?: number; all?: boolean; course?: number[] }): TaskView[] {
  const rows = openDb().prepare(`
    select t.*, c.code, c.name as course_name, m.removed_at, m.url
    from tasks t join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid
    where c.active = 1 order by t.due is null, t.due`).all() as Record<string, any>[];
  return rows
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => {
      if (opts.all) return true;
      if (r.needs_review) return true;
      if (r.due === null) return false;
      if (r.due < opts.now - 86400) return false; // 하루 넘게 지난 것은 기본 목록에서 제외
      return opts.withinSec === undefined || r.due <= opts.now + opts.withinSec;
    })
    .map(r => ({
      cmid: r.cmid,
      course: r.code,
      courseName: r.course_name,
      type: r.modname,
      name: r.name,
      due: r.due,
      dueKst: r.due === null ? null : formatKst(r.due),
      dueSource: r.due_source,
      needsReview: !!r.needs_review,
      reviewReason: r.review_reason,
      submission: r.submission_code,
      submissionText: r.submission_text,
      grading: r.grading_code,
      removed: !!r.removed_at,
      url: r.url ?? `https://klms.kaist.ac.kr/mod/${r.modname}/view.php?id=${r.cmid}`,
      ...taskFiles(r, opts.now),
    }));
}

function taskFiles(r: Record<string, any>, now: number): Pick<TaskView, 'hoursLeft' | 'folder' | 'descriptionFile' | 'attachments'> {
  const hoursLeft = r.due === null ? null : Math.round((r.due - now) / 360) / 10;
  const ctx = driveContext();
  if (r.modname !== 'assign' || !ctx) return { hoursLeft, folder: null, descriptionFile: null, attachments: [] };
  const folder = taskFolder(courseDir(ctx.root, ctx.semester, { code: r.code, name: r.course_name }), r.course_id, r.cmid, r.name);
  const desc = path.join(folder, '설명.md');
  const files = openDb().prepare(`select filename, local_path from files where source = 'assign' and ref = ?`).all(r.cmid) as { filename: string; local_path: string | null }[];
  return {
    hoursLeft,
    folder: fs.existsSync(folder) ? folder : null,
    descriptionFile: fs.existsSync(desc) ? desc : null,
    attachments: files.map(f => ({ filename: f.filename, localPath: f.local_path && fs.existsSync(f.local_path) ? f.local_path : null })),
  };
}

export interface NoticeView {
  bwid: number;
  course: string;
  board: string;
  title: string;
  author: string | null;
  postedAt: number | null;
  postedKst: string | null;
  attachments: { filename: string; url: string }[];
  url: string;
  bodyText?: string;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function listNotices(opts: { sinceSec?: number; course?: number[]; kind?: string; body?: boolean; limit?: number }): NoticeView[] {
  const rows = openDb().prepare(`
    select n.*, c.code from notices n join courses c on c.id = n.course_id
    where c.active = 1 order by coalesce(n.posted_at, n.list_date) desc`).all() as Record<string, any>[];
  return rows
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => !opts.kind || opts.kind === 'all' || r.board_kind === opts.kind)
    .filter(r => opts.sinceSec === undefined || (r.posted_at ?? r.list_date ?? 0) >= opts.sinceSec)
    .slice(0, opts.limit ?? Infinity)
    .map(r => ({
      bwid: r.bwid,
      course: r.code,
      board: r.board_kind,
      title: r.title,
      author: r.author,
      postedAt: r.posted_at ?? r.list_date,
      postedKst: (r.posted_at ?? r.list_date) ? formatKst(r.posted_at ?? r.list_date) : null,
      attachments: JSON.parse(r.attachments_json ?? '[]'),
      url: `https://klms.kaist.ac.kr/mod/courseboard/article.php?id=${r.board_cmid}&bwid=${r.bwid}`,
      ...(opts.body ? { bodyText: htmlToText(r.body_html ?? '') } : {}),
    }));
}

export interface FileView {
  key: string;
  course: string;
  source: string;
  filename: string;
  status: string;
  statusLabel: string;
  localPath: string | null;
  length: number | null;
  downloadedAt: string | null;
  note: string | null;
}

const FILE_STATUS: Record<string, string> = { ok: '받음', pending: '대기', viewer_only: '뷰어 전용', missing: '없음', error: '오류' };

export function listFiles(opts: { course?: number[]; onlyNew?: boolean }): FileView[] {
  const db = openDb();
  const lastRun = (db.prepare(`select max(id) r from sync_runs where finished_at is not null and status <> 'aborted'`).get() as { r: number | null }).r;
  const rows = db.prepare(`select f.*, c.code from files f join courses c on c.id = f.course_id where c.active = 1 order by c.code, f.source, f.section, f.filename`).all() as Record<string, any>[];
  return rows
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => !opts.onlyNew || (lastRun !== null && r.downloaded_run === lastRun))
    .map(r => ({
      key: r.key, course: r.code, source: r.source, filename: r.filename, status: r.status, statusLabel: FILE_STATUS[r.status] ?? r.status,
      localPath: r.local_path, length: r.length, downloadedAt: r.downloaded_at, note: r.note,
    }));
}

export interface VideoView { cmid: number; course: string; section: string | null; name: string; url: string }

export function listVideos(opts: { course?: number[] }): VideoView[] {
  const rows = openDb().prepare(`
    select m.cmid, m.name, m.url, m.course_id, c.code, s.name as section_name
    from modules m join courses c on c.id = m.course_id
    left join sections s on s.course_id = m.course_id and s.number = m.section
    where m.modname = 'lti' and m.removed_at is null and c.active = 1
    order by c.code, m.section, m.cmid`).all() as Record<string, any>[];
  return rows
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .map(r => ({ cmid: r.cmid, course: r.code, section: r.section_name, name: r.name, url: r.url ?? `https://klms.kaist.ac.kr/mod/lti/view.php?id=${r.cmid}` }));
}

export interface ChangeView { runId: number; finishedAt: string; finishedKst: string; course: string | null; kind: string; change: string; title: string; detail: string | null }

/** 최근 sync들의 변경 내역 (KLMS 접속 없이 브리핑용) */
export function listChanges(opts: { runs: number; course?: number[] }): { runs: { id: number; finishedAt: string; finishedKst: string; status: string }[]; changes: ChangeView[] } {
  const db = openDb();
  const runs = (db.prepare(`select id, finished_at, status from sync_runs where finished_at is not null and status <> 'aborted' order by id desc limit ?`).all(opts.runs) as { id: number; finished_at: string; status: string }[])
    .map(r => ({ id: r.id, finishedAt: r.finished_at, finishedKst: formatKst(Math.floor(Date.parse(r.finished_at) / 1000)), status: r.status }));
  if (runs.length === 0) return { runs, changes: [] };
  const ids = runs.map(r => r.id);
  const rows = db.prepare(`select ch.*, c.code from changes ch left join courses c on c.id = ch.course_id where ch.run_id in (${ids.map(() => '?').join(',')}) order by ch.run_id desc`).all(...ids) as Record<string, any>[];
  const fin = new Map(runs.map(r => [r.id, r]));
  return {
    runs,
    changes: rows
      .filter(r => !opts.course || opts.course.includes(r.course_id))
      // 활동 내용 해시만 바뀐 것(상태 문구 변화 등)은 잡음이라 뺀다. 파일 받음/새 버전은 남긴다
      .filter(r => !(r.kind === 'module' && r.change === 'changed' && !String(r.detail ?? '').startsWith('파일') && !String(r.detail ?? '').startsWith('받지 않음')))
      .map(r => ({ runId: r.run_id, finishedAt: fin.get(r.run_id)!.finishedAt, finishedKst: fin.get(r.run_id)!.finishedKst, course: r.code ?? null, kind: r.kind, change: r.change, title: r.title, detail: r.detail })),
  };
}
