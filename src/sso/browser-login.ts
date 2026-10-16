// SSO 로그인 창 (사이트 무관) — 포트 인터페이스.
// 실제 창은 플랫폼 드라이버가 연다(CLI는 Playwright, 앱은 Electron). 코어는 이 포트만 쓴다.
// 비밀번호는 다루지 않는다. 드라이버는 매번 새 컨텍스트(프로필·자동완성 없음)를 쓴다.
import { KaistError } from '../errors.js';

/** 브라우저 쿠키 (플랫폼 무관 데이터). Playwright/Electron 쿠키가 이 모양을 만족한다. */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

/** 로그인 페이지에서 스크립트를 실행하는 핸들. 콜백은 페이지 컨텍스트(브라우저)에서 돈다. */
export interface LoginPage {
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

export interface LoginStep {
  id: string;
  startUrl: string;
  /** 로그인 완료 여부. 예외는 '아직 아님'으로 취급한다. */
  isLoggedIn(page: LoginPage): Promise<boolean>;
  /** (선택) 매 대기 회마다 호출. 현재 화면에서 눌러야 할 버튼을 눌러 진행한다(아이디 입력·포털 로그인·기기 등록 등). 각 클릭은 페이지를 넘기므로 중복 클릭되지 않는다. */
  prepare?(page: LoginPage): Promise<void>;
  /** (선택) 현재 화면을 사람이 볼 문구로. 창을 숨겼을 때 2단계 인증 번호 등을 앱 화면에 띄우는 용도. 바뀔 때만 onStatus로 나간다. */
  describe?(page: LoginPage): Promise<string | null>;
  /** (선택) 로그인 페이지에서 사용자가 입력한 아이디를 읽는다(저장 옵션일 때만 단다). 없으면 null. */
  captureId?(page: LoginPage): Promise<string | null>;
}

export interface ChainLoginOptions {
  /** 첫 단계는 사용자가 로그인하는 곳, 나머지는 SSO 세션으로 자동 연쇄 */
  steps: LoginStep[];
  /** 첫 단계 대기 시간 */
  timeoutMs?: number;
  /** 연쇄 단계마다 대기 시간 */
  chainTimeoutMs?: number;
  /** 창을 숨긴다(사용자는 앱 화면만 본다). 자동 넘김이 되므로 상호작용이 필요 없을 때. */
  headless?: boolean;
  /** 브라우저 User-Agent (headless 티를 없애려면 일반 UA) */
  userAgent?: string;
  onStatus?(message: string): void;
}

export interface ChainLoginResult {
  /** 단계별 성공 여부. 첫 단계 실패는 예외로 올린다 */
  ok: Record<string, boolean>;
  cookies: BrowserCookie[];
  /** 첫 단계 captureId가 읽은 아이디 (저장 옵션일 때만) */
  capturedId?: string;
}

export interface BrowserLoginOptions {
  startUrl: string;
  isLoggedIn(page: LoginPage): Promise<boolean>;
  /** 돌려줄 쿠키의 도메인 (정확히 일치하거나 하위 도메인) */
  cookieDomain: string;
  /** 브라우저를 닫기 전에 쿠키가 브라우저 밖에서도 통하는지 확인 */
  verify(cookies: BrowserCookie[]): Promise<boolean>;
  timeoutMs?: number;
  onStatus?(message: string): void;
}

/** 로그인 창을 여는 플랫폼 드라이버 */
export interface LoginDriver {
  chainLogin(opts: ChainLoginOptions): Promise<ChainLoginResult>;
  browserLogin(opts: BrowserLoginOptions): Promise<BrowserCookie[]>;
}

export const cookiesFor = (cookies: BrowserCookie[], domain: string) => cookies.filter(c => {
  const d = c.domain.replace(/^\./, '');
  return d === domain || d.endsWith('.' + domain);
});

let driver: LoginDriver | null = null;

/** 플랫폼 진입점에서 1회 호출 (src/platform.ts) */
export function setLoginDriver(d: LoginDriver): void {
  driver = d;
}

function requireDriver(): LoginDriver {
  if (!driver) throw new KaistError('INTERNAL', '로그인 드라이버가 설정되지 않았습니다. installPlatform()을 먼저 호출해야 합니다.');
  return driver;
}

export const chainLogin = (opts: ChainLoginOptions): Promise<ChainLoginResult> => requireDriver().chainLogin(opts);
export const browserLogin = (opts: BrowserLoginOptions): Promise<BrowserCookie[]> => requireDriver().browserLogin(opts);
