// 내장 AI가 학사 일정 후보를 해석해 "제안"을 만든다. 자동 등록은 하지 않는다 — 사용자가 확인하면 등록(결정 8).
// 제안: 처리 안 한 후보(status='new') 중 과목이 붙은 것을 로컬 모델로 뽑아 verifyEvent(dryRun)로 검사.
// 등록: addSchoolEvent(confirmed:true) 재사용 → 사용자가 누를 때만. 무시: 후보를 dismissed로.
import { openDb } from '../store/db.js';
import { addSchoolEvent } from '../events/register.js';
import { setCandidateStatus, type Kind } from '../events/candidates.js';
import { getAiProvider } from './provider.js';

export interface EventSuggestion {
  candidateId: number;
  course: string;
  courseName: string;
  kind: Kind;
  date: string;
  start: string | null;
  quote: string;
  grade: 'A' | 'B';
  reasons: string[];
  snippet: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    isEvent: { type: 'boolean' },
    kind: { type: 'string', enum: ['exam', 'no_class', 'online', 'makeup', 'none'] },
    date: { type: 'string' },
    start: { type: 'string' },
    quote: { type: 'string' },
  },
  required: ['isEvent', 'kind', 'date', 'start', 'quote'],
} as const;

const SYS = '너는 대학 공지에서 학사 일정만 뽑는다. 종류는 시험(exam), 휴강(no_class), 온라인수업(online), 보강(makeup). 일정이 아니면 isEvent=false, kind="none". date는 YYYY-MM-DD(올해 2026, 학기 8~12월). start는 시각 있으면 HH:MM, 없으면 "". quote는 날짜/일정이 적힌 문장을 원문에서 글자 그대로.';

interface Row { id: number; context: string | null; snippet: string; courseCode: string; courseName: string }

export async function suggestEvents(opts: { all?: boolean; onStatus?: (m: string) => void } = {}): Promise<EventSuggestion[]> {
  const onStatus = opts.onStatus;
  const db = openDb();
  // 기본은 처리 안 한 후보만. --all은 검증용(상태 무관, 등록은 안 함)
  const where = opts.all ? "c.active = 1" : "ec.status = 'new' and c.active = 1";
  const cands = db.prepare(`select ec.id, ec.context, ec.snippet, c.code courseCode, c.name courseName
    from event_candidates ec join courses c on c.id = ec.course_id
    where ${where} order by ec.id`).all() as unknown as Row[];
  if (cands.length === 0) return [];
  const p = await getAiProvider();
  await p.ensureReady?.(onStatus);
  const out: EventSuggestion[] = [];
  let i = 0;
  for (const c of cands) {
    i++;
    onStatus?.(`공지 분석 중 ${i}/${cands.length}`);
    let r: { isEvent: boolean; kind: string; date: string; start: string; quote: string } | null = null;
    try { r = await p.completeJson(SYS, `공지:\n"""${(c.context || c.snippet).slice(0, 1500)}"""`, SCHEMA as object, { maxTokens: 160 }); } catch { r = null; }
    if (!r || !r.isEvent || r.kind === 'none' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    try {
      const res = await addSchoolEvent({ course: c.courseCode, kind: r.kind as Kind, date: r.date, start: r.start || undefined, quote: r.quote, fromCandidate: c.id, dryRun: true });
      if (!res.verdict.ok) continue; // 검사(원문 대조·요일·학기) 실패면 제안하지 않는다
      out.push({
        candidateId: c.id, course: c.courseCode, courseName: c.courseName, kind: r.kind as Kind, date: r.date,
        start: r.start || res.timeFromTimetable?.split('~')[0] || null, quote: r.quote,
        grade: res.verdict.grade, reasons: res.verdict.needsConfirmReasons, snippet: c.snippet.slice(0, 140),
      });
    } catch { /* 이미 있거나 등록 불가 → 제안 제외 */ }
  }
  return out;
}

/** 사용자가 확인한 제안을 등록 (confirmed: true — 자동 아님) */
export async function registerSuggestion(s: { candidateId: number; course: string; kind: Kind; date: string; start?: string; quote: string }) {
  return addSchoolEvent({ course: s.course, kind: s.kind, date: s.date, start: s.start || undefined, quote: s.quote, fromCandidate: s.candidateId, confirmed: true });
}

export function dismissSuggestion(candidateId: number): void {
  setCandidateStatus(candidateId, 'dismissed', 'AI 제안 무시(사용자)');
}
