// 수강 과목 목록과 이번 학기 필터.
import { KaistError, ParseError } from '../errors.js';
import type { KlmsSession } from './session.js';

/** AJAX core_course_get_enrolled_courses_by_timeline_classification 의 과목 항목 (쓰는 필드만) */
export interface RawCourse {
  id: number;
  fullname: string;
  shortname: string;
  startdate: number;
  enddate: number;
  coursecategory?: string;
  viewurl?: string;
}

export interface Semester {
  year: number;
  /** shortname 접미사의 학기 코드 (봄=1, 가을=3 확인됨) */
  term: number;
  /** 폴더 이름용, 예: "2026-가을" */
  label: string;
}

export interface Course {
  id: number;
  /** 학기 접미사를 뗀 과목 코드, 예: "MAS.20050(B)" */
  code: string;
  name: string;
  shortname: string;
  category: string | null;
  startdate: number;
  enddate: number;
  url: string;
}

const SUFFIX = /_(\d{4})_(\d)$/;
const TERM_NAMES: Record<string, string> = { spring: '봄', summer: '여름', fall: '가을', autumn: '가을', winter: '겨울' };
const TERM_BY_CODE: Record<number, string> = { 1: '봄', 3: '가을' }; // 0단계에서 확인된 것만

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

function termLabel(year: number, term: number, category: string | null): string {
  const byCat = category ? TERM_NAMES[category.trim().toLowerCase()] : undefined;
  return `${year}-${byCat ?? TERM_BY_CODE[term] ?? `학기${term}`}`;
}

/**
 * 진행 중인 학기 과목만 고른다. 순수 함수 (테스트용).
 * 기준: shortname이 `_<연도>_<학기>`로 끝나고, startdate ≤ now ≤ enddate.
 * 여러 학기가 겹치면 시작일이 가장 늦은 학기를 고른다.
 */
export function filterCurrentSemester(raw: RawCourse[], nowSec: number): { semester: Semester; courses: Course[] } {
  const current = raw.filter(c => SUFFIX.test(c.shortname) && c.startdate > 0 && c.startdate <= nowSec && c.enddate > 0 && nowSec <= c.enddate);
  if (current.length === 0) {
    throw new KaistError('NO_CURRENT_COURSES', `이번 학기 과목을 찾지 못했습니다 (전체 ${raw.length}개 중 0개). 학기 판별 규칙이 KLMS와 맞지 않을 수 있습니다.`);
  }
  const groups = new Map<string, RawCourse[]>();
  for (const c of current) {
    const [, y, t] = c.shortname.match(SUFFIX)!;
    const key = `${y}_${t}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const [key, members] = [...groups.entries()].sort((a, b) =>
    Math.max(...b[1].map(c => c.startdate)) - Math.max(...a[1].map(c => c.startdate)))[0]!;
  const [year, term] = key.split('_').map(Number) as [number, number];
  const category = members.find(c => c.coursecategory)?.coursecategory ?? null;
  const semester: Semester = { year, term, label: termLabel(year, term, category) };
  const courses = members
    .map<Course>(c => ({
      id: c.id,
      code: c.shortname.replace(SUFFIX, ''),
      name: decodeEntities(c.fullname).trim(),
      shortname: c.shortname,
      category: c.coursecategory ?? null,
      startdate: c.startdate,
      enddate: c.enddate,
      url: c.viewurl ?? `https://klms.kaist.ac.kr/course/view.php?id=${c.id}`,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { semester, courses };
}

export async function fetchCurrentCourses(session: KlmsSession, nowSec = Math.floor(Date.now() / 1000)) {
  const data = await session.ajax<{ courses?: RawCourse[] }>('core_course_get_enrolled_courses_by_timeline_classification', {
    offset: 0, limit: 0, classification: 'inprogress', sort: 'fullname',
  });
  if (!Array.isArray(data?.courses)) throw new ParseError('수강 과목 AJAX', '`courses` 배열이 없습니다');
  for (const c of data.courses) {
    if (typeof c.id !== 'number' || typeof c.shortname !== 'string' || typeof c.startdate !== 'number') {
      throw new ParseError('수강 과목 AJAX', '과목 항목에 id/shortname/startdate가 없습니다');
    }
  }
  return filterCurrentSemester(data.courses, nowSec);
}
