// 포털·ERP·생활관(kds) 사이트 상수, 허용 목록, 로그인 판별. 개편 시 고칠 곳을 이 파일로 좁힌다.
// 허용 목록에 없는 (method, path)는 HTTP 계층이 거부한다. 모두 조회(읽기)만 한다. 설계: docs/portal-design.md 7절
import type { LoginPage } from '../sso/browser-login.js';
import type { SiteId } from '../klms/session-store.js';

export type PortalSite = Exclude<SiteId, 'klms'>;

export interface Endpoint {
  method: 'GET' | 'POST';
  /** 정확한 경로, 또는 경로 전체와 맞는 정규식 */
  path: string | RegExp;
  purpose: string;
}

export interface SiteDef {
  host: string;
  /** 사람이 읽는 이름 */
  label: string;
  loginUrl: string;
  endpoints: Record<string, Endpoint>;
  /** 이름이 이 목록과 맞으면 허용 목록에 있어도 호출 금지 (상태를 바꾸는 경로) */
  forbidden?: RegExp[];
}

/** ERP 화면 공통 파라미터 (화면 기록에서 확인한 고정값, 개인정보 없음) */
export const ERP_BASE_FORM = '_menuId=MzMzODYzMjY%3D&_menuNm=&_pgmId=MTg3NDA2&';
export const ERP_GRADES_FORM = '_menuId=MTE4MTQwNDQ3NDc2MjkyNTAwMDA%3D&_menuNm=%EC%84%B1%EC%A0%81%EC%A1%B0%ED%9A%8C&_pgmId=Nzc0NTQ3ODcwMzE%3D&%40d1%23syy=&%40d1%23smtDivCd=&%40d%23=%40d1%23&%40d1%23=dmCond&%40d1%23tp=dm&';

export const SITE_DEFS: Record<PortalSite, SiteDef> = {
  portal: {
    host: 'portal.kaist.ac.kr',
    label: '포털',
    loginUrl: 'https://portal.kaist.ac.kr/common/login/login.do',
    endpoints: {
      timetable: { method: 'POST', path: '/wz/api/widget/schedule/stulist', purpose: '이번 학기 내 시간표 (세션 프로브 겸용)' },
      collegePlan: { method: 'GET', path: '/wz/api/widget/collegePlan', purpose: '학사일정' },
      recents: { method: 'GET', path: '/wz/api/board/recents', purpose: '공지 통합 목록' },
      post: { method: 'GET', path: /^\/wz\/api\/board\/recents\/\d+$/, purpose: '공지 본문' },
    },
  },
  erp: {
    host: 'erp.kaist.ac.kr',
    label: 'ERP',
    // ERP는 포털 메뉴를 거쳐 SSO로 들어간다
    loginUrl: 'https://portal.kaist.ac.kr/kaist/main/cais',
    endpoints: {
      viewSession: { method: 'POST', path: '/com/cnst/PropCtr/findViewSession.do', purpose: '세션 프로브 (isLogin만 읽음)' },
      grades: { method: 'POST', path: '/sch/sgra/SgrassCtr/findStdntEtcGradeList.do', purpose: '성적 조회 (grades --refresh 전용)' },
    },
  },
  kds: {
    host: 'kds.kaist.ac.kr',
    label: '생활관',
    loginUrl: 'https://kds.kaist.ac.kr/login/ssoLogin.do',
    endpoints: {
      dormInfo: { method: 'POST', path: '/myDorm/selectDormPostngInfo.do', purpose: '내 배정 정보 (세션 프로브 겸용)' },
      dormList: { method: 'POST', path: '/myDorm/selectDormPostngList.json', purpose: '배정 이력' },
      schedule: { method: 'POST', path: '/semesterScheduleList.do', purpose: '생활관 학기 일정' },
    },
    // 배정 정보 화면에 함께 있는 상태 변경 경로 (설계 배경)
    forbidden: [/dropOutAply/i, /cancelDropOut/i, /asignCancl/i, /modifyAplyReason/i],
  },
};

/**
 * 포털 공지 게시판 (사용자 결정 3). body=false는 제목만 저장한다.
 * - filter: `board/recents?boardNos=<번호>`로 게시판만 받는다 (번호 여러 개를 한 번에 넣으면 0건이라 따로 요청)
 * - stream: 일정형 게시판(세미나)은 boardNos 필터가 0건이라, 필터 없는 통합 목록을 시간순으로 읽으며 골라낸다
 */
export const PORTAL_BOARDS = [
  { no: 31, name: '수강/학적/논문', body: true, via: 'filter' },
  { no: 28, name: '장학/복지', body: true, via: 'filter' },
  { no: 45, name: '생활관', body: true, via: 'filter' },
  { no: 23, name: '세미나/행사공지', body: false, via: 'stream' },
] as const;

/** 허용 목록에 넣으면 안 되는 동사 (단위 테스트로 확인) */
export const MUTATING_VERB = /aply|cancel|cancl|modify|save|delete|insert|update|regist|drop|submit|apply/i;

/** 브라우저 안 로그인 완료 판별. page.evaluate에 넘기므로 각 함수는 자기 완결적이어야 한다 */
export const BROWSER_CHECKS: Record<PortalSite, (page: LoginPage) => Promise<boolean>> = {
  portal: page => page.evaluate(async () => {
    if (location.host !== 'portal.kaist.ac.kr' || location.pathname.includes('/login')) return false;
    const r = await fetch('/wz/api/widget/identity', { redirect: 'manual' });
    return r.ok && (r.headers.get('content-type') ?? '').includes('json');
  }),
  erp: page => page.evaluate(async (body: string) => {
    if (location.host !== 'erp.kaist.ac.kr') return false;
    const r = await fetch('/com/cnst/PropCtr/findViewSession.do', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
    const j = await r.json().catch(() => null) as { dmLoginConfirm?: { isLogin?: string } } | null;
    return j?.dmLoginConfirm?.isLogin === '1';
  }, ERP_BASE_FORM),
  kds: page => page.evaluate(() => location.host === 'kds.kaist.ac.kr' && !location.pathname.includes('/login')),
};
