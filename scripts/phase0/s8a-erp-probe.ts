// S8a: ERP 만료 판별용 프로브 후보 비교 (정상 쿠키 vs 망가진 쿠키, 요청 4건). 값은 출력하지 않고 구조·판별 필드만.
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'samples', 'portal', 's8a');
const cookies = JSON.parse(fs.readFileSync(path.join(out, 'cookies.json'), 'utf8')) as { domain: string; name: string; value: string }[];
const jar = (broken: boolean) => cookies.filter(c => c.domain.replace(/^\./, '').endsWith('erp.kaist.ac.kr'))
  .map(c => `${c.name}=${broken ? 'x' + c.value.slice(1, 4) + 'broken' : c.value}`).join('; ');
const body = '_menuId=MzMzODYzMjY%3D&_menuNm=&_pgmId=MTg3NDA2&';
for (const p of ['/com/cnst/PropCtr/findViewSession.do', '/com/lgin/SsoCtr/checkLoginPolicy.do']) {
  for (const broken of [false, true]) {
    const r = await fetch('https://erp.kaist.ac.kr' + p, { method: 'POST', redirect: 'manual', body,
      headers: { Cookie: jar(broken), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'Mozilla/5.0' } });
    const t = await r.text();
    let info = 'JSON 아님';
    try { const j = JSON.parse(t); info = `isLogin=${j.dmLoginConfirm?.isLogin} success=${j._METADATA_?.success} keys=${Object.keys(j).join(',')} userNm있음=${!!j.gdmViewSession?.userNm}`; } catch { /* HTML */ }
    console.log(p.split('/').at(-1), broken ? '망가짐' : '정상', r.status, (r.headers.get('content-type') ?? '').split(';')[0], info);
    await new Promise(r => setTimeout(r, 800));
  }
}
