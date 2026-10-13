// 이번 학기 자료 파일 몇 개에 HEAD 요청 (본문 받지 않음): 토큰/쿠키 방식 직접 다운로드 가능 여부
import fs from 'node:fs';
import path from 'node:path';
import { get, LOCAL } from './http.ts';

const token = fs.readFileSync(path.join(LOCAL, 'wstoken.txt'), 'utf8').trim();
const files = fs.readdirSync(path.join(LOCAL, 'samples')).filter(f => /^api-contents-\d+\.json$/.test(f));
const picks = files.slice(0, 3).map(f => JSON.parse(fs.readFileSync(path.join(LOCAL, 'samples', f), 'utf8'))
  .flatMap((s: any) => s.modules).find((m: any) => m.modname === 'resource')?.contents?.[0]).filter(Boolean);
for (const c of picks) {
  const r = await get(`${c.fileurl}&token=${token}`, { method: 'HEAD' });
  const r2 = await get(c.fileurl.replace('/webservice/pluginfile.php', '/pluginfile.php'), { method: 'HEAD' });
  console.log(c.mimetype, '| token:', r.status, r.headers.get('content-type'), '| cookie:', r2.status, r2.headers.get('content-type'), r2.headers.get('location') ?? '');
}
