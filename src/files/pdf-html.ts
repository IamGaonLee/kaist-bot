// md → 인쇄용 HTML 문서 (Playwright·Electron PDF 렌더러가 공유). CSS도 여기 한 곳.
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

export const PDF_CSS = `
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 10pt; line-height: 1.55; color: #1a1a1a; }
  h1 { font-size: 17pt; border-bottom: 2px solid #333; padding-bottom: 4px; margin: 0 0 8px; }
  h2 { font-size: 13pt; margin: 18px 0 6px; border-bottom: 1px solid #bbb; padding-bottom: 2px; }
  h3 { font-size: 11pt; margin: 12px 0 4px; }
  blockquote { margin: 6px 0; padding: 6px 10px; background: #f3f4f6; border-left: 3px solid #888; color: #333; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 9.5pt; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eef1f5; }
  tr { page-break-inside: avoid; }
  a { color: #1a56b0; text-decoration: none; }
  code { font-family: Consolas, monospace; font-size: 9pt; }
  ul { padding-left: 18px; margin: 4px 0; }
  img { max-width: 100%; }
`;

/** md 파일 → 완전한 HTML 문서. 상대 링크가 같은 폴더 기준으로 열리도록 base를 둔다. */
export async function mdToHtmlDoc(mdPath: string): Promise<string> {
  const body = await marked.parse(fs.readFileSync(mdPath, 'utf8'), { gfm: true });
  const base = `file:///${path.dirname(mdPath).replace(/\\/g, '/')}/`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${encodeURI(base)}"><style>${PDF_CSS}</style></head><body>${body}</body></html>`;
}
