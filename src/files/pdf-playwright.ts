// 요약 md → PDF의 Playwright 렌더러 (CLI용). 포트는 pdf.ts.
// Playwright Chromium으로 렌더링. 드라이브(G:)에는 staging에서 만든 뒤 복사한다.
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';
import { ensureDir, paths } from '../config.js';
import type { PdfRenderer, PdfResult } from './pdf.js';

const CSS = `
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

async function renderPdfs(mdFiles: string[]): Promise<PdfResult> {
  const out: PdfResult = { written: [], failed: [] };
  if (mdFiles.length === 0) return out;
  const staging = path.join(paths.home, 'staging');
  ensureDir(staging);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let i = 0;
    for (const md of mdFiles) {
      i++;
      const target = md.replace(/\.md$/i, '.pdf');
      const staged = path.join(staging, `${process.pid}-pdf-${i}.pdf`);
      try {
        const body = await marked.parse(fs.readFileSync(md, 'utf8'), { gfm: true });
        // 상대 링크가 PDF 안에서도 같은 폴더 기준으로 열리도록 base를 둔다
        const base = `file:///${path.dirname(md).replace(/\\/g, '/')}/`;
        await page.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${encodeURI(base)}"><style>${CSS}</style></head><body>${body}</body></html>`, { waitUntil: 'load' });
        await page.pdf({ path: staged, format: 'A4', printBackground: true, preferCSSPageSize: true });
        const tmp = target + '.kaist-part';
        fs.copyFileSync(staged, tmp);
        fs.renameSync(tmp, target);
        out.written.push(target);
      } catch (e) {
        out.failed.push([target, e instanceof Error ? e.message : String(e)]);
      } finally {
        fs.rmSync(staged, { force: true });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

export const playwrightPdfRenderer: PdfRenderer = { renderPdfs };
