// 드라이브용 요약 파일: <학기>/_요약.md, <과목>/_과목정보.md, <과목>/과제/<이름>/설명.md
// 모바일의 Claude 앱이 읽고 논의하는 용도. 맨 위에 마지막 수집 시각을 적는다.
import fs from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';
import { ensureDir } from '../config.js';
import { openDb } from '../store/db.js';
import { formatKst, nowSec } from '../util/time.js';
import { assignmentDir, courseDir, semesterDir } from './layout.js';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
const toMd = (html: string | null) => (html ? td.turndown(html).replace(/\n{3,}/g, '\n\n').trim() : '');
const rel = (from: string, to: string) => path.relative(from, to).split(path.sep).map(encodeURIComponent).join('/');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const SUBMISSION: Record<string, string> = { submitted: '제출함', new: '미제출', draft: '임시 저장', reopened: '재제출 가능', noattempt: '미제출' };
const submissionLabel = (code: string | null, text: string | null) => (code && SUBMISSION[code]) ?? text ?? '확인 안 됨';

function stamp(lastSync: string): string {
  return `> 마지막 수집: ${formatKst(Math.floor(Date.parse(lastSync) / 1000))} (KST). PC에서 \`kaist sync\`를 실행해야 갱신됩니다. 이후 바뀐 내용은 반영되지 않았을 수 있습니다.`;
}

function write(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = file + '.kaist-part';
  fs.writeFileSync(tmp, content.endsWith('\n') ? content : content + '\n');
  fs.renameSync(tmp, file);
}

interface TaskRow { cmid: number; course_id: number; modname: string; name: string; due: number | null; due_source: string | null; needs_review: number; review_reason: string | null;
  submission_code: string | null; submission_text: string | null; intro_html: string | null; attachments_json: string | null; url: string | null; code: string; cname: string }

export function writeMarkdown(root: string, semesterLabel: string, courseIds: number[], lastSync: string): string[] {
  const db = openDb();
  const written: string[] = [];
  const now = nowSec();
  const sdir = semesterDir(root, semesterLabel);
  const fileRows = db.prepare(`select * from files where course_id = ?`);

  for (const cid of courseIds) {
    const c = db.prepare('select * from courses where id = ?').get(cid) as { id: number; code: string; name: string; url: string } | undefined;
    if (!c) continue;
    const cdir = courseDir(root, semesterLabel, c);
    const files = new Map((fileRows.all(cid) as { key: string; local_path: string | null; status: string; note: string | null }[]).map(f => [f.key, f]));
    const tasks = db.prepare(`select t.*, m.url, c.code, c.name cname from tasks t join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid
      where t.course_id = ? and (m.removed_at is null) order by t.due is null, t.due`).all(cid) as unknown as TaskRow[];
    const L: string[] = [`# ${c.code} ${c.name}`, '', stamp(lastSync), '', `KLMS: ${c.url}`, ''];

    // 과제
    L.push('## 과제와 마감', '');
    if (tasks.length === 0) L.push('과제 없음', '');
    else {
      L.push('| 마감 (KST) | 과제 | 제출 | 비고 |', '|---|---|---|---|');
      for (const t of tasks) {
        const adir = assignmentDir(cdir, t.name);
        const note = [t.needs_review ? `⚠ 확인 필요: ${t.review_reason}` : '', t.due_source === 'html' ? '마감은 과목 페이지 기준' : '', t.modname === 'quiz' ? '퀴즈' : ''].filter(Boolean).join('; ');
        const nameCell = t.modname === 'assign' ? `[${cell(t.name)}](${rel(cdir, path.join(adir, '설명.md'))})` : cell(t.name);
        L.push(`| ${t.due ? formatKst(t.due) : '-'} | ${nameCell} | ${t.modname === 'assign' ? submissionLabel(t.submission_code, t.submission_text) : '-'} | ${cell(note)} |`);
        if (t.modname === 'assign') {
          const atts = JSON.parse(t.attachments_json ?? '[]') as { filename: string }[];
          const A = [`# ${t.name}`, '', stamp(lastSync), '', `- 과목: ${c.code} ${c.name}`,
            `- 마감: ${t.due ? `${formatKst(t.due)} (KST)` : '없음'}${t.needs_review ? ` ⚠ 확인 필요: ${t.review_reason}` : ''}`,
            `- 제출 상태: ${submissionLabel(t.submission_code, t.submission_text)}`, `- KLMS: ${t.url ?? ''}`, '', '## 설명', '', toMd(t.intro_html) || '(설명 없음)', ''];
          if (atts.length) {
            A.push('## 첨부', '');
            for (const a of atts) {
              const f = files.get(`a:${t.cmid}:${a.filename}`);
              A.push(f?.status === 'ok' && f.local_path ? `- [${a.filename}](${encodeURIComponent(path.basename(f.local_path))})` : `- ${a.filename} (아직 받지 않음)`);
            }
          }
          write(path.join(adir, '설명.md'), A.join('\n'));
          written.push(path.join(adir, '설명.md'));
        }
      }
      L.push('');
    }

    // 주차별 자료
    L.push('## 주차별 구성', '');
    const sections = db.prepare('select * from sections where course_id = ? order by number').all(cid) as { number: number; name: string; date_range: string | null; summary: string | null }[];
    const mods = db.prepare(`select * from modules where course_id = ? and removed_at is null order by section, cmid`).all(cid) as Record<string, any>[];
    for (const s of sections) {
      const ms = mods.filter(m => m.section === s.number && m.modname !== 'courseboard');
      if (ms.length === 0 && !s.summary) continue;
      L.push(`### ${s.name}${s.date_range ? ` (${s.date_range})` : ''}`, '');
      if (s.summary) L.push(s.summary, '');
      for (const m of ms) {
        if (m.modname === 'resource') {
          const f = files.get(`r:${m.cmid}`);
          L.push(f?.status === 'ok' && f.local_path ? `- 자료: [${m.name}](${rel(cdir, f.local_path)})`
            : f?.status === 'viewer_only' ? `- 자료: ${m.name} (뷰어 전용, KLMS에서 보기: ${m.url ?? ''})` : `- 자료: ${m.name} (아직 받지 않음)`);
        } else if (m.modname === 'lti') L.push(`- 영상: ${m.name} — ${m.url}`);
        else if (m.modname === 'url') L.push(`- 링크: ${m.name} — ${m.url}`);
        else if (m.modname === 'assign' || m.modname === 'quiz') L.push(`- ${m.modname === 'quiz' ? '퀴즈' : '과제'}: ${m.name}${m.end_dt_text ? ` (${m.end_dt_text})` : ''}`);
        else if (m.modname === 'label') { if (m.label_text) L.push(`- 안내: ${m.label_text}`); }
        else L.push(`- (${m.modname}) ${m.name} — ${m.url ?? ''}`);
      }
      L.push('');
    }

    // 공지·게시판
    const notices = db.prepare(`select * from notices where course_id = ? order by coalesce(posted_at, list_date) desc`).all(cid) as Record<string, any>[];
    L.push('## 공지·게시판', '');
    if (notices.length === 0) L.push('글 없음', '');
    for (const n of notices) {
      const when = n.posted_at ?? n.list_date;
      L.push(`### [${n.board_kind === 'notice' ? '공지' : n.board_kind === 'qna' ? 'Q&A' : '게시판'}] ${n.title} — ${when ? formatKst(when) : ''}`, '');
      L.push(toMd(n.body_html) || '(본문 없음)', '');
      const atts = JSON.parse(n.attachments_json ?? '[]') as { filename: string }[];
      for (const a of atts) {
        const f = files.get(`n:${n.bwid}:${a.filename}`);
        L.push(f?.status === 'ok' && f.local_path ? `- 첨부: [${a.filename}](${rel(cdir, f.local_path)})` : `- 첨부: ${a.filename} (아직 받지 않음)`);
      }
      if (atts.length) L.push('');
    }
    write(path.join(cdir, '_과목정보.md'), L.join('\n'));
    written.push(path.join(cdir, '_과목정보.md'));
  }

  // 학기 요약
  const all = db.prepare(`select t.*, m.url, c.code, c.name cname from tasks t join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid
    where c.active = 1 and m.removed_at is null order by t.due`).all() as unknown as TaskRow[];
  const S: string[] = [`# ${semesterLabel} 요약`, '', stamp(lastSync), ''];
  const upcoming = all.filter(t => t.due !== null && t.due >= now && t.due <= now + 14 * 86400);
  S.push('## 다가오는 마감 (14일)', '');
  if (upcoming.length === 0) S.push('없음', '');
  else {
    S.push('| 마감 (KST) | 과목 | 과제 | 제출 |', '|---|---|---|---|');
    for (const t of upcoming) S.push(`| ${formatKst(t.due!)} | ${cell(t.code)} | ${cell(t.name)}${t.needs_review ? ' ⚠' : ''} | ${t.modname === 'assign' ? submissionLabel(t.submission_code, t.submission_text) : '퀴즈'} |`);
    S.push('');
  }
  const review = all.filter(t => t.needs_review);
  if (review.length) {
    S.push('## ⚠ 마감 확인 필요 (KLMS에서 직접 확인)', '');
    for (const t of review) S.push(`- ${t.code} ${t.name}: ${t.review_reason}`);
    S.push('');
  }
  const recent = db.prepare(`select n.*, c.code from notices n join courses c on c.id = n.course_id where c.active = 1 and coalesce(n.posted_at, n.list_date) >= ? order by coalesce(n.posted_at, n.list_date) desc`).all(now - 7 * 86400) as Record<string, any>[];
  S.push('## 최근 7일 공지·게시글', '');
  if (recent.length === 0) S.push('없음', '');
  for (const n of recent) S.push(`- ${formatKst(n.posted_at ?? n.list_date)} ${n.code}: ${n.title}`);
  if (recent.length) S.push('');
  const newFiles = db.prepare(`select f.*, c.code from files f join courses c on c.id = f.course_id where f.status = 'ok' and f.downloaded_at >= ? order by f.downloaded_at desc`).all(new Date((now - 7 * 86400) * 1000).toISOString()) as Record<string, any>[];
  S.push('## 최근 7일 새로 받은 자료', '');
  if (newFiles.length === 0) S.push('없음', '');
  for (const f of newFiles.slice(0, 50)) S.push(`- ${f.code}: [${f.filename}](${rel(sdir, f.local_path)})`);
  if (newFiles.length > 50) S.push(`- … 외 ${newFiles.length - 50}개`);
  S.push('', '## 과목', '');
  const courses = db.prepare('select * from courses where active = 1 order by code').all() as { id: number; code: string; name: string }[];
  for (const c of courses) S.push(`- [${c.code} ${c.name}](${rel(sdir, path.join(courseDir(root, semesterLabel, c), '_과목정보.md'))})`);
  write(path.join(sdir, '_요약.md'), S.join('\n'));
  written.push(path.join(sdir, '_요약.md'));
  return written;
}
