// 학사 일정 등록 전 기계 검증과 등급 판정 (S6 설계 1·2절). 순수 함수.
import type { Kind } from './candidates.js';

export interface VerifyInput {
  kind: Kind;
  /** YYYY-MM-DD (KST) */
  date: string;
  /** HH:MM (KST) */
  start?: string;
  end?: string;
  quote: string;
  /** 후보 원문 (manual이면 null) */
  context: string | null;
  sourceType: 'notice' | 'section' | 'assignment' | 'file' | 'mail' | 'manual';
  semester: { start: number; end: number };
  now: number;
  /** 같은 (과목, 종류, 날짜) 일정이 이미 있는지 */
  existing: boolean;
}

export interface Verdict { ok: boolean; errors: string[]; grade: 'A' | 'B'; needsConfirmReasons: string[] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS: [RegExp, number][] = [
  [/\bsun(day)?\b|\(일\)|일요일/i, 0], [/\bmon(day)?\b|\(월\)|월요일/i, 1], [/\btue(s|sday)?\b|\(화\)|화요일/i, 2], [/\bwed(nesday)?\b|\(수\)|수요일/i, 3],
  [/\bthu(r|rs|rsday)?\b|\(목\)|목요일/i, 4], [/\bfri(day)?\b|\(금\)|금요일/i, 5], [/\bsat(urday)?\b|\(토\)|토요일/i, 6],
];

export const normText = (s: string) => s.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

/** 날짜 문자열 → 유닉스 초 (KST 0시), 요일 */
export function dayInfo(date: string): { sec: number; weekday: number } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  if (Number.isNaN(ms)) return null;
  return { sec: ms / 1000 - 9 * 3600, weekday: new Date(ms).getUTCDay() };
}

/** 인용문에 월·일이 절대 날짜로 적혀 있는지 */
export function quoteHasDate(quote: string, date: string): boolean {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const q = normText(quote);
  const M = `0?${mo}`;
  const D = `0?${d}`;
  const mon = MONTHS[mo - 1]!;
  const pats = [
    `(?<!\\d)${M}\\s*[/.]\\s*${D}(?![\\d])`,
    `(?<!\\d)${M}\\s*월\\s*${D}\\s*일`,
    `\\b${mon}[a-z]*\\.?\\s+${D}(st|nd|rd|th)?\\b`,
    `(?<!\\d)${D}(st|nd|rd|th)?\\s+${mon}[a-z]*\\b`,
    `${y}\\s*[-./]\\s*${M}\\s*[-./]\\s*${D}(?!\\d)`,
  ];
  return pats.some(p => new RegExp(p, 'i').test(q));
}

/** 인용문에 시작 시각이 적혀 있는지 (13:00, 1:00 PM, 오후 1시, 13시 등) */
export function quoteHasTime(quote: string, hhmm: string): boolean {
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const q = normText(quote).replace(/\s*\.\s*m\.?/g, 'm').replace(/a\.m|p\.m/g, s => s.replace('.', ''));
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ap = h < 12 ? '(am|오전)' : '(pm|오후)';
  const mm = String(mi).padStart(2, '0');
  const pats = [
    `(?<!\\d)0?${h}\\s*:\\s*${mm}(?!\\d)`,
    `${ap}\\s*0?${h12}\\s*(:\\s*${mm}|시)`,
    `(?<!\\d)0?${h12}\\s*(:\\s*${mm})?\\s*${ap}`,
    mi === 0 ? `(?<!\\d)0?${h}\\s*시` : `(?<!\\d)0?${h}\\s*시\\s*${mi}\\s*분`,
  ];
  return pats.some(p => new RegExp(p, 'i').test(q));
}

export function verifyEvent(i: VerifyInput): Verdict {
  const errors: string[] = [];
  const confirm: string[] = [];
  const day = dayInfo(i.date);
  if (!day) return { ok: false, errors: [`날짜 형식은 YYYY-MM-DD여야 합니다: "${i.date}"`], grade: 'B', needsConfirmReasons: [] };
  for (const t of [i.start, i.end]) if (t !== undefined && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) errors.push(`시각 형식은 HH:MM이어야 합니다: "${t}"`);
  const pad = (t: string) => t.padStart(5, '0');
  if (i.start && i.end && pad(i.end) <= pad(i.start)) errors.push('끝 시각이 시작 시각보다 뒤여야 합니다');
  if (i.end && !i.start) errors.push('끝 시각만 있고 시작 시각이 없습니다');

  // (i) 인용문이 실제 원문에 있는지 (지어낸 값 차단)
  if (i.sourceType !== 'manual') {
    if (!i.quote.trim()) errors.push('--quote(원문 인용)가 필요합니다');
    else if (!i.context || !normText(i.context).includes(normText(i.quote))) errors.push('인용문이 후보 원문에 없습니다 (원문을 그대로 복사해야 함)');
  }
  // (ii) 인용문의 요일과 날짜의 요일이 맞는지
  const wds = WEEKDAYS.filter(([r]) => r.test(i.quote)).map(([, n]) => n);
  if (wds.length > 0 && !wds.includes(day.weekday)) errors.push(`인용문의 요일과 ${i.date}의 요일이 맞지 않습니다`);
  // (iii) 학기 범위 안, 미래 또는 지난 지 7일 이내
  if (day.sec < i.semester.start || day.sec > i.semester.end + 31 * 86400) errors.push(`${i.date}는 이번 학기 범위 밖입니다`);
  if (day.sec + 86400 < i.now - 7 * 86400) errors.push(`${i.date}는 이미 7일 넘게 지난 날짜입니다`);

  // 등급: A는 확인 없이 등록 (사용자 결정: 처음부터 자동)
  if (!['notice', 'section'].includes(i.sourceType)) confirm.push(i.sourceType === 'manual' ? '직접 입력' : i.sourceType === 'file' ? '강의계획서·파일 출처' : i.sourceType === 'mail' ? '메일 출처' : '과제 설명 출처');
  if (!['exam', 'no_class', 'online'].includes(i.kind)) confirm.push('보강·기타 종류');
  if (!quoteHasDate(i.quote, i.date)) confirm.push('인용문에 날짜가 절대 표기로 없음 (요일·상대 표현 해석)');
  if (i.kind === 'exam' && !i.start) confirm.push('시험 시각 미상');
  if (i.start && !quoteHasTime(i.quote, i.start)) confirm.push('인용문에 시작 시각이 없음');
  if (i.existing) confirm.push('같은 과목·종류·날짜 일정이 이미 있음 (변경)');
  return { ok: errors.length === 0, errors, grade: confirm.length === 0 ? 'A' : 'B', needsConfirmReasons: confirm };
}
