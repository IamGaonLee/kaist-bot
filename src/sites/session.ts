// 사이트별 세션 프로브와 연쇄 로그인. 만료 신호는 S8a 검증 결과 (docs/portal-design.md).
import { KaistError } from '../errors.js';
import { chainLogin, cookiesFor, type BrowserCookie, type LoginStep } from '../sso/browser-login.js';
import { KlmsHttp } from '../klms/http.js';
import { probe as probeKlms } from '../klms/session.js';
import { SessionStore, SITES, type SessionFile, type SiteId, type StoredCookie } from '../klms/session-store.js';
import { KLMS_BASE, KLMS_HOST, URLS, browserLoggedInCheck } from '../klms/site.js';
import { SiteHttp, type SiteResponse } from './http.js';
import { BROWSER_CHECKS, ERP_BASE_FORM, SITE_DEFS, type PortalSite } from './sites.js';

export type ProbeState = 'ok' | 'expired' | 'no-session' | 'error';

const isJson = (r: SiteResponse) => r.contentType.includes('json');
const toLoginRedirect = (r: SiteResponse) => r.status >= 300 && r.status < 400 && /login|sso\./i.test(r.location ?? '');

/** 프로브 응답 판별 (순수 함수, 테스트용). 본문은 판별 필드만 보고 버린다 */
export function classifyProbe(site: PortalSite, r: SiteResponse): Exclude<ProbeState, 'no-session'> {
  if (toLoginRedirect(r) || r.status === 401) return 'expired';
  switch (site) {
    case 'portal':
      if (r.status === 200) return isJson(r) ? 'ok' : 'expired'; // 만료 시 HTML 오류 화면
      return 'error';
    case 'erp': {
      if (r.status !== 200) return 'error';
      if (!isJson(r)) return 'expired';
      let isLogin: unknown;
      try { isLogin = (JSON.parse(r.text) as { dmLoginConfirm?: { isLogin?: unknown } }).dmLoginConfirm?.isLogin; } catch { return 'expired'; }
      return isLogin === '1' ? 'ok' : isLogin === '0' ? 'expired' : 'error';
    }
    case 'kds':
      if (r.status === 200) return 'ok';
      if (r.status === 500) return 'expired'; // 배정 정보는 만료 시 500 (검증에서 확인)
      return 'error';
  }
}

export const KDS_HEADERS: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', AJAX: 'true', 'X-Requested-With': 'XMLHttpRequest' };

const PROBE_REQUEST: Record<PortalSite, { path: string; method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }> = {
  portal: { path: '/wz/api/widget/schedule/stulist', method: 'POST', body: '', headers: { 'Content-Type': 'application/json' } },
  erp: { path: '/com/cnst/PropCtr/findViewSession.do', method: 'POST', body: ERP_BASE_FORM, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } },
  kds: { path: '/myDorm/selectDormPostngInfo.do', method: 'POST', body: '', headers: KDS_HEADERS },
};


export interface SiteStatus {
  site: SiteId;
  label: string;
  saved: boolean;
  savedAt: string | null;
  lastUsedAt: string | null;
  /** --check일 때만 */
  state: ProbeState | null;
}

/** 한 사이트 프로브 (요청 1건). 세션이 살아 있으면 마지막 사용 시각을 갱신한다 */
export async function probeSite(site: SiteId, store = new SessionStore()): Promise<ProbeState> {
  const s = store.forSite(site);
  const saved = s.load();
  if (!saved) return 'no-session';
  try {
    if (site === 'klms') {
      const http = new KlmsHttp(saved, s);
      const p = await probeKlms(http);
      if (p.ok) http.persist();
      return p.ok ? 'ok' : 'expired';
    }
    const http = new SiteHttp(site, saved, s);
    const q = PROBE_REQUEST[site];
    const state = classifyProbe(site, await http.request(q.path, q));
    if (state === 'ok') http.markUsed();
    return state;
  } catch (e) {
    if (e instanceof KaistError && e.code === 'SESSION_EXPIRED') return 'expired';
    return 'error';
  }
}

/** 저장 상태 (로컬만) */
export function siteStatuses(store = new SessionStore()): SiteStatus[] {
  return SITES.map(site => {
    const s = store.forSite(site).load();
    return { site, label: site === 'klms' ? 'KLMS' : SITE_DEFS[site].label, saved: !!s, savedAt: s?.savedAt ?? null, lastUsedAt: s?.lastUsedAt ?? null, state: null };
  });
}

const HOST: Record<SiteId, string> = { klms: KLMS_HOST, portal: SITE_DEFS.portal.host, erp: SITE_DEFS.erp.host, kds: SITE_DEFS.kds.host };

const toStored = (c: BrowserCookie): StoredCookie => ({ name: c.name, value: c.value, domain: c.domain.replace(/^\./, ''), path: c.path, expires: c.expires });

/** 브라우저 쿠키 → 사이트별 세션 (사이트 자기 호스트만, SSO·상위 도메인 쿠키 제외) */
export function splitCookies(cookies: BrowserCookie[], now = new Date().toISOString()): Partial<Record<SiteId, SessionFile>> {
  const out: Partial<Record<SiteId, SessionFile>> = {};
  for (const site of SITES) {
    const own = cookiesFor(cookies, HOST[site]);
    if (own.length) out[site] = { savedAt: now, lastUsedAt: now, cookies: own.map(toStored) };
  }
  return out;
}

const STEPS: Record<SiteId, LoginStep> = {
  portal: { id: 'portal', startUrl: SITE_DEFS.portal.loginUrl, isLoggedIn: BROWSER_CHECKS.portal },
  klms: { id: 'klms', startUrl: KLMS_BASE + URLS.ssoLogin, isLoggedIn: page => page.evaluate(browserLoggedInCheck) },
  erp: { id: 'erp', startUrl: SITE_DEFS.erp.loginUrl, isLoggedIn: BROWSER_CHECKS.erp },
  kds: { id: 'kds', startUrl: SITE_DEFS.kds.loginUrl, isLoggedIn: BROWSER_CHECKS.kds },
};

export interface LoginAllResult {
  /** 사이트별: 브라우저 연쇄 성공 여부와 브라우저를 닫은 뒤 프로브 결과 */
  sites: { site: SiteId; chained: boolean; state: ProbeState }[];
}

/**
 * 로그인 창 1개: 포털에서 사용자가 로그인(2단계 인증 1회) → KLMS·ERP·kds 연쇄.
 * 한 사이트가 실패해도 나머지는 저장한다. only를 주면 그 사이트만(포털 경유가 필요한 ERP는 포털부터).
 */
export async function loginAll(opts: { only?: SiteId; onStatus?: (m: string) => void; store?: SessionStore } = {}): Promise<LoginAllResult> {
  const store = opts.store ?? new SessionStore();
  const order: SiteId[] = opts.only === 'klms' ? ['klms']
    : opts.only === 'kds' ? ['portal', 'kds']
    : opts.only ? ['portal', opts.only].filter((v, i, a) => a.indexOf(v) === i) as SiteId[]
    : ['portal', 'klms', 'erp', 'kds'];
  const r = await chainLogin({ steps: order.map(s => STEPS[s]), onStatus: opts.onStatus });
  const split = splitCookies(r.cookies);
  const targets = opts.only ? [opts.only] : order;
  for (const site of targets) {
    const session = split[site];
    if (r.ok[site] && session) store.forSite(site).save(session);
  }
  // 브라우저를 닫은 뒤 쿠키만으로 통하는지 확인
  const sites: LoginAllResult['sites'] = [];
  for (const site of targets) sites.push({ site, chained: !!r.ok[site], state: r.ok[site] ? await probeSite(site, store) : 'no-session' });
  if (opts.only && sites[0]?.state !== 'ok') {
    throw new KaistError('LOGIN_VERIFY_FAILED', `${opts.only}: 브라우저에서는 로그인됐지만 저장한 쿠키로는 세션이 확인되지 않습니다.`);
  }
  return { sites };
}
