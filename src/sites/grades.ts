// S8d 성적 (민감 정보, 설계 docs/portal-design.md 5절)
// - ERP에는 `kaist grades --refresh`로만 접속한다. sync는 이 파일을 쓰지 않는다.
// - 저장은 로컬 DB(grade_terms, grade_courses)에만. 드라이브·요약·PDF·캘린더·changes·로그·오류 메시지에 값을 넣지 않는다.
//   grade_* 테이블은 이 파일에서만 읽고 쓴다 (tests/grades.test.ts가 확인).
// - 학번(stuno)·백분율 점수·영어 성적 등 필요 없는 칸은 읽지 않는다.
import { KaistError, ParseError, SessionExpiredError } from '../errors.js';
import { SessionStore } from '../klms/session-store.js';
import { getMeta, openDb, setMeta, tx } from '../store/db.js';
import { SiteHttp } from './http.js';
import { loginAll } from './session.js';
import { ERP_GRADES_FORM } from './sites.js';

export interface GradeCourse { year: string; termCode: string; courseCode: string; section: string | null; name: string; credits: number; grade: string; category: string | null }
export interface GradeTerm { year: string; termCode: string; termName: string; gpa: number | null; appliedCredits: number | null; earnedCredits: number | null }

const TERM_NAME: Record<string, string> = { '1': '봄학기', '2': '여름학기', '3': '가을학기', '4': '겨울학기' };
const WHERE = 'ERP 성적';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);

/** 응답 → 과목별·학기별. 오류 메시지에는 값을 넣지 않는다 */
export function parseGrades(json: unknown): { courses: GradeCourse[]; terms: GradeTerm[] } {
  const j = json as { dsSgra100?: unknown; dsSgra120?: unknown; dsSyySmt?: unknown };
  if (!Array.isArray(j.dsSgra100) || !Array.isArray(j.dsSgra120)) throw new ParseError(WHERE, 'dsSgra100(과목)·dsSgra120(학기) 배열이 없습니다');
  const names = new Map<string, string>();
  for (const s of Array.isArray(j.dsSyySmt) ? j.dsSyySmt as Record<string, unknown>[] : []) {
    if (str(s.syy) && str(s.smtDivCd) && str(s.syySmtNm)) names.set(`${str(s.syy)}|${str(s.smtDivCd)}`, str(s.syySmtNm));
  }
  const courses = (j.dsSgra100 as Record<string, unknown>[]).map((r, i) => {
    const credits = num(r.cdt);
    if (!str(r.syy) || !str(r.smtDivCd) || !str(r.subjtCd) || !str(r.subjtNm) || credits === null || !str(r.gradeDivCd)) {
      throw new ParseError(WHERE, `과목 ${i + 1}번째 행에 연도·학기·과목코드·이름·학점·등급 중 빠진 칸이 있습니다`);
    }
    return { year: str(r.syy), termCode: str(r.smtDivCd), courseCode: str(r.subjtCd), section: str(r.corseDvclsNo) || null, name: str(r.subjtNm), credits, grade: str(r.gradeDivCd), category: str(r.subjcDivNm) || null };
  });
  const terms = (j.dsSgra120 as Record<string, unknown>[]).map((r, i) => {
    const year = str(r.syy), termCode = str(r.smtDivCd);
    if (!year || !termCode) throw new ParseError(WHERE, `학기 ${i + 1}번째 행에 연도·학기 코드가 없습니다`);
    const gpaText = str(r.gpa);
    const gpa = num(gpaText);
    if (gpa === null && gpaText !== '-' && gpaText !== '') throw new ParseError(WHERE, `학기 ${i + 1}번째 행의 평점 형식이 다릅니다`);
    return { year, termCode, termName: names.get(`${year}|${termCode}`) ?? `${year}년 ${TERM_NAME[termCode] ?? `학기코드 ${termCode}`}`, gpa, appliedCredits: num(r.aplyCdt), earnedCredits: num(r.cmpsjCdt) };
  });
  return { courses, terms };
}

/** 학기 평점 × 평점 반영 학점의 가중 평균 (재수강 등은 반영하지 못해 공식값과 다를 수 있음) */
export function cumulativeGpa(terms: GradeTerm[]): { gpa: number | null; credits: number; computed: true; note: string } {
  const used = terms.filter(t => t.gpa !== null && (t.appliedCredits ?? 0) > 0);
  const credits = used.reduce((a, t) => a + t.appliedCredits!, 0);
  const gpa = credits > 0 ? Math.round((used.reduce((a, t) => a + t.gpa! * t.appliedCredits!, 0) / credits) * 100) / 100 : null;
  return { gpa, credits, computed: true, note: '학기별 평점으로 계산한 값입니다. 공식 누적 평점은 ERP에서 확인하세요.' };
}

export function saveGrades(courses: GradeCourse[], terms: GradeTerm[]): void {
  const db = openDb();
  const now = new Date().toISOString();
  tx(() => {
    db.exec('delete from grade_courses; delete from grade_terms;');
    const ic = db.prepare('insert into grade_courses(year, term_code, course_code, section, name, credits, grade, category, fetched_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of courses) ic.run(c.year, c.termCode, c.courseCode, c.section, c.name, c.credits, c.grade, c.category, now);
    const it = db.prepare('insert into grade_terms(year, term_code, term_name, gpa, applied_credits, earned_credits, fetched_at) values(?, ?, ?, ?, ?, ?, ?) on conflict(year, term_code) do update set term_name = excluded.term_name, gpa = excluded.gpa, applied_credits = excluded.applied_credits, earned_credits = excluded.earned_credits, fetched_at = excluded.fetched_at');
    for (const t of terms) it.run(t.year, t.termCode, t.termName, t.gpa, t.appliedCredits, t.earnedCredits, now);
  });
  setMeta('grades_fetched_at', now);
}

async function fetchOnce(store: SessionStore): Promise<{ courses: GradeCourse[]; terms: GradeTerm[] }> {
  const session = store.forSite('erp').load();
  if (!session) throw new SessionExpiredError('ERP (로그인한 적 없음)');
  const http = new SiteHttp('erp', session, store.forSite('erp'));
  const r = await http.request('/sch/sgra/SgrassCtr/findStdntEtcGradeList.do', { method: 'POST', body: ERP_GRADES_FORM, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
  // 만료되면 JSON 대신 HTML이 온다 (S8a 검증)
  if (r.status >= 300 && r.status < 400 || !r.contentType.includes('json')) throw new SessionExpiredError('ERP 성적');
  if (r.status !== 200) throw new KaistError('ERP_ERROR', `ERP 성적 응답이 이상합니다 (HTTP ${r.status})`);
  const parsed = parseGrades(JSON.parse(r.text));
  http.markUsed();
  return parsed;
}

/** ERP에서 다시 받아 로컬에 저장. 만료면 interactive일 때 로그인 창(ERP만, 포털 경유) */
export async function refreshGrades(opts: { interactive?: boolean; onStatus?: (m: string) => void } = {}): Promise<{ courses: number; terms: number }> {
  const store = new SessionStore();
  let g: { courses: GradeCourse[]; terms: GradeTerm[] };
  try { g = await fetchOnce(store); }
  catch (e) {
    if (!(e instanceof SessionExpiredError) || !opts.interactive) throw e;
    opts.onStatus?.('ERP 세션이 만료돼 로그인 창을 엽니다 (폰 승인이 필요할 수 있음)');
    await loginAll({ only: 'erp', onStatus: opts.onStatus, store });
    g = await fetchOnce(store);
  }
  saveGrades(g.courses, g.terms);
  return { courses: g.courses.length, terms: g.terms.length };
}

/** 로컬에 저장된 성적 (접속 없음) */
export function listGrades() {
  const db = openDb();
  const terms = db.prepare('select * from grade_terms order by year, term_code').all() as Record<string, any>[];
  const courses = db.prepare('select * from grade_courses order by year, term_code, id').all() as Record<string, any>[];
  const termViews: (GradeTerm & { courses: Omit<GradeCourse, 'year' | 'termCode'>[] })[] = terms.map(t => ({
    year: t.year, termCode: t.term_code, termName: t.term_name, gpa: t.gpa, appliedCredits: t.applied_credits, earnedCredits: t.earned_credits,
    courses: courses.filter(c => c.year === t.year && c.term_code === t.term_code)
      .map(c => ({ courseCode: c.course_code, section: c.section, name: c.name, credits: c.credits, grade: c.grade, category: c.category })),
  }));
  // 학기 행이 없는 과목(예: 기이수 인정)도 빠뜨리지 않는다
  const orphan = courses.filter(c => !terms.some(t => t.year === c.year && t.term_code === c.term_code));
  return {
    fetchedAt: getMeta('grades_fetched_at'),
    terms: termViews,
    otherCourses: orphan.map(c => ({ year: c.year, termCode: c.term_code, courseCode: c.course_code, name: c.name, credits: c.credits, grade: c.grade, category: c.category })),
    cumulative: cumulativeGpa(termViews),
  };
}
