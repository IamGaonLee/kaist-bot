// V7: 과목 HTML의 pluginfile URL(revision 0)로 쿠키 HEAD 1건 — 수정 시각 헤더 확인
import fs from 'node:fs';
import path from 'node:path';
import { get, LOCAL } from './http.ts';

const html = fs.readFileSync(path.join(LOCAL, 'samples', 'html-course-186294.html'), 'utf8');
const url = html.match(/downloadFile\((?:'|&#039;)([^'&]+)(?:'|&#039;)/)![1];
const r = await get(url, { method: 'HEAD' });
console.log(url.replace(/\d+/g, 'N'));
console.log(r.status, ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control'].map(h => `${h}=${r.headers.get(h)}`).join(' | '));
