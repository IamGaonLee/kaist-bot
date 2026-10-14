// 드라이브용 요약 파일: <학기>/_요약.md, <과목>/_과목정보.md, <과목>/과제/<이름>/설명.md
// 모바일의 Claude 앱이 읽고 논의하는 용도. 맨 위에 마지막 수집 시각을 적는다.
import fs from 'node:fs';
import path from 'node:path';
import TurndownService from 'turndown';
import { ensureDir } from '../config.js';
import { openDb } from '../store/db.js';
import { formatKst, nowSec } from '../util/time.js';
import { courseDir, semesterDir } from './layout.js';
import { taskFolder } from './download.js';
import { stripQuoted } from '../events/candidates.js';

/** 자동 알림 발신자 (드라이브 _학교메일에서 제외, 사용자 결정) */
const AUTOMATED = /no-?reply|notification|mailer-daemon|github\.com|donotreply|ubl_main/i;
const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');

/** 메일 하나를 md로: 제목·보낸 사람·첨부·Gmail 링크 + 본문 인용 블록 (인용된 이전 메일은 잘라냄) */
function mailBlock(m: Record<string, any>, max = 3000): string[] {
  let body = decode(stripQuoted(m.body_text ?? '')).replace(/\r/g, '').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length > max) body = body.slice(0, max) + ' …(줄임, 전체는 Gmail에서)';
  const atts = (JSON.parse(m.attachments_json ?? '[]') as { filename: string }[]).map(a => a.filename);
  return [
    `### ${m.subject || '(제목 없음)'} — ${formatKst(m.received_at)}`, '',
    `- 보낸 사람: ${m.from_name ?? ''} <${m.from_addr ?? ''}>`,
    ...(atts.length ? [`- 첨부: ${atts.join(', ')}`] : []),
    `- Gmail: https://mail.google.com/mail/u/0/#all/${m.id}`, '',
    ...(body ? body.split('\n').map(l => `> ${l}`) : ['> (본문 없음)']), '',
  ];
}

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
// 교수가 마감을 고칠 때 취소선을 쓴다 ("<del>October 19th</del> October 17th") → 지워진 값이 남아 보이지 않게 ~~ ~~로 보존
td.addRule('strikethrough', {
  filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName) || /line-through/.test((node as HTMLElement).getAttribute?.('style') ?? ''),
  replacement: content => (content.trim() ? `~~${content.trim()}~~` : ''),
});
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
        const adir = taskFolder(cdir, cid, t.cmid, t.name);
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
              A.push(f?.local_path && fs.existsSync(f.local_path) ? `- [${a.filename}](${encodeURIComponent(path.basename(f.local_path))})` : `- ${a.filename} (아직 받지 않음)`);
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
          L.push(f?.local_path && fs.existsSync(f.local_path) ? `- 자료: [${m.name}](${rel(cdir, f.local_path)})`
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
        L.push(f?.local_path && fs.existsSync(f.local_path) ? `- 첨부: [${a.filename}](${rel(cdir, f.local_path)})` : `- 첨부: ${a.filename} (아직 받지 않음)`);
      }
      if (atts.length) L.push('');
    }
    // 과목 메일 (S7): 최신순
    const cm = db.prepare(`select * from mails where course_id = ? order by received_at desc`).all(cid) as Record<string, any>[];
    L.push('## 메일', '');
    if (cm.length === 0) L.push('과목으로 연결된 메일 없음', '');
    for (const m of cm) L.push(...mailBlock(m));
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
  // 학사 일정 (S6): 시험·휴강·온라인·보강, 30일
  const today = formatKst(now).slice(0, 10);
  const until = formatKst(now + 30 * 86400).slice(0, 10);
  const sev = db.prepare(`select e.*, c.code, c.name cname from school_events e join courses c on c.id = e.course_id
    where c.active = 1 and e.status = 'active' and e.date >= ? and e.date <= ? order by e.date, e.start_at`).all(today, until) as Record<string, any>[];
  S.push('## 다가오는 시험·휴강 등 학사 일정 (30일)', '');
  if (sev.length === 0) S.push('없음', '');
  else {
    S.push('| 날짜 | 시간 | 과목 | 일정 | 장소 | 근거 |', '|---|---|---|---|---|---|');
    const KIND: Record<string, string> = { exam: '', no_class: '휴강', online: '온라인 수업', makeup: '보강' };
    for (const e of sev) {
      const time = e.start_at ? `${formatKst(e.start_at).slice(11)}${e.end_at ? `~${formatKst(e.end_at).slice(11)}` : ''}` : '미정/종일';
      const basis = e.source_type === 'file' ? '계획서 기준' : e.confidence === 'auto' ? '공지(자동)' : '확인됨';
      S.push(`| ${e.date} | ${time} | ${cell(e.cname)} | ${cell(e.kind === 'exam' ? e.title : KIND[e.kind] ?? e.kind)} | ${cell(e.location ?? '')} | ${basis} |`);
    }
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
  // 나에게 직접 온 메일(자동 알림 제외)과 학교 전체 메일 목록 → _학교메일.md. 요약에는 최근 7일 제목만
  const direct = (db.prepare(`select * from mails where direct = 1 order by received_at desc`).all() as Record<string, any>[]).filter(m => !AUTOMATED.test(m.from_addr ?? ''));
  const broadcast = db.prepare(`select * from mails where direct = 0 and course_id is null and received_at >= ? order by received_at desc`).all(now - 30 * 86400) as Record<string, any>[];
  if ((db.prepare('select count(*) n from mails').get() as { n: number }).n > 0) {
    const M = [`# ${semesterLabel} 학교 메일`, '', stamp(lastSync), '',
      '> Dooray에서 Gmail로 전달된 KAIST 메일 중 나에게 직접 온 메일(자동 알림 제외)입니다. 과목 메일은 각 과목의 _과목정보에 있습니다.', '', '## 나에게 온 메일', ''];
    if (direct.length === 0) M.push('없음', '');
    for (const m of direct) M.push(...mailBlock(m));
    M.push('## 학교·학과 전체 메일 (최근 30일, 제목만)', '');
    if (broadcast.length === 0) M.push('없음');
    for (const m of broadcast) M.push(`- ${formatKst(m.received_at)} ${m.from_name ?? m.from_addr ?? ''}: ${m.subject ?? ''}`);
    write(path.join(sdir, '_학교메일.md'), M.join('\n'));
    written.push(path.join(sdir, '_학교메일.md'));
    const recent = direct.filter(m => m.received_at >= now - 7 * 86400);
    S.push('## 최근 7일 나에게 온 메일', '');
    if (recent.length === 0) S.push('없음');
    for (const m of recent) S.push(`- ${formatKst(m.received_at)} ${m.from_name ?? m.from_addr ?? ''}: ${m.subject ?? ''}`);
    S.push('', `→ 전체: [_학교메일](${encodeURIComponent('_학교메일.md')})`, '');
  }
  S.push('', '## 과목', '');
  const courses = db.prepare('select * from courses where active = 1 order by code').all() as { id: number; code: string; name: string }[];
  for (const c of courses) S.push(`- [${c.code} ${c.name}](${rel(sdir, path.join(courseDir(root, semesterLabel, c), '_과목정보.md'))})`);
  write(path.join(sdir, '_요약.md'), S.join('\n'));
  written.push(path.join(sdir, '_요약.md'));
  return written;
}
