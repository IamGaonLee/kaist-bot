// 로그인 중 뜬 alert 문구 분류 (순수 함수, 플랫폼 무관). Playwright·Electron 드라이버가 공유한다.
export function classifyLoginDialog(msg: string): string | null {
  const m = msg || '';
  if (/잠[겼금]|lock|정지|제한.*횟수|\d+회 이상/i.test(m)) return '계정이 잠겼거나 로그인 시도가 제한되었습니다';
  if (/거[부절]|reject|승인.*(거|실패)/i.test(m)) return '폰에서 승인이 거부되었습니다';
  if (/차단|block|비정상적인 접근/i.test(m)) return '접근이 차단되었습니다';
  if (/중복|다른 곳|이미 로그인|duplicate/i.test(m)) return '다른 곳에서 로그인 중입니다';
  if (/일치하지|불일치|mismatch/i.test(m)) return '인증 번호가 일치하지 않습니다';
  if (/만료|시간.*초과|timeout|expire/i.test(m)) return '시간이 초과되었습니다';
  if (/아이디|비밀번호|존재하지|확인해/i.test(m)) return '아이디 또는 비밀번호가 올바르지 않습니다';
  return null;
}

/** 분류 결과(없으면 원문 짧게)로 실패 메시지를 만든다 */
export function loginFailureMessage(msg: string): string {
  const reason = classifyLoginDialog(msg);
  return `로그인이 중단됐습니다: ${reason ?? (msg || '알 수 없는 알림').slice(0, 100)}`;
}
