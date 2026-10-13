// 세션 방식 AJAX (/lib/ajax/service.php?sesskey=). 토큰 방식(webservice)은 쓰지 않는다.
import { KaistError, ParseError, SessionExpiredError } from '../errors.js';
import type { KlmsHttp } from './http.js';
import { URLS } from './site.js';

/** sesskey가 바뀌었다. 세션 계층이 다시 얻어 1회 재시도한다. */
export class InvalidSesskeyError extends KaistError {
  constructor() { super('INVALID_SESSKEY', 'sesskey가 유효하지 않습니다.'); }
}

/** 이 함수는 세션 방식에서 허용되지 않는다 — 코드 오류 */
export class AjaxNotAllowedError extends KaistError {
  constructor(method: string) { super('AJAX_NOT_ALLOWED', `${method}는 세션 방식 AJAX에서 허용되지 않는 함수입니다 (servicenotavailable).`, { method }); }
}

/** 권한 없음 — 해당 항목만 건너뛴다 */
export class AjaxAccessError extends KaistError {
  constructor(method: string, message: string) { super('AJAX_ACCESS', `${method}: 권한 없음 (${message})`, { method }); }
}

interface AjaxEnvelope { error: boolean; data?: unknown; exception?: { errorcode?: string; message?: string } }

/** AJAX 응답 본문 해석. 순수 함수 (테스트용) */
export function interpretAjax(method: string, body: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new ParseError(`ajax ${method}`, 'JSON이 아닌 응답'); }
  const first = (Array.isArray(parsed) ? parsed[0] : parsed) as AjaxEnvelope | undefined;
  if (!first || typeof first !== 'object') throw new ParseError(`ajax ${method}`, '빈 응답');
  if (!first.error) return first.data;
  const code = first.exception?.errorcode ?? (first as { errorcode?: string }).errorcode ?? 'unknown';
  const msg = first.exception?.message ?? '';
  switch (code) {
    case 'servicerequireslogin': throw new SessionExpiredError(`ajax ${method}`);
    case 'invalidsesskey': throw new InvalidSesskeyError();
    case 'servicenotavailable': throw new AjaxNotAllowedError(method);
    case 'accessexception':
    case 'requireloginerror':
    case 'nopermissions': throw new AjaxAccessError(method, msg);
    default: throw new KaistError('AJAX_ERROR', `${method} 실패: ${code} ${msg}`.trim(), { method, errorcode: code });
  }
}

export async function callAjax<T>(http: KlmsHttp, sesskey: string, method: string, args: object): Promise<T> {
  const res = await http.request(`${URLS.ajax}?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(method)}`, 'json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ index: 0, methodname: method, args }]),
  });
  return interpretAjax(method, await res.text()) as T;
}
