// 불변식 검사 (보고서 3.2, 불변식 1은 사용자 결정 A: 게시판 제외 비교). 순수 함수.
import { KaistError } from '../errors.js';
import type { ParsedCoursePage } from '../klms/adapters/course-page.js';

export class InvariantError extends KaistError {
  constructor(courseLabel: string, public readonly failures: string[]) {
    super('INVARIANT_FAILED', `${courseLabel}: 불변식 검사 실패 — ${failures.join(' / ')}. 파서가 KLMS 화면과 맞지 않을 수 있어 이 과목 수집을 중단합니다.`, { failures });
  }
}

/** updates_since가 돌려주지 않는 활동 유형 (0단계/S2 확인: courseboard) */
export const NOT_IN_UPDATES = new Set(['courseboard']);

/** 내용을 수집하는 활동 유형. 나머지(설문 등)는 "처리하지 못한 유형"으로 보고만 한다 */
export const HANDLED = new Set(['resource', 'assign', 'quiz', 'courseboard', 'lti', 'url', 'label']);

export interface InvariantReport {
  ok: boolean;
  failures: string[];
  stats: { sections: number; modules: number; boards: number; resources: number; updatesModules: number };
}

export function checkCoursePage(page: ParsedCoursePage, updatesCmids: Set<number>): InvariantReport {
  const failures: string[] = [];
  const htmlSet = new Set(page.modules.map(m => m.cmid));
  // 불변식 1 (사용자 결정):
  //  - HTML에서 못 찾은 활동(updates에만 있음)은 유형과 무관하게 실패 — 파서가 놓친 것
  //  - HTML에만 있는 활동은 수집하는 유형만 실패 — 게시판은 원래 updates에 없고,
  //    설문(choice) 같은 미수집 유형은 updates에서 빠지는 경우가 있다(S2 확인)
  const onlyHtml = page.modules
    .filter(m => HANDLED.has(m.modname) && !NOT_IN_UPDATES.has(m.modname) && !updatesCmids.has(m.cmid))
    .map(m => m.cmid);
  const onlyUpd = [...updatesCmids].filter(c => !htmlSet.has(c));
  if (onlyHtml.length) failures.push(`HTML에만 있는 활동 ${onlyHtml.length}개 (cmid ${onlyHtml.slice(0, 5).join(', ')})`);
  if (onlyUpd.length) failures.push(`HTML에서 못 찾은 활동 ${onlyUpd.length}개 (cmid ${onlyUpd.slice(0, 5).join(', ')})`);
  // 불변식 2: 섹션·활동 수, 파일 링크 추출률 100%, 게시판 1개 이상
  if (page.sections.length === 0) failures.push('섹션 0개');
  if (page.modules.length === 0) failures.push('활동 0개');
  if (page.resourceWithoutLink > 0) failures.push(`다운로드 링크를 못 뽑은 파일 ${page.resourceWithoutLink}개`);
  const boards = page.modules.filter(m => m.modname === 'courseboard').length;
  if (boards === 0) failures.push('게시판 0개');
  return {
    ok: failures.length === 0,
    failures,
    stats: {
      sections: page.sections.length,
      modules: page.modules.length,
      boards,
      resources: page.modules.filter(m => m.modname === 'resource').length,
      updatesModules: updatesCmids.size,
    },
  };
}
