// S8a: 포털 collegePlan의 날짜 파라미터 형식 확인 (요청 최대 3건)
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'samples', 'portal', 's8a');
const cookies = JSON.parse(fs.readFileSync(path.join(out, 'cookies.json'), 'utf8')) as { domain: string; name: string; value: string }[];
const jar = cookies.filter(c => c.domain === 'portal.kaist.ac.kr').map(c => `${c.name}=${c.value}`).join('; ');
for (const [a, b] of [['2026-08-01', '2026-12-31'], ['2026.08.01', '2026.12.31'], ['202608', '202612']]) {
  const r = await fetch(`https://portal.kaist.ac.kr/wz/api/widget/collegePlan?bgngDt=${a}&endDt=${b}`, { headers: { Cookie: jar, 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual' });
  const t = await r.text();
  let n: unknown = '-';
  try { n = (JSON.parse(t).data ?? []).length; } catch { /* HTML */ }
  console.log(a, r.status, r.headers.get('content-type'), '일정', n);
  if (typeof n === 'number') { fs.writeFileSync(path.join(out, 'collegePlan.json'), t); break; }
  await new Promise(r => setTimeout(r, 800));
}
