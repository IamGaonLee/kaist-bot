// 새 버전 감지 (GitHub 릴리스 latest). 설치 파일은 받지 않고, 있으면 알리고 다운로드 링크를 연다.
// 코드 서명이 없어 electron-updater 자동 설치는 쓰지 않는다(사용자가 설치 파일을 직접 확인).
export const RELEASES_API = 'https://api.github.com/repos/IamGaonLee/kaist-bot/releases/latest';
export const RELEASES_PAGE = 'https://github.com/IamGaonLee/kaist-bot/releases/latest';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  available: boolean;
  url: string;
  checkedAt: string;
  error?: string;
}

/** "v1.2.3" / "1.2.3" → [1,2,3]. 못 읽으면 null */
export function parseVersion(tag: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return false;
}

export async function checkForUpdate(current: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo> {
  const base = { current, url: RELEASES_PAGE, checkedAt: new Date().toISOString() };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetchImpl(RELEASES_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `KAISTBOT/${current}` }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { ...base, latest: null, available: false, error: `HTTP ${r.status}` };
    const j = await r.json() as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
    const latest = (j.tag_name ?? '').replace(/^v/, '');
    if (!parseVersion(latest)) return { ...base, latest: null, available: false, error: '태그 형식 아님' };
    const setup = j.assets?.find(a => /^KAISTBOT-Setup-.*\.exe$/i.test(a.name));
    return { ...base, latest, available: isNewer(latest, current), url: setup?.browser_download_url ?? j.html_url ?? RELEASES_PAGE };
  } catch (e) {
    return { ...base, latest: null, available: false, error: (e as { message?: string }).message ?? String(e) };
  }
}
