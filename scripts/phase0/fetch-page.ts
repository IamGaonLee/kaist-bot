// 페이지 하나를 쿠키로 받아 local/samples/html-<name>.html에 저장
// 사용법: npx tsx scripts/phase0/fetch-page.ts <name> <url> [<name> <url> ...]
import { get, save, short } from './http.ts';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const r = await get(args[i + 1]);
  const t = r.status === 200 ? await r.text() : '';
  if (t) save(`html-${args[i]}.html`, t);
  console.log(args[i], r.status, short(r.headers.get('location')), t.length);
}
