// 조회 명령용 로컬 데이터 쿼리 (KLMS에 접속하지 않음)
import { formatKst } from '../util/time.js';
import { openDb } from './db.js';

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
    }));
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
