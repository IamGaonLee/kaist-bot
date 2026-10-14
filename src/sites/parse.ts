// 포털·생활관 응답 파서 (순수 함수). 구조가 예상과 다르면 ParseError를 낸다.
// 개인정보: 이름·학번·금액은 읽지 않는다. 생활관 배정 정보는 학기·생활관·입사/퇴사일·거주기간만 꺼낸다.
import * as cheerio from 'cheerio';
import { ParseError } from '../errors.js';

// ---------- 시간표 (포털 stulist, 30분 칸) ----------

export interface ClassSlot {
  /** KLMS 과목 코드와 같은 형식: 과목코드 + (분반) */
  courseCode: string;
  subjectName: string;
  /** 1=월 ... 7=일 */
  weekday: number;
  start: string;
  end: string;
  building: string;
  room: string;
}

interface StulistRow { subjtCd?: string; corseDvclsNo?: string | null; daywDivCd?: string | number; lessnNm?: string; lessnNmEnd?: string; subjtNm?: string; buldNm?: string; lecrmNm?: string; lessnLestmDivCd?: string }

const HHMM = /^\d{2}:\d{2}$/;

/** 30분 칸을 (과목, 요일)별로 합친다. 포털 daywDivCd는 1=일, 2=월 ... 7=토 */
export function parseStulist(json: unknown): ClassSlot[] {
  const rows = (json as { data?: unknown }).data;
  if (!Array.isArray(rows)) throw new ParseError('포털 시간표', 'data 배열이 없습니다');
  const groups = new Map<string, StulistRow[]>();
  for (const r of rows as StulistRow[]) {
    if (!r.subjtCd || !r.lessnNm || !r.lessnNmEnd || r.daywDivCd === undefined) throw new ParseError('포털 시간표', '칸에 과목코드·요일·시각이 없습니다');
    if (!HHMM.test(r.lessnNm) || !HHMM.test(r.lessnNmEnd)) throw new ParseError('포털 시간표', `시각 형식이 다릅니다: ${r.lessnNm}`);
    const code = r.subjtCd + (r.corseDvclsNo ? `(${r.corseDvclsNo})` : '');
    const key = `${code}|${r.daywDivCd}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: ClassSlot[] = [];
  for (const [key, rs] of groups) {
    const [code, dw] = key.split('|') as [string, string];
    const d = Number(dw);
    if (!(d >= 1 && d <= 7)) throw new ParseError('포털 시간표', `요일 코드가 다릅니다: ${dw}`);
    // 같은 요일에 떨어진 두 수업이면 칸이 이어지지 않는다 → 이어진 구간마다 나눈다
    const sorted = [...rs].sort((a, b) => a.lessnNm!.localeCompare(b.lessnNm!));
    let cur: ClassSlot | null = null;
    for (const r of sorted) {
      if (cur && cur.end >= r.lessnNm!) { if (r.lessnNmEnd! > cur.end) cur.end = r.lessnNmEnd!; continue; }
      cur = { courseCode: code, subjectName: r.subjtNm ?? '', weekday: d === 1 ? 7 : d - 1, start: r.lessnNm!, end: r.lessnNmEnd!, building: r.buldNm ?? '', room: (r.lecrmNm ?? '').replace(/^\((.*?)\)강의실.*$/, '$1') };
      out.push(cur);
    }
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
}

// ---------- 학사일정 (포털 collegePlan) ----------

export interface PlanItem { schdlNo: string; title: string; startDate: string; endDate: string; cldrNo: string }

const ymd = (s: string) => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;

export function parseCollegePlan(json: unknown): PlanItem[] {
  const rows = (json as { data?: unknown }).data;
  if (!Array.isArray(rows)) throw new ParseError('포털 학사일정', 'data 배열이 없습니다');
  return (rows as Record<string, unknown>[]).map(r => {
    const s = ymd(String(r.bgngDt ?? '')), e = ymd(String(r.endDt ?? ''));
    if (!r.schdlNo || !r.schdlTtl || !s || !e) throw new ParseError('포털 학사일정', `일정 필드가 다릅니다 (${String(r.schdlNo)})`);
    return { schdlNo: String(r.schdlNo), title: String(r.schdlTtl).trim(), startDate: s, endDate: e, cldrNo: String(r.cldrNo ?? '') };
  });
}

/** 학사과정 달력. 39는 같은 일정의 대학원 사본, 57은 전·후반 학기제 달력이라 쓰지 않는다 (S8a 검증) */
export const UNDERGRAD_CALENDAR = '38';

/**
 * 자동 등록할 주요 일정 (사용자 결정 2: 수강신청·변경·취소, 시험 기간, 휴일, 개강·종강, 성적, 등록금).
 * 학사과정에 해당하지 않는 것(대학원·옛 학번·여름학기·외국인 등)은 뺀다.
 */
export function isMajorPlan(p: PlanItem): boolean {
  if (p.cldrNo !== UNDERGRAD_CALENDAR) return false;
  const t = p.title;
  const include = /수강신청|개강|종강|중간고사|학기말 시험|기말고사|납입금|등록금|성적.*(공시|입력 마감)|휴강|휴일|공휴일|휴업/;
  const exclude = /여름학기|외국인|학점인정시험|학위|논문|개설\(안\)|2007, 2008 학번|^석·박사|^박사/;
  return include.test(t) && !exclude.test(t);
}

// ---------- 생활관 (kds) ----------

export interface DormInfo {
  semester: string | null;
  dorm: string | null;
  moveIn: string | null;
  moveOut: string | null;
  /** YYYY-MM (월까지만 표시됨) */
  residenceEnd: string | null;
}

const DORM_LABELS: Record<string, keyof DormInfo> = { 학기: 'semester', 배정생활관: 'dorm', 입사일: 'moveIn', 퇴사일: 'moveOut', 거주기간만료: 'residenceEnd' };

const dotDate = (s: string | null) => {
  const m = s?.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})$/);
  return m ? `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}` : null;
};

/** 배정 정보 HTML (dl > dt/dd). 필요한 칸만 읽는다 */
export function parseDormInfo(html: string): DormInfo {
  const $ = cheerio.load(html);
  const box = $('.info-ulbox');
  if (!box.length) throw new ParseError('생활관 배정 정보', '.info-ulbox가 없습니다');
  const raw: Partial<Record<keyof DormInfo, string>> = {};
  box.find('dl').each((_, dl) => {
    const label = $(dl).find('dt').first().text().replace(/\s+/g, '');
    const key = DORM_LABELS[label];
    if (key) raw[key] = $(dl).find('dd').first().text().replace(/\s+/g, ' ').trim();
  });
  if (!('moveIn' in raw) || !('dorm' in raw)) throw new ParseError('생활관 배정 정보', '입사일·배정생활관 칸을 찾지 못했습니다');
  const val = (s: string | undefined) => (!s || s === '-' ? null : s);
  const res = val(raw.residenceEnd)?.match(/^(\d{4})\.\s*(\d{1,2})/);
  return {
    semester: val(raw.semester),
    dorm: val(raw.dorm),
    moveIn: dotDate(val(raw.moveIn)) ?? val(raw.moveIn),
    moveOut: dotDate(val(raw.moveOut)) ?? val(raw.moveOut),
    residenceEnd: res ? `${res[1]}-${res[2]!.padStart(2, '0')}` : val(raw.residenceEnd),
  };
}

export interface DormScheduleItem { id: string; title: string; startDate: string | null; endDate: string | null; dorm: string | null }

export function parseDormSchedule(json: unknown): DormScheduleItem[] {
  const rows = (json as { semesterScheduleList?: unknown }).semesterScheduleList;
  if (!Array.isArray(rows)) throw new ParseError('생활관 일정', 'semesterScheduleList 배열이 없습니다');
  return (rows as Record<string, unknown>[]).map(r => {
    if (!r.calendarId || !r.calendarCn) throw new ParseError('생활관 일정', '일정 id·내용이 없습니다');
    return { id: String(r.calendarId), title: String(r.calendarCn).trim(), startDate: (r.calendarBeginDe as string) ?? null, endDate: (r.calendarEndDe as string) ?? null, dorm: (r.dormNmCodeNm as string) ?? null };
  });
}

// ---------- 포털 공지 (board/recents) ----------
// 작성자 이름·메일·ID는 읽지 않는다. 부서명만 쓴다.

export interface BoardPost {
  pstNo: number;
  boardNo: number;
  title: string;
  dept: string | null;
  /** "2026.10.13 09:55:28" (KST) */
  regDt: string;
  chgDt: string;
  pinned: boolean;
  atchCount: number;
}

export interface PostDetail extends BoardPost {
  bodyHtml: string;
  attachments: { name: string; size: number }[];
}

const PORTAL_DT = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** 포털 날짜 문자열(KST) → epoch 초 */
export function portalDtToSec(text: string): number {
  const m = PORTAL_DT.exec(text);
  if (!m) throw new ParseError('포털 공지', `날짜 형식이 다릅니다: ${text}`);
  return Math.floor(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) / 1000);
}

function toPost(r: Record<string, unknown>, where: string): BoardPost {
  if (typeof r.pstNo !== 'number' || typeof r.boardNo !== 'number' || typeof r.pstTtl !== 'string' || typeof r.regDt !== 'string') {
    throw new ParseError(where, '글에 pstNo·boardNo·pstTtl·regDt가 없습니다');
  }
  const regDt = r.regDt;
  const chgDt = typeof r.chgDt === 'string' && r.chgDt ? r.chgDt : regDt;
  portalDtToSec(regDt);
  portalDtToSec(chgDt);
  return {
    pstNo: r.pstNo, boardNo: r.boardNo, title: r.pstTtl.trim(),
    dept: typeof r.pstWrtrDeptNm === 'string' && r.pstWrtrDeptNm ? r.pstWrtrDeptNm : null,
    regDt, chgDt, pinned: r.ntcYn === 'Y', atchCount: typeof r.atchFileCnt === 'number' ? r.atchFileCnt : 0,
  };
}

/** 목록 응답 → 글 + 전체 개수 */
export function parseBoardList(json: unknown): { posts: BoardPost[]; totalRecord: number } {
  const j = json as { data?: unknown; page?: { totalRecord?: unknown } };
  if (!Array.isArray(j.data)) throw new ParseError('포털 공지 목록', 'data 배열이 없습니다');
  if (typeof j.page?.totalRecord !== 'number') throw new ParseError('포털 공지 목록', 'page.totalRecord가 없습니다');
  return { posts: (j.data as Record<string, unknown>[]).map(r => toPost(r, '포털 공지 목록')), totalRecord: j.page.totalRecord };
}

/** 본문 응답 (board/recents/{pstNo}) */
export function parsePostDetail(json: unknown, expectPstNo: number): PostDetail {
  const r = json as Record<string, unknown>;
  const post = toPost(r, '포털 공지 본문');
  if (post.pstNo !== expectPstNo) throw new ParseError('포털 공지 본문', `요청한 글(${expectPstNo})과 다른 글(${post.pstNo})이 왔습니다`);
  if (typeof r.pstCn !== 'string') throw new ParseError('포털 공지 본문', 'pstCn(본문)이 없습니다');
  const list = Array.isArray(r.boardAtchList) ? r.boardAtchList as Record<string, unknown>[] : [];
  return {
    ...post, bodyHtml: r.pstCn,
    attachments: list.map(a => ({ name: String(a.atchFileNm ?? ''), size: typeof a.atchFileSize === 'number' ? a.atchFileSize : 0 })).filter(a => a.name),
  };
}
