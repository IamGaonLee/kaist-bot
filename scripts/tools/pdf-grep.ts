// PDF 하나에서 패턴 주변 문맥 출력 (로컬 파일만). 사용법: npx tsx scripts/tools/pdf-grep.ts <pdf경로> <정규식>
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, pattern] = process.argv.slice(2) as [string, string];
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
let text = '';
for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map(it => ('str' in it ? it.str : '')).join(' ') + '\n';
const re = new RegExp(pattern, 'gi');
let m: RegExpExecArray | null;
while ((m = re.exec(text))) console.log('…' + text.slice(Math.max(0, m.index - 250), m.index + 250).replace(/\s+/g, ' ') + '…\n');
