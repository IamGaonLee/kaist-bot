// 요약 md → PDF의 Electron 렌더러 (앱용). 포트는 src/files/pdf.ts, HTML·CSS는 pdf-html.ts.
// 숨긴 창에 printToPDF. 드라이브(G:)에는 staging에서 만든 뒤 복사한다.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { ensureDir, paths } from '../src/config.js';
import { mdToHtmlDoc } from '../src/files/pdf-html.js';
import type { PdfRenderer, PdfResult } from '../src/files/pdf.js';

async function renderPdfs(mdFiles: string[]): Promise<PdfResult> {
  const out: PdfResult = { written: [], failed: [] };
  if (mdFiles.length === 0) return out;
  const staging = path.join(paths.home, 'staging');
  ensureDir(staging);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    let i = 0;
    for (const md of mdFiles) {
      i++;
      const target = md.replace(/\.md$/i, '.pdf');
      const stagedHtml = path.join(staging, `${process.pid}-pdf-${i}.html`);
      try {
        fs.writeFileSync(stagedHtml, await mdToHtmlDoc(md));
        await win.loadFile(stagedHtml);
        const buf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
        const tmp = target + '.kaist-part';
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, target);
        out.written.push(target);
      } catch (e) {
        out.failed.push([target, e instanceof Error ? e.message : String(e)]);
      } finally {
        fs.rmSync(stagedHtml, { force: true });
      }
    }
  } finally {
    win.destroy();
  }
  return out;
}

export const electronPdfRenderer: PdfRenderer = { renderPdfs };
