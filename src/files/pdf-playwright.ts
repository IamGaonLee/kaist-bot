// 요약 md → PDF의 Playwright 렌더러 (CLI용). 포트는 pdf.ts, HTML·CSS는 pdf-html.ts.
// Playwright Chromium으로 렌더링. 드라이브(G:)에는 staging에서 만든 뒤 복사한다.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir, paths } from '../config.js';
import { mdToHtmlDoc } from './pdf-html.js';
import type { PdfRenderer, PdfResult } from './pdf.js';

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
        await page.setContent(await mdToHtmlDoc(md), { waitUntil: 'load' });
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
