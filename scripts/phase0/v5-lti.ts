// LTI 활동(영상 추정)이 무엇인지, 자료 파일이 모두 직접 링크를 갖는지 확인
import fs from 'node:fs';
import path from 'node:path';
import { get, save, LOCAL, BASE } from './http.ts';

const token = fs.readFileSync(path.join(LOCAL, 'wstoken.txt'), 'utf8').trim();
const files = fs.readdirSync(path.join(LOCAL, 'samples')).filter(f => /^api-contents-\d+\.json$/.test(f));
const mods = files.flatMap(f => JSON.parse(fs.readFileSync(path.join(LOCAL, 'samples', f), 'utf8')).flatMap((s: any) => s.modules));

const res = mods.filter((m: any) => m.modname === 'resource');
console.log('resource 중 contents 없는 것:', res.filter((m: any) => !m.contents?.length).length, '/', res.length);
const mimes: Record<string, number> = {};
for (const m of res) for (const c of m.contents ?? []) mimes[c.mimetype] = (mimes[c.mimetype] ?? 0) + 1;
console.log('mimetype:', JSON.stringify(mimes));

const ltis = mods.filter((m: any) => m.modname === 'lti');
console.log('lti 이름 예:', ltis.slice(0, 6).map((m: any) => m.name));

const courseId = Number(files[0].match(/\d+/)![0]);
const qs = new URLSearchParams({ moodlewsrestformat: 'json', wsfunction: 'mod_lti_get_ltis_by_courses', wstoken: token, 'courseids[0]': String(courseId) });
const j = await (await get(`${BASE}/webservice/rest/server.php`, { method: 'POST', body: qs })).json() as any;
save('api-mod_lti_get_ltis_by_courses.json', JSON.stringify(j, null, 2));
const l = j.ltis ?? [];
console.log('lti 필드:', l[0] ? Object.keys(l[0]).join(',') : JSON.stringify(j).slice(0, 300));
console.log('toolurl/typeid 예:', [...new Set(l.map((x: any) => `${x.typeid} ${String(x.toolurl ?? '').replace(/\d+/g, 'N')}`))].slice(0, 5));
