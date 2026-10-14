// S8c 검증 3: 세미나(23)는 일정형 게시판. recents boardNos 필터·board/23 쪽 목록은 0건이고 bgngDt/endDt가 필요하다. 날짜 형식 확인
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../src/klms/session-store.js';
import { SiteHttp } from '../../src/sites/http.js';
import { paths } from '../../src/config.js';

const store = new SessionStore();
const http = new SiteHttp('portal', store.forSite('portal').load()!, store.forSite('portal'));
for (const [b, e] of [['2026-10-15', '2026-11-14'], ['20261015', '20261114'], ['2026.10.15', '2026.11.14']]) {
  const r = await http.request(`/wz/api/board/23?bgngDt=${b}&endDt=${e}&recordCountPerPage=99999`);
  const j = JSON.parse(r.text) as { data: Record<string, unknown>[]; page: { totalRecord: number } };
  console.log(b, r.status, j.page?.totalRecord, j.data?.length);
  if (j.data?.length) {
    fs.writeFileSync(path.join(paths.home, 'samples', 'portal', 's8c', 'board-23.json'), r.text);
    const xs = j.data.map(d => `${d.pstgBgngDt} | reg ${d.regDt} | ${String(d.pstTtl).slice(0, 30)}`).sort();
    console.log(xs.slice(0, 3).join('\n'), '\n...\n' + xs.slice(-3).join('\n'));
    break;
  }
}
