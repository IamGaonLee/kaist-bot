// 학사 일정 후보 추출 (S6 설계 1절): 키워드와 날짜 힌트가 ±150자 안에 함께 있는 구간만. 해석은 에이전트가 한다.
import { openDb } from '../store/db.js';
import { sha1 } from '../store/snapshots.js';
import { fileTexts } from './extract.js';

export type Kind = 'exam' | 'no_class' | 'online' | 'makeup';

const KIND_PATTERNS: [Kind, RegExp][] = [
  ['no_class', /휴강|no\s+class|class(es)?\s+(is\s+|are\s+|will\s+be\s+)?cancel+ed|수업\s*(이\s*)?없/i],
  ['makeup', /보강|make[\s-]?up\s*(class|session|lecture)?/i],
  ['online', /온라인\s*(수업|강의)?|비대면|\bzoom\b|\bonline\b|녹화\s*강의|실시간\s*강의/i],
  ['exam', /중간\s*고사|기말\s*고사|중간\s*시험|기말\s*시험|시험|퀴즈|mid[\s-]?term|final\s*exam|\bfinal\b|\bexams?\b(?!-\s*ple)|\bquiz(zes)?\b/i],
];
const KEY_RE = new RegExp(KIND_PATTERNS.map(([, r]) => r.source).join('|'), 'gi');
const DATE_RE = /(\d{1,2}\s*[/.]\s*\d{1,2}(?![\d.])|\d{1,2}\s*월\s*\d{1,2}\s*일|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\((월|화|수|목|금|토|일)\)|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|[월화수목금토일]요일|다음\s*주|이번\s*주|next\s+week|this\s+week|tomorrow|내일|모레)/i;
const WINDOW = 150;
const CONTEXT = 400;

/** 파일에서는 점(.)으로 쓴 날짜를 인정하지 않는다 (절 번호 "6.6" 등 오탐) */
const DATE_RE_FILE = new RegExp(DATE_RE.source.replace(String.raw`\d{1,2}\s*[/.]\s*\d{1,2}(?![\d.])`, String.raw`\d{1,2}\s*\/\s*\d{1,2}(?![\d/])`), 'i');

/** 일정 정보가 있을 법한 파일 (강의계획서·일정표·1주차 소개). 강의 슬라이드·문제지는 읽지 않는다 */
export const SCHEDULE_FILE = /(syll|계획서|schedule|일정|introduction|orientation|오리엔테이션|week\s*0?1[^0-9]|ho-01|l01_|공지|announcement)/i;

export interface Snippet { snippet: string; context: string; kindHint: Kind; keywords: string[]; dateHints: string[]; past: boolean }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 텍스트에서 후보 구간 찾기 (순수 함수). semesterYear와 다른 연도만 적힌 구간은 past */
export function findSnippets(text: string, semesterYear: number, opts: { file?: boolean } = {}): Snippet[] {
  const t = norm(text);
  const dateRe = opts.file ? DATE_RE_FILE : DATE_RE;
  const out: Snippet[] = [];
  let lastEnd = -1;
  for (const m of t.matchAll(KEY_RE)) {
    const i = m.index!;
    if (i < lastEnd) continue;
    const s = Math.max(0, i - WINDOW);
    const e = Math.min(t.length, i + m[0].length + WINDOW);
    const snippet = t.slice(s, e);
    const dates = [...snippet.matchAll(new RegExp(dateRe.source, 'gi'))].map(x => x[0]);
    if (dates.length === 0) continue;
    const keywords = [...snippet.matchAll(new RegExp(KEY_RE.source, 'gi'))].map(x => x[0]);
    const kindHint = (KIND_PATTERNS.find(([, r]) => r.test(m[0]))?.[0]) ?? 'exam';
    const years = [...snippet.matchAll(/\b(20\d\d)\b/g)].map(x => Number(x[1]));
    const past = years.length > 0 && !years.includes(semesterYear);
    out.push({ snippet, context: t.slice(Math.max(0, i - CONTEXT), Math.min(t.length, i + m[0].length + CONTEXT)), kindHint, keywords: [...new Set(keywords)], dateHints: [...new Set(dates)], past });
    lastEnd = e;
  }
  return out;
}

/** 파일 이름으로 보아 지난 학기 자료(기출·해설 등)인지 */
export function isPastFile(name: string, semesterYear: number): boolean {
  if (/(기출|past|previous|solution|해설|answer)/i.test(name)) return true;
  const years = [...name.matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map(x => Number(x[1]));
  return years.length > 0 && !years.includes(semesterYear);
}

interface Source { type: 'notice' | 'section' | 'assignment' | 'file'; id: string; courseId: number; title: string; url: string | null; postedAt: number | null; text: string; pastFile?: boolean }

const htmlText = (h: string | null) => (h ?? '').replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

export interface ScanResult { newCandidates: number; pastSkipped: number; noTextFiles: string[] }

/** 모든 출처를 훑어 후보를 DB에 쌓는다. 이미 본 구간(snippet_hash)은 다시 넣지 않는다 */
export async function scanCandidates(runId: number, semesterYear: number, onStatus?: (m: string) => void): Promise<ScanResult> {
  const db = openDb();
  const sources: Source[] = [];
  for (const n of db.prepare(`select n.*, c.active from notices n join courses c on c.id = n.course_id where c.active = 1`).all() as Record<string, any>[]) {
    sources.push({ type: 'notice', id: String(n.bwid), courseId: n.course_id, title: n.title, url: `https://klms.kaist.ac.kr/mod/courseboard/article.php?id=${n.board_cmid}&bwid=${n.bwid}`, postedAt: n.posted_at ?? n.list_date, text: `${n.title}\n${htmlText(n.body_html)}` });
  }
  for (const s of db.prepare(`select s.*, c.url curl from sections s join courses c on c.id = s.course_id where c.active = 1 and s.summary is not null and s.summary <> ''`).all() as Record<string, any>[]) {
    sources.push({ type: 'section', id: `${s.course_id}:${s.number}`, courseId: s.course_id, title: `${s.name}${s.date_range ? ` (${s.date_range})` : ''} 안내`, url: s.curl, postedAt: null, text: s.summary });
  }
  for (const t of db.prepare(`select t.*, m.url from tasks t join courses c on c.id = t.course_id left join modules m on m.cmid = t.cmid where c.active = 1 and t.intro_html is not null`).all() as Record<string, any>[]) {
    sources.push({ type: 'assignment', id: String(t.cmid), courseId: t.course_id, title: `과제 설명: ${t.name}`, url: t.url, postedAt: null, text: htmlText(t.intro_html) });
  }
  const { texts, noText } = await fileTexts(onStatus);
  for (const f of texts) {
    if (!SCHEDULE_FILE.test(f.filename)) continue;
    // 압축 파일은 안의 파일별로 나눠 이름으로 기출 여부를 본다
    const parts = f.text.includes('[[') ? f.text.split(/\[\[([^\]]+)\]\]\n/).slice(1) : [f.filename, f.text];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const name = parts[i]!;
      sources.push({ type: 'file', id: f.key + (name === f.filename ? '' : `#${name}`), courseId: f.courseId, title: `파일: ${name === f.filename ? f.filename : `${f.filename} 안의 ${name}`}`, url: null,
        postedAt: f.downloadedAt ? Math.floor(Date.parse(f.downloadedAt) / 1000) : null, text: parts[i + 1]!, pastFile: isPastFile(name, semesterYear) || isPastFile(f.filename, semesterYear) });
    }
  }

  const ins = db.prepare(`insert into event_candidates(source_type, source_id, course_id, snippet, context, snippet_hash, kind_hint, keywords, date_hints,
      source_title, source_url, source_posted_at, first_seen_sync_id, status, status_reason)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(snippet_hash) do nothing`);
  const res: ScanResult = { newCandidates: 0, pastSkipped: 0, noTextFiles: noText };
  for (const src of sources) {
    for (const sn of findSnippets(src.text, semesterYear, { file: src.type === 'file' })) {
      const past = sn.past || !!src.pastFile;
      const r = ins.run(src.type, src.id, src.courseId, sn.snippet, sn.context, sha1(src.type, src.id, sn.snippet), sn.kindHint, sn.keywords.join(','), sn.dateHints.join(','),
        src.title, src.url, src.postedAt, runId, past ? 'past' : 'new', past ? (src.pastFile ? '지난 학기 자료로 보이는 파일' : '다른 연도만 적힌 구간') : null);
      if (r.changes > 0) { if (past) res.pastSkipped++; else res.newCandidates++; }
    }
  }
  return res;
}

export interface CandidateView {
  id: number; course: string | null; courseName: string | null; sourceType: string; sourceTitle: string | null; sourceUrl: string | null;
  sourcePostedKst: string | null; kindHint: string; snippet: string; dateHints: string[]; status: string; firstSeenSyncId: number | null;
}

export function listCandidates(opts: { status?: string[]; course?: number[]; kind?: string; limit?: number }): CandidateView[] {
  const rows = openDb().prepare(`select e.*, c.code, c.name cname from event_candidates e left join courses c on c.id = e.course_id
    order by case e.source_type when 'notice' then 0 when 'section' then 1 when 'file' then 2 else 3 end, e.source_posted_at desc, e.id`).all() as Record<string, any>[];
  const kst = (s: number | null) => (s ? new Date((s + 9 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ') : null);
  return rows
    .filter(r => !opts.status || opts.status.includes(r.status))
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => !opts.kind || r.kind_hint === opts.kind)
    .slice(0, opts.limit ?? Infinity)
    .map(r => ({
      id: r.id, course: r.code ?? null, courseName: r.cname ?? null, sourceType: r.source_type, sourceTitle: r.source_title, sourceUrl: r.source_url,
      sourcePostedKst: kst(r.source_posted_at), kindHint: r.kind_hint, snippet: r.snippet, dateHints: String(r.date_hints ?? '').split(',').filter(Boolean),
      status: r.status, firstSeenSyncId: r.first_seen_sync_id,
    }));
}

export function setCandidateStatus(id: number, status: string, reason: string | null, linkedEventId: number | null = null): void {
  openDb().prepare(`update event_candidates set status = ?, status_reason = ?, linked_event_id = coalesce(?, linked_event_id) where id = ?`).run(status, reason, linkedEventId, id);
}

/** 후보 규칙을 바꾼 뒤 다시 뽑기: 아직 처리하지 않은 후보(new, past)를 지우고 로컬 데이터로 다시 훑는다 (KLMS 접속 없음) */
export async function rescanCandidates(runId: number, semesterYear: number, onStatus?: (m: string) => void): Promise<ScanResult & { removed: number }> {
  const removed = openDb().prepare(`delete from event_candidates where status in ('new', 'past')`).run().changes;
  const r = await scanCandidates(runId, semesterYear, onStatus);
  return { ...r, removed: Number(removed) };
}
