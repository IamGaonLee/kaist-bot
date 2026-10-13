// KLMS 사이트 상수와 판별 규칙. 개편 시 고칠 곳을 이 파일로 좁힌다.
export const KLMS_HOST = 'klms.kaist.ac.kr';
export const KLMS_BASE = `https://${KLMS_HOST}`;

export const URLS = {
  ssoLogin: '/login/ssologin.php',
  dashboard: '/my/',
  ajax: '/lib/ajax/service.php',
} as const;

/** 로그인 페이지로 보내는 리다이렉트인지 */
export function isLoginRedirect(location: string | null): boolean {
  if (!location) return false;
  try {
    const u = new URL(location, KLMS_BASE);
    return u.pathname.startsWith('/login/') || u.host.startsWith('sso.');
  } catch {
    return false;
  }
}

/** 페이지 HTML에서 sesskey 추출 (M.cfg) */
export function extractSesskey(html: string): string | null {
  return html.match(/"sesskey":"([A-Za-z0-9]+)"/)?.[1] ?? null;
}

/** body 클래스에 notloggedin이 있는지 */
export function hasNotLoggedInClass(html: string): boolean {
  const body = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? '';
  return /\bnotloggedin\b/.test(body);
}

/** 브라우저 안에서 로그인 완료 판별 (설계 5절: 세 조건 모두 참) */
export function browserLoggedInCheck(): boolean {
  const url = new URL(location.href);
  const M = (window as unknown as { M?: { cfg?: { sesskey?: unknown } } }).M;
  return url.host === 'klms.kaist.ac.kr'
    && !url.pathname.startsWith('/login/')
    && typeof M?.cfg?.sesskey === 'string'
    && !document.body.classList.contains('notloggedin');
}

/** 브라우저 형태 User-Agent (0단계: curl 기본 UA는 차단된다는 보고가 있음) */
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
