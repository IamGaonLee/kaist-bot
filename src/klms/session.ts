// 세션 확보: 쿠키 파일 → 프로브 → (만료 시) 브라우저 로그인. 설계 5절.
import type { Cookie } from 'playwright';
import { KaistError, SessionExpiredError } from '../errors.js';
import { browserLogin } from '../sso/browser-login.js';
import { callAjax, InvalidSesskeyError } from './ajax.js';
import { KlmsHttp } from './http.js';
import { SessionStore, type SessionFile, type StoredCookie } from './session-store.js';
import { KLMS_BASE, KLMS_HOST, URLS, browserLoggedInCheck, extractSesskey, hasNotLoggedInClass } from './site.js';

export interface KlmsSession {
  http: KlmsHttp;
  sesskey: string;
  /** sesskey가 무효해졌을 때 1회 다시 얻어 재시도 */
  ajax<T>(method: string, args: object): Promise<T>;
}

export type ProbeResult = { ok: true; sesskey: string } | { ok: false; reason: 'expired' | 'no-session' };

/** GET /my/ 로 세션 상태 판별. 만료 외의 이상은 예외로 올린다. */
export async function probe(http: KlmsHttp): Promise<ProbeResult> {
  try {
    const html = await http.html(URLS.dashboard);
    const sesskey = extractSesskey(html);
    if (!sesskey || hasNotLoggedInClass(html)) return { ok: false, reason: 'expired' };
    return { ok: true, sesskey };
  } catch (e) {
    if (e instanceof SessionExpiredError) return { ok: false, reason: 'expired' };
    throw e;
  }
}

function makeSession(http: KlmsHttp, sesskey: string): KlmsSession {
  const s: KlmsSession = {
    http,
    sesskey,
    async ajax<T>(method: string, args: object): Promise<T> {
      try {
        return await callAjax<T>(http, s.sesskey, method, args);
      } catch (e) {
        if (!(e instanceof InvalidSesskeyError)) throw e;
        const p = await probe(http);
        if (!p.ok) throw new SessionExpiredError(`ajax ${method}`);
        s.sesskey = p.sesskey;
        return callAjax<T>(http, s.sesskey, method, args);
      }
    },
  };
  return s;
}

const toStored = (c: Cookie): StoredCookie => ({ name: c.name, value: c.value, domain: c.domain.replace(/^\./, ''), path: c.path, expires: c.expires });

/** 저장된 세션만 확인 (브라우저 띄우지 않음) */
export async function resumeSession(store = new SessionStore()): Promise<KlmsSession | null> {
  const saved = store.load();
  if (!saved) return null;
  const http = new KlmsHttp(saved, store);
  const p = await probe(http);
  if (!p.ok) return null;
  http.persist();
  return makeSession(http, p.sesskey);
}

/** 브라우저 로그인 후 쿠키 저장 */
export async function interactiveLogin(store = new SessionStore(), onStatus?: (m: string) => void): Promise<KlmsSession> {
  let sesskey: string | null = null;
  await browserLogin({
    startUrl: KLMS_BASE + URLS.ssoLogin,
    cookieDomain: KLMS_HOST,
    isLoggedIn: page => page.evaluate(browserLoggedInCheck),
    onStatus,
    // 브라우저를 닫기 전에 Node fetch로도 통하는지 확인 (보고서 3.3)
    async verify(raw) {
      const now = new Date().toISOString();
      const session: SessionFile = { savedAt: now, lastUsedAt: now, cookies: raw.map(toStored) };
      const http = new KlmsHttp(session, null);
      const p = await probe(http);
      if (!p.ok) return false;
      sesskey = p.sesskey;
      store.save(session); // 프로브 중 받은 Set-Cookie까지 반영된 상태
      return true;
    },
  });
  const saved = store.load();
  if (!sesskey || !saved) throw new KaistError('LOGIN_VERIFY_FAILED', '로그인 쿠키를 저장하지 못했습니다.');
  return makeSession(new KlmsHttp(saved, store), sesskey);
}

/** 세션이 살아 있으면 재사용, 아니면 (interactive일 때) 로그인 */
export async function ensureSession(opts: { interactive: boolean; onStatus?: (m: string) => void }): Promise<KlmsSession> {
  const store = new SessionStore();
  const resumed = await resumeSession(store);
  if (resumed) return resumed;
  if (!opts.interactive) throw new SessionExpiredError('세션 확인');
  opts.onStatus?.('세션이 없거나 만료되어 로그인 창을 엽니다.');
  return interactiveLogin(store, opts.onStatus);
}
