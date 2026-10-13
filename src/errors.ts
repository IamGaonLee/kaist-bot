/** CLI 전체에서 쓰는 오류. code는 --json 출력과 종료 코드 결정에 쓰인다. */
export class KaistError extends Error {
  constructor(public readonly code: string, message: string, public readonly detail?: Record<string, unknown>) {
    super(message);
    this.name = 'KaistError';
  }
}

/** 세션이 만료됐거나 없다. 재로그인이 필요하다. */
export class SessionExpiredError extends KaistError {
  constructor(where: string) {
    super('SESSION_EXPIRED', `세션이 만료됐습니다 (${where}). \`kaist login\`으로 다시 로그인해 주세요.`, { where });
  }
}

export class LoginCancelledError extends KaistError {
  constructor(reason: 'closed' | 'timeout') {
    super('LOGIN_CANCELLED', reason === 'closed' ? '로그인 창이 닫혀 로그인을 취소했습니다.' : '로그인 대기 시간이 지나 취소했습니다.');
  }
}

/** 페이지나 응답 구조가 예상과 다르다. 조용히 넘어가지 않는다. */
export class ParseError extends KaistError {
  constructor(where: string, what: string) {
    super('PARSE_ERROR', `${where}: ${what}`, { where });
  }
}

/** 차단·이상 응답. 멈추고 사용자에게 알려야 하는 상황. */
export class BlockedError extends KaistError {
  constructor(where: string, status: number) {
    super('BLOCKED', `${where}에서 HTTP ${status} 응답을 받았습니다. 요청이 차단됐을 수 있으니 중단합니다.`, { where, status });
  }
}

export const exitCodeOf = (e: unknown): number =>
  e instanceof SessionExpiredError ? 2 : e instanceof LoginCancelledError ? 3 : 1;
