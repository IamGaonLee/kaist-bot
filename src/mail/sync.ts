// 학교 메일 동기화 (S7): Gmail에서 KAIST 관련 메일만 가져와 로컬 DB에 저장한다.
// 사용자 결정: 본문은 전부 저장(보존 기한 없음), 개인 Gmail 메일은 가져오지 않음.
import { attachmentNames, bodyText, getMessage, header, listMessageIds, type GmailMessage } from '../google/gmail-api.js';
import { getMeta, openDb, setMeta, tx } from '../store/db.js';

/** KAIST에서 전달된 메일 = 발신·수신·참조에 kaist.ac.kr 주소가 있는 메일 */
export const KAIST_QUERY = '{from:kaist.ac.kr to:kaist.ac.kr cc:kaist.ac.kr}';
const CONCURRENCY = 4;

export interface MailSyncResult { fetched: number; newMails: number; direct: number; courseMatched: number; from: string; myAddress: string | null }

const addrs = (v: string | null) => (v ?? '').match(/[\w.+-]+@[\w.-]+/g)?.map(a => a.toLowerCase()) ?? [];
const nameOf = (v: string | null) => (v ?? '').replace(/<[^>]+>/, '').replace(/"/g, '').trim() || null;

interface CourseKey { id: number; code: string; name: string; aliases: string[] }

/** 과목 코드(ME.30061 / ME30061), 과목명, 설정한 별칭(옛 코드 ME361 등)으로 매핑. 순수 함수 */
export function matchCourse(subject: string, body: string, courses: CourseKey[]): { id: number; how: string } | null {
  const hay = `${subject}\n${body.slice(0, 4000)}`;
  const norm = hay.replace(/\s+/g, ' ');
  const hits: { id: number; how: string; inSubject: boolean }[] = [];
  for (const c of courses) {
    const base = c.code.replace(/\(.*\)$/, '');
    const codes = [base, base.replace('.', ''), ...c.aliases];
    for (const k of codes) {
      const re = new RegExp(`(?<![A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i');
      if (re.test(norm)) { hits.push({ id: c.id, how: `code:${k}`, inSubject: re.test(subject) }); break; }
    }
    if (!hits.some(h => h.id === c.id) && c.name.length >= 3 && norm.includes(c.name)) hits.push({ id: c.id, how: 'name', inSubject: subject.includes(c.name) });
  }
  if (hits.length === 0) return null;
  // 여러 과목이 걸리면 제목에 있는 쪽, 그래도 여럿이면 매핑하지 않는다 (학과 전체 공지 등)
  const subj = hits.filter(h => h.inSubject);
  const pick = subj.length === 1 ? subj[0] : hits.length === 1 ? hits[0] : null;
  return pick ? { id: pick.id, how: pick.how } : null;
}

/** 본인 KAIST 주소: 받는 사람이 한 명뿐인 메일에서 가장 많이 나온 kaist 주소 */
function inferMyAddress(msgs: GmailMessage[]): string | null {
  const count = new Map<string, number>();
  for (const m of msgs) {
    const to = addrs(header(m, 'To'));
    if (to.length === 1 && to[0]!.endsWith('@kaist.ac.kr')) count.set(to[0]!, (count.get(to[0]!) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); }
  }));
  return out;
}

export async function syncMail(opts: { runId: number | null; since?: number; onStatus?: (m: string) => void }): Promise<MailSyncResult> {
  const db = openDb();
  const courses = (db.prepare('select id, code, name, startdate from courses where active = 1').all() as { id: number; code: string; name: string; startdate: number }[]);
  const aliases = JSON.parse(getMeta('mail_course_aliases') ?? '{}') as Record<string, string>; // {"ME361": "ME.30061"}
  const keys: CourseKey[] = courses.map(c => ({ id: c.id, code: c.code, name: c.name, aliases: Object.entries(aliases).filter(([, v]) => v === c.code).map(([k]) => k) }));

  // 기준 시각: 지정값 > 마지막으로 받은 메일 − 1일 > 학기 시작
  const last = (db.prepare('select max(received_at) t from mails').get() as { t: number | null }).t;
  const semStart = Math.min(...courses.map(c => c.startdate).filter(Boolean));
  const sinceSec = opts.since ?? (last ? last - 86400 : semStart);
  const d = new Date((sinceSec + 9 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, '/');
  const q = `${KAIST_QUERY} after:${d}`;
  opts.onStatus?.('메일 목록 확인 중...');
  const ids = await listMessageIds(q);
  const known = new Set((db.prepare('select id from mails').all() as { id: string }[]).map(r => r.id));
  const fresh = ids.filter(id => !known.has(id));
  if (fresh.length) opts.onStatus?.(`새 메일 ${fresh.length}통 받는 중...`);
  const msgs = await pool(fresh, CONCURRENCY, id => getMessage(id));

  let my = getMeta('mail_my_address');
  if (!my) { my = inferMyAddress(msgs); if (my) setMeta('mail_my_address', my); }

  const res: MailSyncResult = { fetched: ids.length, newMails: 0, direct: 0, courseMatched: 0, from: d, myAddress: my };
  const ins = db.prepare(`insert into mails(id, thread_id, received_at, from_addr, from_name, to_addrs, cc_addrs, subject, snippet, body_text, attachments_json, label_ids,
      course_id, course_match, direct, first_seen_sync_id, created_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing`);
  tx(() => {
    for (const m of msgs) {
      const subject = header(m, 'Subject') ?? '';
      const body = bodyText(m);
      const to = addrs(header(m, 'To'));
      const cc = addrs(header(m, 'Cc'));
      const direct = !!my && (to.includes(my) || cc.includes(my));
      const course = matchCourse(subject, body, keys);
      const from = header(m, 'From');
      const r = ins.run(m.id, m.threadId, Math.floor(Number(m.internalDate) / 1000), addrs(from)[0] ?? null, nameOf(from), to.join(','), cc.join(','), subject,
        m.snippet ?? null, body, JSON.stringify(attachmentNames(m)), (m.labelIds ?? []).join(','), course?.id ?? null, course?.how ?? null, direct ? 1 : 0, opts.runId, new Date().toISOString());
      if (r.changes) { res.newMails++; if (direct) res.direct++; if (course) res.courseMatched++; }
    }
  });
  setMeta('mail_last_sync_at', new Date().toISOString());
  return res;
}

export interface MailView { id: string; receivedKst: string; from: string | null; fromName: string | null; subject: string; snippet: string | null; course: string | null; direct: boolean; attachments: string[]; gmailUrl: string; body?: string }

const kst = (s: number) => new Date((s + 9 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
export const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

function view(r: Record<string, any>, withBody: boolean): MailView {
  return {
    id: r.id, receivedKst: kst(r.received_at), from: r.from_addr, fromName: r.from_name, subject: r.subject, snippet: r.snippet,
    course: r.code ?? null, direct: !!r.direct, attachments: (JSON.parse(r.attachments_json ?? '[]') as { filename: string }[]).map(a => a.filename), gmailUrl: gmailUrl(r.id),
    ...(withBody ? { body: r.body_text ?? '' } : {}),
  };
}

export function listMails(opts: { sinceSec?: number; course?: number[]; direct?: boolean; academic?: boolean; limit?: number }): MailView[] {
  const rows = openDb().prepare(`select m.*, c.code from mails m left join courses c on c.id = m.course_id order by m.received_at desc`).all() as Record<string, any>[];
  return rows
    .filter(r => opts.sinceSec === undefined || r.received_at >= opts.sinceSec)
    .filter(r => !opts.course || opts.course.includes(r.course_id))
    .filter(r => !opts.direct || r.direct)
    .filter(r => !opts.academic || r.direct || r.course_id !== null)
    .slice(0, opts.limit ?? Infinity)
    .map(r => view(r, false));
}

export function showMail(id: string): MailView | null {
  const r = openDb().prepare(`select m.*, c.code from mails m left join courses c on c.id = m.course_id where m.id = ?`).get(id) as Record<string, any> | undefined;
  return r ? view(r, true) : null;
}
