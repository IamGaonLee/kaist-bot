// 공용: local/cookies.json의 KLMS 쿠키로 fetch, 요청 간 1.2초 간격
import fs from 'node:fs';
import path from 'node:path';

export const BASE = 'https://klms.kaist.ac.kr';
// OneDrive 밖에 둔다 (쿠키/토큰/프로필)
export const LOCAL = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');

const cookies: any[] = JSON.parse(fs.readFileSync(path.join(LOCAL, 'cookies.json'), 'utf8'));
export const cookieHeader = cookies
  .filter(c => 'klms.kaist.ac.kr'.endsWith(c.domain.replace(/^\./, '')))
  .map(c => `${c.name}=${c.value}`).join('; ');

let last = 0;
export async function get(url: string, init: RequestInit = {}) {
  const wait = last + 1200 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  return fetch(url.startsWith('http') ? url : BASE + url, {
    redirect: 'manual',
    ...init,
    headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', ...(init.headers ?? {}) },
  });
}

export const short = (u: string | null) => { if (!u) return ''; try { const x = new URL(u, BASE); return x.origin + x.pathname; } catch { return u; } };

export function sesskeyOf(html: string) {
  return html.match(/"sesskey":"([^"]+)"/)?.[1] ?? null;
}

export async function ajax(sesskey: string, methodname: string, args: object) {
  const res = await get(`/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname, args }]),
  });
  return { status: res.status, body: await res.text() };
}

export function save(name: string, content: string) {
  fs.writeFileSync(path.join(LOCAL, 'samples', name), content);
}
