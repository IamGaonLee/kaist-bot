// 포털·ERP·kds 공통 HTTP 계층: 허용 목록, 동시 1개, 요청 간격 500ms 이상, 쿠키 갱신, 만료 판별.
// 응답 본문은 로그·오류 메시지에 넣지 않는다 (성적·호실 등 개인정보).
import { BlockedError, KaistError, SessionExpiredError } from '../errors.js';
import { USER_AGENT } from '../klms/site.js';
import { applySetCookies, cookieHeaderFor, type SessionFile, type SessionStore } from '../klms/session-store.js';
import { SITE_DEFS, type Endpoint, type PortalSite } from './sites.js';

export interface SiteResponse {
  status: number;
  contentType: string;
  location: string | null;
  text: string;
}

/** (method, path)가 허용 목록에 있는 끝점 이름. 없거나 금지 경로면 예외 */
export function assertAllowed(site: PortalSite, method: string, url: URL): string {
  const def = SITE_DEFS[site];
  if (url.protocol !== 'https:' || url.hostname !== def.host) {
    throw new KaistError('NOT_ALLOWED', `${def.label}: 허용되지 않은 주소입니다 (${url.protocol}//${url.hostname}).`);
  }
  if (def.forbidden?.some(f => f.test(url.pathname))) {
    throw new KaistError('NOT_ALLOWED', `${def.label}: 상태를 바꾸는 경로라 호출하지 않습니다 (${url.pathname}).`);
  }
  const match = (e: Endpoint) => e.method === method.toUpperCase() && (typeof e.path === 'string' ? e.path === url.pathname : e.path.test(url.pathname));
  const name = Object.entries(def.endpoints).find(([, e]) => match(e))?.[0];
  if (!name) throw new KaistError('NOT_ALLOWED', `${def.label}: 허용 목록에 없는 요청입니다 (${method.toUpperCase()} ${url.pathname}).`);
  return name;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class SiteHttp {
  requestCount = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(readonly site: PortalSite, private readonly session: SessionFile, private readonly store: SessionStore | null,
    private readonly minIntervalMs = 500) {}

  /** 허용 목록 확인 → 순서대로 1개씩 → 응답. 3xx는 따라가지 않는다(만료 판별용). 5xx 판단은 호출자가 한다 */
  request(pathOrUrl: string, init: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {}): Promise<SiteResponse> {
    const def = SITE_DEFS[this.site];
    const url = new URL(pathOrUrl, `https://${def.host}`);
    const method = init.method ?? 'GET';
    assertAllowed(this.site, method, url);
    const run = async (): Promise<SiteResponse> => {
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      this.requestCount++;
      const res = await fetch(url, {
        method,
        body: init.body,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Cookie: cookieHeaderFor(this.session.cookies, url), ...init.headers },
      });
      if (applySetCookies(this.session.cookies, res.headers.getSetCookie(), url.hostname)) this.persist();
      if (res.status === 403 || res.status === 429) throw new BlockedError(`${def.label} ${url.pathname}`, res.status);
      return { status: res.status, contentType: res.headers.get('content-type') ?? '', location: res.headers.get('location'), text: await res.text() };
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** 정상 응답을 확인한 뒤 마지막 사용 시각 기록 */
  markUsed(): void {
    this.session.lastUsedAt = new Date().toISOString();
    this.persist();
  }

  persist(): void {
    this.store?.save(this.session);
  }

  expired(where: string): SessionExpiredError {
    return new SessionExpiredError(`${SITE_DEFS[this.site].label} ${where}`);
  }
}
