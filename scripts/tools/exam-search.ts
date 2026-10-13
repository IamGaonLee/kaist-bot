// 시험 일정 단서 찾기: 로컬 DB(공지·과제·주차 안내) + 드라이브에 받은 파일(pdf/pptx/docx/xlsx/doc/zip) 본문 검색.
// 결과는 %LOCALAPPDATA%\kaist-cli\exam-search.md (저장소 밖)에만 쓴다. KLMS에 접속하지 않는다.
// 사용법: npx tsx scripts/tools/exam-search.ts
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const home = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');
const db = new DatabaseSync(path.join(home, 'kaist.db'));

const STRONG = /(중간\s*고사|기말\s*고사|중간\s*시험|기말\s*시험|mid[\s-]?term|final\s*exam|final\s*test|기말\s*평가|중간\s*평가)/i;
const WEAK = /(시험|exam|quiz|퀴즈|\btest\b|final)/i;
const DATE = /(\d{1,2}\s*[/.]\s*\d{1,2}(?!\d)|\d{1,2}\s*월\s*\d{1,2}\s*일|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\d{4}[-./]\d{1,2}[-./]\d{1,2}|week\s*\d{1,2}|\d{1,2}\s*주\s*차|\(\s*(월|화|수|목|금|토|일)\s*\))/i;

interface Hit { course: string; source: string; snippet: string; strong: boolean; dated: boolean }
const hits: Hit[] = [];
const problems: string[] = [];

function scan(course: string, source: string, text: string): void {
  const t = text.replace(/\s+/g, ' ');
  const re = new RegExp(`${STRONG.source}|${WEAK.source}`, 'gi');
  let m: RegExpExecArray | null;
  let lastEnd = -1;
  while ((m = re.exec(t))) {
    if (m.index < lastEnd) continue;
    const s = Math.max(0, m.index - 160);
    const e = Math.min(t.length, m.index + m[0].length + 200);
    const snippet = t.slice(s, e).trim();
    const strong = STRONG.test(m[0]);
    const dated = DATE.test(snippet);
    if (strong || dated) hits.push({ course, source, snippet, strong, dated });
    lastEnd = e;
  }
}

const stripXml = (x: string) => x.replace(/<\/(a:p|w:p|si|row)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function pdfText(buf: Buffer, maxPages = 80): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    out.push(c.items.map(it => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.destroy();
  return out.join('\n');
}

async function officeText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /^(ppt\/slides\/slide\d+\.xml|word\/document\.xml|xl\/sharedStrings\.xml|ppt\/notesSlides\/.*\.xml)$/.test(n));
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts: string[] = [];
  for (const n of names) parts.push(stripXml(await zip.files[n]!.async('string')));
  return parts.join('\n');
}

/** 옛 .doc: 바이너리에서 UTF-16LE·8비트 문자열 덩어리 추출 */
function docText(buf: Buffer): string {
  const u16 = buf.toString('utf16le').match(/[\uAC00-\uD7A3\u0020-\u007E\u3131-\u318E]{4,}/g) ?? [];
  const ascii = buf.toString('latin1').match(/[\x20-\x7E]{6,}/g) ?? [];
  return [...u16, ...ascii].join('\n');
}

async function fileText(file: string, buf: Buffer): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return pdfText(buf);
  if (['.pptx', '.docx', '.xlsx'].includes(ext)) return officeText(buf);
  if (ext === '.doc') return docText(buf);
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(buf);
    const parts: string[] = [`[압축 파일 목록] ${Object.keys(zip.files).join(' | ')}`];
    for (const [n, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.(pdf|pptx|docx|xlsx)$/i.test(n)) continue;
      try { parts.push(`[${n}] ` + await fileText(n, Buffer.from(await f.async('uint8array')))); }
      catch (e) { problems.push(`${file} 안의 ${n}: ${(e as Error).message}`); }
    }
    return parts.join('\n');
  }
  return '';
}

// 1) 로컬 DB
const courses = db.prepare('select id, code, name from courses where active = 1').all() as { id: number; code: string; name: string }[];
const label = (id: number) => { const c = courses.find(x => x.id === id); return c ? `${c.code} ${c.name}` : String(id); };
for (const n of db.prepare('select course_id, title, posted_at, body_html from notices').all() as any[]) {
  scan(label(n.course_id), `게시판: ${n.title}`, `${n.title}\n${(n.body_html ?? '').replace(/<[^>]+>/g, ' ')}`);
}
for (const t of db.prepare('select course_id, name, intro_html from tasks').all() as any[]) {
  scan(label(t.course_id), `과제 설명: ${t.name}`, `${t.name}\n${(t.intro_html ?? '').replace(/<[^>]+>/g, ' ')}`);
}
for (const s of db.prepare('select course_id, name, date_range, summary from sections').all() as any[]) {
  if (s.summary) scan(label(s.course_id), `주차 안내: ${s.name} (${s.date_range ?? ''})`, s.summary);
}
for (const m of db.prepare(`select course_id, modname, name, label_text, end_dt_text from modules where removed_at is null`).all() as any[]) {
  scan(label(m.course_id), `활동 이름(${m.modname})`, `${m.name} ${m.label_text ?? ''} ${m.end_dt_text ?? ''}`);
}

// 2) 받은 파일
const files = db.prepare(`select course_id, local_path from files where status = 'ok' and local_path is not null`).all() as { course_id: number; local_path: string }[];
let done = 0;
for (const f of files) {
  done++;
  if (done % 15 === 0) console.error(`파일 ${done}/${files.length}...`);
  try {
    const buf = fs.readFileSync(f.local_path);
    const text = await fileText(f.local_path, buf);
    if (!text.trim()) problems.push(`${path.basename(f.local_path)}: 본문을 뽑지 못함 (스캔 이미지일 수 있음)`);
    scan(label(f.course_id), `파일: ${path.relative(path.join('G:\\내 드라이브\\KAIST\\2026-가을'), f.local_path)}`, text);
  } catch (e) {
    problems.push(`${path.basename(f.local_path)}: ${(e as Error).message}`);
  }
}

// 결과
const byCourse = new Map<string, Hit[]>();
for (const h of hits) byCourse.set(h.course, [...(byCourse.get(h.course) ?? []), h]);
const L = ['# 시험 일정 단서 (자동 검색 결과, 원문 확인 필요)', '', `생성: ${new Date().toISOString()}`, ''];
for (const [course, hs] of [...byCourse.entries()].sort()) {
  L.push(`## ${course}`, '');
  const sorted = hs.sort((a, b) => Number(b.strong) - Number(a.strong) || Number(b.dated) - Number(a.dated));
  for (const h of sorted.slice(0, 40)) L.push(`- ${h.strong ? '**[시험]**' : '[관련]'}${h.dated ? ' [날짜]' : ''} _${h.source}_`, `  > ${h.snippet}`, '');
}
L.push('## 처리하지 못한 파일', '', ...(problems.length ? problems.map(p => `- ${p}`) : ['없음']));
const out = path.join(home, 'exam-search.md');
fs.writeFileSync(out, L.join('\n'));
console.log(`단서 ${hits.length}개 (시험 키워드 ${hits.filter(h => h.strong).length}개), 처리 못한 파일 ${problems.length}개 → ${out}`);
for (const [c, hs] of byCourse) console.log(`  ${c}: ${hs.filter(h => h.strong).length} / ${hs.length}`);
