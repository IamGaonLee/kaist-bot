// 받은 파일의 본문 텍스트 추출 (pdf/pptx/docx/xlsx/doc/zip). 결과는 source_text에 캐시하고, 파일이 바뀌었을 때만 다시 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openDb } from '../store/db.js';
import { sha1 } from '../store/snapshots.js';

const MAX_PDF_PAGES = 80;

const stripXml = (x: string) => x.replace(/<\/(a:p|w:p|si|row)>/g, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function pdfText(buf: Buffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, MAX_PDF_PAGES); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
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

/** 옛 .doc: 바이너리에서 UTF-16LE 문자열 덩어리 (표 칸 구분은 · 로) */
function docText(buf: Buffer): string {
  const u16 = buf.toString('utf16le').replace(/[^가-힣 -~ㄱ-ㆎ\n]+/g, ' · ');
  return u16.replace(/( · )+/g, ' · ');
}

export async function extractText(file: string, buf: Buffer): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return pdfText(buf);
  if (['.pptx', '.docx', '.xlsx'].includes(ext)) return officeText(buf);
  if (ext === '.doc') return docText(buf);
  if (ext === '.zip') {
    const zip = await JSZip.loadAsync(buf);
    const parts: string[] = [];
    for (const [n, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.(pdf|pptx|docx|xlsx)$/i.test(n)) continue;
      parts.push(`[[${n}]]\n` + await extractText(n, Buffer.from(await f.async('uint8array'))).catch(() => ''));
    }
    return parts.join('\n');
  }
  return '';
}

export interface FileText { key: string; courseId: number; filename: string; localPath: string; text: string; downloadedAt: string | null }

/** 받은 파일 전부의 텍스트 (캐시 사용). 본문이 없는 파일(스캔 등)은 no_text로 기록하고 건너뛴다 */
export async function fileTexts(onStatus?: (m: string) => void): Promise<{ texts: FileText[]; noText: string[] }> {
  const db = openDb();
  const rows = db.prepare(`select f.key, f.course_id, f.filename, f.local_path, f.dl_etag, f.dl_length, f.downloaded_at
    from files f join courses c on c.id = f.course_id where c.active = 1 and f.status = 'ok' and f.local_path is not null`).all() as Record<string, any>[];
  const get = db.prepare('select * from source_text where key = ?');
  const put = db.prepare(`insert into source_text(key, extractor, text, text_hash, no_text, version, extracted_at) values(?, ?, ?, ?, ?, ?, ?)
    on conflict(key) do update set extractor=excluded.extractor, text=excluded.text, text_hash=excluded.text_hash, no_text=excluded.no_text, version=excluded.version, extracted_at=excluded.extracted_at`);
  const texts: FileText[] = [];
  const noText: string[] = [];
  let fresh = 0;
  for (const r of rows) {
    if (!fs.existsSync(r.local_path)) continue;
    const version = `${r.dl_etag ?? ''}:${r.dl_length ?? ''}`;
    let cached = get.get(`file:${r.key}`) as { text: string | null; no_text: number; version: string } | undefined;
    if (!cached || cached.version !== version) {
      fresh++;
      if (fresh % 10 === 1) onStatus?.(`파일 본문 읽는 중 (새 파일 ${fresh}개째)...`);
      let text = '';
      try { text = await extractText(r.local_path, fs.readFileSync(r.local_path)); } catch { text = ''; }
      const no = text.replace(/\s/g, '').length < 20 ? 1 : 0;
      put.run(`file:${r.key}`, path.extname(r.local_path).slice(1), no ? null : text, no ? null : sha1(text), no, version, new Date().toISOString());
      cached = { text: no ? null : text, no_text: no, version };
    }
    if (cached.no_text || !cached.text) { noText.push(r.filename); continue; }
    texts.push({ key: r.key, courseId: r.course_id, filename: r.filename, localPath: r.local_path, text: cached.text, downloadedAt: r.downloaded_at });
  }
  return { texts, noText };
}
