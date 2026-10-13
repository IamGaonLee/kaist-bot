// KLMS HTTP 공통 계층: 쿠키, 브라우저 UA, 요청 간격, 동시 2개 이하, 만료 감지 통합.
import { BlockedError, SessionExpiredError } from '../errors.js';
import { KLMS_BASE, USER_AGENT, isLoginRedirect } from './site.js';
import { applySetCookies, cookieHeaderFor, type SessionFile, type SessionStore } from './session-store.js';

export type Expect = 'html' | 'json' | 'file';

export interface HttpOptions {
  minIntervalMs?: number;
  maxConcurrent?: number;
}

/**
 * 응답이 세션 만료/차단을 뜻하는지 판별 (보고서 3.4). 정상이면 null.
 * 순수 함수라 테스트에서 직접 쓴다.
 */
export function classifyResponse(
  r: { status: number; location: string | null; contentType: string | null },
  expect: Expect,
): 'expired' | 'blocked' | 'redirect' | null {
  if (r.status >= 300 && r.status < 400) return isLoginRedirect(r.location) ? 'expired' : 'redirect';
  if (r.status === 401) return 'expired';
  if (r.status === 403 || r.status === 429 || r.status === 400) return 'blocked';
  if (expect === 'file' && r.status === 200 && (r.contentType ?? '').startsWith('text/html')) return 'expired';
  return null;
}

class Limiter {
  private active = 0;
  private lastStart = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly minIntervalMs: number, private readonly maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      this.pump();
    });
    try {
      return await fn();
    } finally {
      this.active--;
      this.pump();
    }
  }

  private pump(): void {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) { setTimeout(() => this.pump(), wait); return; }
    this.active++;
    this.lastStart = Date.now();
    this.queue.shift()!();
  }
}

export class KlmsHttp {
  private readonly limiter: Limiter;
  /** 이 클라이언트로 보낸 요청 수 (sync 결과에 표시) */
  requestCount = 0;

  constructor(private readonly session: SessionFile, private readonly store: SessionStore | null, opts: HttpOptions = {}) {
    this.limiter = new Limiter(opts.minIntervalMs ?? 500, Math.min(opts.maxConcurrent ?? 2, 2));
  }

  /** 만료·차단이면 예외. 리다이렉트는 따라가지 않는다(만료 감지를 위해). */
  async request(pathOrUrl: string, expect: Expect, init: RequestInit = {}): Promise<Response> {
    const url = new URL(pathOrUrl, KLMS_BASE);
    this.requestCount++;
    const res = await this.limiter.run(() => fetch(url, {
      ...init,
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: cookieHeaderFor(this.session.cookies, url),
        ...(init.headers as Record<string, string> | undefined),
      },
    }));

    const where = url.pathname;
    if (applySetCookies(this.session.cookies, res.headers.getSetCookie(), url.hostname)) this.persist();
    const verdict = classifyResponse({ status: res.status, location: res.headers.get('location'), contentType: res.headers.get('content-type') }, expect);
    if (verdict === 'expired') throw new SessionExpiredError(where);
    if (verdict === 'blocked') throw new BlockedError(where, res.status);
    if (res.status >= 500) throw new BlockedError(where, res.status);
    this.session.lastUsedAt = new Date().toISOString();
    return res;
  }

  async html(pathOrUrl: string): Promise<string> {
    const res = await this.request(pathOrUrl, 'html');
    if (res.status !== 200) throw new BlockedError(new URL(pathOrUrl, KLMS_BASE).pathname, res.status);
    return res.text();
  }

  /** 마지막 사용 시각과 갱신된 쿠키를 저장 */
  persist(): void {
    this.store?.save(this.session);
  }
}
