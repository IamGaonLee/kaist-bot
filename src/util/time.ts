// KLMS 날짜 문자열 → 유닉스 초. 시간대는 항상 Asia/Seoul(UTC+9, 서머타임 없음) 고정.
const KST_OFFSET_H = 9;

const kst = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h - KST_OFFSET_H, mi) / 1000;

/** "2026-09-15 00:00" → 유닉스 초 */
export function parseDashKst(text: string): number | null {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  return kst(+m[1]!, +m[2]!, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

/** 과목 페이지 strong.end-dt: "A ~ B" 또는 " ~ B" */
export function parseEndDt(text: string): { start: number | null; end: number | null } | null {
  const parts = text.split('~');
  if (parts.length !== 2) return null;
  const [a = '', b = ''] = parts.map(s => s.trim());
  const start = a ? parseDashKst(a) : null;
  const end = b ? parseDashKst(b) : null;
  if ((a && start === null) || (b && end === null)) return null;
  return { start, end };
}

/**
 * "2026년 9월 15일(화요일) 오전 12:00" → 유닉스 초.
 * 오전 12:xx = 00:xx, 오후 12:xx = 12:xx.
 */
export function parseKoreanDateTime(text: string): number | null {
  const m = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*\([^)]*\))?\s*(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = +m[5]!;
  if (h < 1 || h > 12) return null;
  if (m[4] === '오전') h = h === 12 ? 0 : h;
  else h = h === 12 ? 12 : h + 12;
  return kst(+m[1]!, +m[2]!, +m[3]!, h, +m[6]!);
}

/** 유닉스 초 → "2026-09-15 00:00" (KST) */
export function formatKst(sec: number): string {
  return new Date((sec + KST_OFFSET_H * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** "7d", "12h", "30m" → 초 */
export function parseDuration(text: string): number {
  const m = text.trim().match(/^(\d+)\s*([dhm])$/i);
  if (!m) throw new Error(`기간 형식이 잘못됐습니다: "${text}" (예: 7d, 12h)`);
  return +m[1]! * ({ d: 86400, h: 3600, m: 60 } as const)[m[2]!.toLowerCase() as 'd' | 'h' | 'm'];
}

export const nowSec = () => Math.floor(Date.now() / 1000);
