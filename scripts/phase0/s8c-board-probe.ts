// S8c 검증: recents가 게시판 합집합인지, boardNos 필터, 게시판별 목록(31·28·45·23), 하루 글 수. 응답은 samples에만
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../src/klms/session-store.js';
import { SiteHttp } from '../../src/sites/http.js';
import { paths } from '../../src/config.js';

const out = path.join(paths.home, 'samples', 'portal', 's8c');
fs.mkdirSync(out, { recursive: true });
const store = new SessionStore();
const sess = store.forSite('portal').load();
if (!sess) throw new Error('포털 세션 없음');
const http = new SiteHttp('portal', sess, store.forSite('portal'));

type Post = { pstNo: number; boardNo: number; boardNm?: string; regDt: string; chgDt: string; ntcYn: string; pstTtl: string; pstGroupLvl: number };
async function get(name: string, url: string) {
  const r = await http.request(url);
  fs.writeFileSync(path.join(out, name + '.json'), r.text);
  if (!r.contentType.includes('json')) { console.log(name, r.status, r.contentType, '(json 아님)'); return null; }
  const j = JSON.parse(r.text) as { data: Post[]; page?: { totalRecord: number; totalPage: number } };
  const ds = j.data ?? [];
  const boards = [...new Set(ds.map(d => d.boardNo + ':' + (d.boardNm ?? '')))];
  console.log(`\n== ${name} ${r.status} n=${ds.length} total=${j.page?.totalRecord} boards=${boards.join(' | ')}`);
  console.log(`  regDt ${ds.at(-1)?.regDt} ~ ${ds[0]?.regDt}, ntcYn=Y ${ds.filter(d => d.ntcYn === 'Y').length}, pstNo 내림차순=${ds.every((d, i) => i === 0 || ds[i - 1]!.pstNo >= d.pstNo)}`);
  for (const d of ds.slice(0, 4)) console.log(`  ${d.pstNo} b${d.boardNo} ${d.regDt} ${d.ntcYn} ${d.pstTtl.slice(0, 40)}`);
  return j;
}
await get('recents-boardNos31', '/wz/api/board/recents?pageIndex=1&recordCountPerPage=10&boardNos=31');
await get('recents-50', '/wz/api/board/recents?pageIndex=1&recordCountPerPage=50');
for (const b of [31, 28, 45]) await get(`board-${b}`, `/wz/api/board/${b}?pageIndex=1&recordCountPerPage=20`);
console.log('\n요청', http.requestCount);
