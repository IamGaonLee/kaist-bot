// E3 평가: 로컬 모델로 저장된 학사 일정 후보에서 일정을 추출하고, verifyEvent로 채점.
// 핵심 지표: 일정이 아닌 후보(dismissed)가 A로 잘못 자동 등록되는 수(목표 0). 개인정보는 출력하지 않는다(인용 길이만).
import { openDb } from '../../src/store/db.js';
import { verifyEvent } from '../../src/events/verify.js';
import { getAiProvider } from '../../src/ai/provider.js';
import type { Kind } from '../../src/events/candidates.js';
type VerifyInputSource = 'notice' | 'section' | 'assignment' | 'file' | 'mail' | 'manual';

const db = openDb();
const sem = db.prepare('select min(startdate) s, max(enddate) e from courses where active=1').get() as { s: number; e: number };
const semester = { start: sem.s, end: sem.e };
const now = Math.floor(Date.now() / 1000);
const cands = db.prepare(`select id, source_type sourceType, snippet, context, kind_hint kindHint, source_posted_at postedAt, status, linked_event_id linked from event_candidates order by id`).all() as {
  id: number; sourceType: string; snippet: string; context: string; kindHint: string | null; postedAt: number | null; status: string; linked: number | null;
}[];

const schema = {
  type: 'object',
  properties: {
    isEvent: { type: 'boolean' },
    kind: { type: 'string', enum: ['exam', 'no_class', 'online', 'makeup', 'none'] },
    date: { type: 'string' },   // YYYY-MM-DD 또는 ""
    start: { type: 'string' },  // HH:MM 또는 ""
    quote: { type: 'string' },  // 원문에서 그대로
  },
  required: ['isEvent', 'kind', 'date', 'start', 'quote'],
} as const;

const SYS = '너는 대학 공지에서 학사 일정만 뽑는다. 학사 일정은 시험(exam), 휴강(no_class), 온라인수업(online), 보강(makeup)이다. 일정이 아니면 isEvent=false, kind="none". 날짜는 YYYY-MM-DD(올해 2026년, 학기는 2026-08~12월). start는 시각이 있으면 HH:MM, 없으면 "". quote는 날짜/일정이 적힌 문장을 원문에서 글자 그대로 복사.';

const p = await getAiProvider();
await p.ensureReady?.(m => console.error(m));

let wrongAutoA = 0;     // 일정 아님(dismissed)인데 A
let correctEventA = 0;  // 실제 일정(linked)인데 A
let proposedOnReal = 0; // 실제 일정에 대해 일정이라고 제안
const linkedTotal = cands.filter(c => c.status === 'linked').length;
const dismissedTotal = cands.filter(c => c.status === 'dismissed').length;
let i = 0;
for (const c of cands) {
  i++;
  let r: { isEvent: boolean; kind: string; date: string; start: string; quote: string };
  try {
    r = await p.completeJson(SYS, `공지 후보:\n"""${(c.context || c.snippet).slice(0, 1500)}"""`, schema as object, { maxTokens: 160 });
  } catch { r = { isEvent: false, kind: 'none', date: '', start: '', quote: '' }; }
  let grade = '-';
  if (r.isEvent && r.kind !== 'none' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    const v = verifyEvent({
      kind: r.kind as Kind, date: r.date, start: r.start || undefined, quote: r.quote,
      context: c.context, sourceType: c.sourceType as VerifyInputSource, semester, now, existing: false,
    });
    const gated = v.ok && v.grade === 'A' && p.name === 'local' ? 'B' : v.grade; // 결정 8: 로컬 제안은 자동 A 금지
    grade = v.ok ? gated : 'reject';
    if (v.ok && gated === 'A') { if (c.status === 'linked') correctEventA++; else wrongAutoA++; }
    if (v.ok && c.status === 'linked') proposedOnReal++;
  }
  console.error(`[${i}/${cands.length}] #${c.id} ${c.status.padEnd(9)} src=${c.sourceType.padEnd(8)} → isEvent=${r.isEvent} kind=${r.kind} date=${r.date || '-'} grade=${grade}`);
}

type VerifyInputSource = 'notice' | 'section' | 'assignment' | 'file' | 'mail' | 'manual';
console.log('\n=== 결과 ===');
console.log(`후보 ${cands.length} (실제 일정 linked ${linkedTotal}, 일정 아님 dismissed ${dismissedTotal})`);
console.log(`잘못 자동 등록된 A등급(일정 아닌데 A): ${wrongAutoA}  ← 목표 0`);
console.log(`실제 일정에 A등급: ${correctEventA} / ${linkedTotal}`);
console.log(`실제 일정을 '일정'이라 제안(등급 무관): ${proposedOnReal} / ${linkedTotal}`);
await p.dispose?.();
