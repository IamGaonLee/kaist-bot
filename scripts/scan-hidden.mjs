// 받은 파일에서 사람 눈에 안 보이는 내용을 찾는다 (사용자 지시 2026-11-09).
//   - 비가시 유니코드(제로폭·태그 문자·변형 선택자·BOM·소프트하이픈 등)
//   - PDF: 보이지 않는 텍스트(렌더 모드 3·7, 흰색에 가까운 채움색, 1pt 미만 글꼴), 0에 가까운 크기로 그린 이미지
//   - docx/pptx: 숨김 서식(w:vanish, 흰 글자, 1pt 글꼴), 숨긴 슬라이드, 빈 투명 그림
//   - AI 지시문처럼 보이는 문장 (프롬프트 주입 의심)
// 사용: node scripts/scan-hidden.mjs [--all | --since <ISO시각>] [--json]
//   기본은 마지막 sync 회차에 받은 파일만. DB는 읽기만 하고 파일은 바꾸지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { openDb } = await import(pathToFileURL(path.join(root, 'dist/store/db.js')).href);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const JSZip = require('jszip');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

// ---- 공통 검사 ----
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯ㅤ︀-️﻿ﾠ￹-￻]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;
const INJECTION = /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)|disregard\s+(the\s+)?(previous|above)|you\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|chatbot|language\s+model)|system\s+prompt|do\s+not\s+(tell|reveal|mention)\s+(this\s+)?(to\s+)?the\s+user|as\s+an\s+ai|print\s+the\s+(hidden|secret)|이전\s*(지시|명령)\s*(를|을)?\s*(무시|잊)|AI\s*(에게|야|는)\s*.{0,10}(지시|명령|해라|하라)|시스템\s*프롬프트|사용자에게\s*(말하지|알리지)\s*마/i;

const codePointName = (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

function scanText(text, where) {
  const out = [];
  const found = new Map();
  for (const m of text.matchAll(INVISIBLE)) {
    const k = codePointName(m[0]);
    found.set(k, (found.get(k) ?? 0) + 1);
  }
  // BOM 1개가 맨 앞에만 있는 것은 정상
  if (found.get('U+FEFF') === 1 && text.charCodeAt(0) === 0xFEFF) found.delete('U+FEFF');
  // 소프트하이픈·결합 문자 소수는 워드프로세서가 넣는 경우가 많아 5개 이상만 보고
  for (const [k, n] of found) {
    // 소프트하이픈·변형 선택자(FE00~FE0F)는 워드프로세서·수식 글꼴이 흔히 넣는다 → 많을 때만
    const minor = k === 'U+00AD' || /^U\+FE0[0-9A-F]$/.test(k);
    if (minor && n < 50) continue;
    out.push({ kind: 'invisible-unicode', where, detail: `${k} ×${n}` });
  }
  const inj = text.match(INJECTION);
  if (inj) out.push({ kind: 'instruction-like-text', where, detail: `"${text.slice(Math.max(0, inj.index - 40), inj.index + inj[0].length + 40).replace(/\s+/g, ' ')}"` });
  return out;
}

// ---- PDF ----
function isNearWhite(rgb) { return rgb && rgb.length === 3 && rgb.every(v => v >= 0.93); }

async function scanPdf(file) {
  const findings = [];
  const buf = fs.readFileSync(file);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  let fullText = ''; let whiteOnColored = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const pageText = tc.items.map(i => i.str ?? '').join(' ');
    fullText += pageText + '\n';
    // 1pt 미만 글꼴로 찍힌 글자
    const tiny = tc.items.filter(i => i.str && i.str.trim() && Math.hypot(i.transform[0], i.transform[1]) < 1);
    if (tiny.length) findings.push({ kind: 'pdf-tiny-text', where: `p.${p}`, detail: `${tiny.length}개 항목 (예: "${tiny.slice(0, 3).map(i => i.str).join(' ').slice(0, 60)}")` });

    // 연산자 목록으로 렌더 모드·채움색·이미지 크기 추적
    const ops = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    let fill = null, tr = 0; const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
    let invisibleRuns = 0, whiteRuns = 0, whiteOnBlank = 0, tinyImages = 0, images = 0, nonWhiteFill = false; const samples = []; const hiddenText = [];
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    const glyphs = (a) => Array.isArray(a) ? a.filter(x => x && typeof x === 'object' && 'unicode' in x).map(x => x.unicode).join('') : '';
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push({ fill, tr, ctm }); break;
        case OPS.restore: { const s = stack.pop(); if (s) ({ fill, tr, ctm } = s); break; }
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.setFillRGBColor: fill = [a[0] / 255, a[1] / 255, a[2] / 255]; break;
        case OPS.setFillGray: fill = [a[0], a[0], a[0]]; break;
        case OPS.setFillCMYKColor: fill = a[0] === 0 && a[1] === 0 && a[2] === 0 && a[3] === 0 ? [1, 1, 1] : [0, 0, 0]; break;
        case OPS.setTextRenderingMode: tr = a[0]; break;
        case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke: case OPS.shadingFill:
          if (!isNearWhite(fill)) nonWhiteFill = true; break;
        case OPS.showText: case OPS.showSpacedText: {
          const txt = glyphs(fn === OPS.showSpacedText ? a[0] : a[0]);
          if (!txt.trim()) break;
          if (tr === 3 || tr === 7) { invisibleRuns++; hiddenText.push(txt); if (samples.length < 3) samples.push(txt.slice(0, 40)); }
          else if ((tr === 0 || tr === 2 || tr === 4 || tr === 6) && isNearWhite(fill)) {
            whiteRuns++; hiddenText.push(txt);
            // 그 전에 색 있는 채움이나 이미지가 없었으면 흰 바탕 위 흰 글자일 가능성이 크다
            if (!nonWhiteFill && images === 0) { whiteOnBlank++; if (samples.length < 3) samples.push(txt.slice(0, 40)); }
          }
          break;
        }
        case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageMaskXObject: {
          images++;
          const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
          if (w < 1 || h < 1) tinyImages++;
          break;
        }
      }
    }
    if (invisibleRuns) findings.push({ kind: 'pdf-invisible-text', where: `p.${p}`, detail: `렌더 모드 3/7 텍스트 ${invisibleRuns}건 (OCR 레이어일 수 있음) 예: ${samples.map(s => `"${s}"`).join(', ')}` });
    if (whiteOnBlank) findings.push({ kind: 'pdf-white-text-on-blank', where: `p.${p}`, detail: `색 배경 없이 흰색 텍스트 ${whiteOnBlank}건 예: ${samples.map(s => `"${s}"`).join(', ')}` });
    else if (whiteRuns) whiteOnColored += whiteRuns;
    const hidden = hiddenText.join(' ');
    const inj = hidden.match(INJECTION);
    if (inj) findings.push({ kind: 'pdf-hidden-instruction', where: `p.${p}`, detail: `숨은 텍스트에 지시문: "${hidden.slice(Math.max(0, inj.index - 40), inj.index + inj[0].length + 40)}"` });
    if (tinyImages) findings.push({ kind: 'pdf-tiny-image', where: `p.${p}`, detail: `1pt 미만 크기 이미지 ${tinyImages}/${images}개` });
    page.cleanup();
  }
  if (whiteOnColored) findings.push({ kind: 'info-white-on-colored', where: '전체', detail: `색 배경(제목 띠 등) 위 흰 글자 ${whiteOnColored}건 — 보통 정상` });
  findings.push(...scanText(fullText, '본문'));
  await doc.destroy();
  return findings;
}

// ---- docx / pptx (OOXML) ----
async function scanOoxml(file) {
  const findings = [];
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files);
  const xmlNames = names.filter(n => /\.xml$/i.test(n) && /^(word|ppt)\//.test(n));
  const media = names.filter(n => /\/media\//.test(n));
  let whiteTotal = 0;
  for (const n of xmlNames) {
    const xml = await zip.file(n).async('string');
    const where = n.replace(/^(word|ppt)\//, '');
    const txt = xml.replace(/<[^>]+>/g, ' ');
    findings.push(...scanText(txt, where));
    const vanish = (xml.match(/<w:vanish\b/g) ?? []).length;
    if (vanish) findings.push({ kind: 'docx-hidden-text', where, detail: `w:vanish ${vanish}회` });
    // 흰 글자색: 슬라이드는 색 도형 위 흰 글자가 흔해 참고로만 센다. 다만 흰 글자 런의 내용이 지시문이면 의심
    const whiteRuns = [...xml.matchAll(/<(?:w:r|a:r)\b[\s\S]*?<\/(?:w:r|a:r)>/g)].map(m => m[0]).filter(r => /(<w:color\s+w:val="(FFFFFF|FEFEFE|FDFDFD)")|(<a:solidFill>\s*<a:srgbClr\s+val="(FFFFFF|FEFEFE|FDFDFD)")/i.test(r));
    whiteTotal += whiteRuns.length;
    const whiteText = whiteRuns.map(r => r.replace(/<[^>]+>/g, ' ')).join(' ');
    const inj = whiteText.match(INJECTION);
    if (inj) findings.push({ kind: 'ooxml-white-text-instruction', where, detail: `흰 글자에 지시문: "${whiteText.slice(Math.max(0, inj.index - 40), inj.index + inj[0].length + 40).replace(/\s+/g, ' ')}"` });
    const tinyFont = (xml.match(/<w:sz\s+w:val="([1-4])"/g) ?? []).length + (xml.match(/\bsz="(10|20|30|40|50|60|70|80|90)"/g) ?? []).length;
    if (tinyFont) findings.push({ kind: 'ooxml-tiny-font', where, detail: `1pt 이하 글꼴 ${tinyFont}회` });
    if (/<p:sld\b[^>]*\sshow="0"/.test(xml)) findings.push({ kind: 'pptx-hidden-slide', where, detail: '숨긴 슬라이드' });
  }
  if (whiteTotal) findings.push({ kind: 'info-white-text-runs', where: '전체', detail: `흰색 글자 런 ${whiteTotal}개 (색 도형 위 글자면 정상)` });
  for (const m of media) {
    const size = zip.file(m)?._data?.uncompressedSize ?? 0;
    if (size > 0 && size < 200) findings.push({ kind: 'info-tiny-media', where: m, detail: `${size}바이트 그림 (글머리표·자리표시자일 수 있음)` });
  }
  return findings;
}

// ---- 텍스트/HTML ----
function scanPlain(file) {
  const text = fs.readFileSync(file, 'utf8');
  const f = scanText(text, '본문');
  if (/\.html?$/i.test(file)) {
    if (/display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0(\.0+)?\b/i.test(text)) f.push({ kind: 'html-hidden-style', where: '본문', detail: 'display:none / visibility:hidden / font-size:0 / opacity:0' });
    if (/color\s*:\s*(#fff(fff)?|white)\b/i.test(text)) f.push({ kind: 'html-white-text', where: '본문', detail: 'color: white' });
  }
  return f;
}

async function scanFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return scanPdf(file);
  if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') return scanOoxml(file);
  if (['.md', '.txt', '.html', '.htm', '.csv'].includes(ext)) return scanPlain(file);
  return [{ kind: 'skipped', where: '', detail: `${ext || '확장자 없음'}: 검사 규칙 없음 (zip·이미지·doc 등은 열어 보지 않음)` }];
}

// ---- 대상 파일 ----
const db = openDb();
let rows;
if (all) rows = db.prepare(`select key, local_path, downloaded_at from files where status = 'ok' and local_path is not null order by downloaded_at`).all();
else if (since) rows = db.prepare(`select key, local_path, downloaded_at from files where status = 'ok' and local_path is not null and downloaded_at >= ? order by downloaded_at`).all(since);
else {
  const run = db.prepare(`select max(downloaded_run) r from files where status = 'ok'`).get()?.r;
  rows = run == null ? [] : db.prepare(`select key, local_path, downloaded_at from files where status = 'ok' and local_path is not null and downloaded_run = ? order by downloaded_at`).all(run);
}

const report = { scanned: 0, missing: [], errors: [], files: [] };
for (const r of rows) {
  if (!fs.existsSync(r.local_path)) { report.missing.push(r.local_path); continue; }
  report.scanned++;
  try {
    const findings = await scanFile(r.local_path);
    if (findings.length) report.files.push({ key: r.key, path: r.local_path, findings });
  } catch (e) {
    report.errors.push({ path: r.local_path, error: String(e?.message ?? e) });
  }
}

if (asJson) { console.log(JSON.stringify(report, null, 1)); }
else {
  console.log(`검사 ${report.scanned}개 (대상 ${rows.length}, 없음 ${report.missing.length}, 오류 ${report.errors.length})`);
  const quiet = x => x.kind === 'skipped' || x.kind.startsWith('info-');
  const real = report.files.filter(f => f.findings.some(x => !quiet(x)));
  const skipped = report.files.filter(f => f.findings.every(x => x.kind === 'skipped'));
  const infoOnly = report.files.filter(f => f.findings.every(quiet) && f.findings.some(x => x.kind.startsWith('info-')));
  if (infoOnly.length) console.log(`참고만(색 배경 위 흰 글자 등) ${infoOnly.length}개 파일`);
  if (skipped.length) console.log(`검사 규칙 없는 파일 ${skipped.length}개: ${skipped.map(f => path.basename(f.path)).join(', ')}`);
  if (!real.length) console.log('의심 항목 없음');
  for (const f of real) {
    console.log(`\n## ${f.path}`);
    // 같은 종류는 한 줄로 모은다 (위치 목록 + 첫 예시)
    const groups = new Map();
    for (const x of f.findings) { if (quiet(x)) continue; const g = groups.get(x.kind) ?? { wheres: [], first: x.detail }; g.wheres.push(x.where); groups.set(x.kind, g); }
    for (const [kind, g] of groups) {
      const w = g.wheres.length > 8 ? `${g.wheres.slice(0, 8).join(', ')} 외 ${g.wheres.length - 8}곳` : g.wheres.join(', ');
      console.log(`  - [${kind}] ${g.wheres.length}곳 (${w}) — ${g.first}`);
    }
  }
  for (const e of report.errors) console.log(`\n!! ${e.path}: ${e.error}`);
}
