// V5 (HTML): 쿠키로 주요 페이지를 받아 local/samples/에 저장 + 파일 다운로드 시험
import fs from 'node:fs';
import path from 'node:path';
import { get, save, short, LOCAL } from './http.ts';

const COURSE = 155279;
const contents = JSON.parse(fs.readFileSync(path.join(LOCAL, 'samples', 'api-core_course_get_contents.json'), 'utf8'));
const mods = contents.flatMap((s: any) => s.modules);
const first = (t: string) => mods.find((m: any) => m.modname === t);

async function page(name: string, url: string) {
  const r = await get(url);
  const body = r.status === 200 ? await r.text() : '';
  if (body) save(`html-${name}.html`, body);
  console.log(`${name}: ${r.status} ${short(r.headers.get('location'))} len=${body.length}`);
  return body;
}

const course = await page('course', `/course/view.php?id=${COURSE}`);
const board = await page('courseboard', first('courseboard').url);
// 글 링크 형식 탐색
const postLinks = [...board.matchAll(/href="([^"]*courseboard[^"]*(?:article|content|view)[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
console.log('게시판 내 링크 예:', [...new Set(postLinks)].slice(0, 5).map(u => u.replace(/\d{3,}/g, 'N')));
const post = postLinks.find(u => !u.includes('view.php?id='));
if (post) await page('courseboard-post', post);
await page('assign', first('assign').url);
await page('resource', first('resource').url);
await page('lti', first('lti').url);

// 파일 다운로드: 쿠키 + 일반 pluginfile.php
const res = mods.filter((m: any) => m.modname === 'resource').map((m: any) => m.contents[0]).sort((a: any, b: any) => a.filesize - b.filesize)[0];
const plain = res.fileurl.replace('/webservice/pluginfile.php', '/pluginfile.php');
const r = await get(plain);
console.log('pluginfile(쿠키):', r.status, r.headers.get('content-type'), r.headers.get('content-length'), short(r.headers.get('location')));
if (r.status === 200) {
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(LOCAL, 'samples', 'download-test.pdf'), buf);
  console.log('  받은 크기:', buf.length, '/ API filesize:', res.filesize, '/ PDF 헤더:', buf.subarray(0, 5).toString());
}
// 토큰 방식: 헤더만 확인하고 본문은 받지 않음
const token = fs.readFileSync(path.join(LOCAL, 'wstoken.txt'), 'utf8').trim();
const ctrl = new AbortController();
const r2 = await get(`${res.fileurl}&token=${token}`, { signal: ctrl.signal });
console.log('webservice/pluginfile(토큰):', r2.status, r2.headers.get('content-type'), r2.headers.get('content-length'));
ctrl.abort();
