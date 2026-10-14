// S8c 검증 2: boardNos 여러 개, 본문 응답 구조 (샘플만 저장)
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../src/klms/session-store.js';
import { SiteHttp } from '../../src/sites/http.js';
import { paths } from '../../src/config.js';

const out = path.join(paths.home, 'samples', 'portal', 's8c');
const store = new SessionStore();
const http = new SiteHttp('portal', store.forSite('portal').load()!, store.forSite('portal'));
let r = await http.request('/wz/api/board/recents?pageIndex=1&recordCountPerPage=10&boardNos=31,28,45,23');
fs.writeFileSync(path.join(out, 'recents-multi.json'), r.text);
const j = JSON.parse(r.text) as { data: { boardNo: number; regDt: string }[]; page: { totalRecord: number } };
console.log('multi', r.status, j.page.totalRecord, [...new Set(j.data.map(d => d.boardNo))].join(','), j.data.at(-1)?.regDt, '~', j.data[0]?.regDt);
r = await http.request('/wz/api/board/recents/17918529279900?boardNo=31');
fs.writeFileSync(path.join(out, 'post-31.json'), r.text);
const p = JSON.parse(r.text) as Record<string, unknown> & { pstCn?: string; boardAtchList?: { atchFileNm: string; atchFileSize: number }[] };
console.log('post', r.status, p.pstNo, p.boardNo, p.regDt, p.chgDt, 'cn', p.pstCn?.length, 'atch', p.boardAtchList?.map(a => a.atchFileNm + ' ' + a.atchFileSize).join(' | '));
