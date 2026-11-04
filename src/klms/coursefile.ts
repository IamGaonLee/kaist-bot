// KLMS 전용 mod_coursefile: 과목 페이지에는 downloadFile 링크가 없고 view.php가 pluginfile로 303 리다이렉트한다 (2026-11-04 실측, 기계요소설계 Chapter7).
// updates_since에도 나오지 않는다 (updates_sig null).
import { KaistError } from '../errors.js';
import type { KlmsSession } from './session.js';

export interface CoursefileLink { url: string; filename: string }

/** view.php 응답의 Location에서 pluginfile 주소와 파일명을 뽑는다. coursefile 형식이 아니면 null */
export function coursefileFromLocation(location: string | null | undefined): CoursefileLink | null {
  if (!location) return null;
  let u: URL;
  try { u = new URL(location); } catch { return null; }
  if (u.protocol !== 'https:' || !/\/pluginfile\.php\/\d+\/mod_coursefile\//.test(u.pathname)) return null;
  const last = u.pathname.split('/').pop() ?? '';
  let filename: string;
  try { filename = decodeURIComponent(last); } catch { filename = last; }
  if (!filename) return null;
  return { url: u.toString(), filename };
}

/** view.php?id=cmid 를 열어(리다이렉트는 따라가지 않음) 파일 주소를 얻는다. 리다이렉트가 아니면 오류 */
export async function resolveCoursefile(session: KlmsSession, cmid: number): Promise<CoursefileLink> {
  const res = await session.http.request(`/mod/coursefile/view.php?id=${cmid}`, 'html');
  const link = res.status >= 300 && res.status < 400 ? coursefileFromLocation(res.headers.get('location')) : null;
  if (!link) throw new KaistError('COURSEFILE_UNEXPECTED', `coursefile ${cmid}: 파일 주소를 얻지 못했습니다 (status ${res.status}, location ${res.headers.get('location') ?? '없음'}). KLMS 화면이 바뀌었을 수 있습니다.`);
  return link;
}
