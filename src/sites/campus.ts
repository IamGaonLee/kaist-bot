// S8b: 포털 시간표·학사일정, 생활관 배정 정보·일정 수집 → 로컬 DB, 주요 일정은 "KLMS" 캘린더 (설계 3·4·6절)
import { KaistError } from '../errors.js';
import { gcal, type GEvent } from '../google/calendar-api.js';
import { ensureCalendar } from '../cal/push.js';
import { SessionStore } from '../klms/session-store.js';
import { getMeta, openDb, setMeta, tx } from '../store/db.js';
import { formatKst, nowSec } from '../util/time.js';
import { SiteHttp } from './http.js';
import { KDS_HEADERS } from './session.js';
import { isMajorPlan, parseCollegePlan, parseDormInfo, parseDormSchedule, parseStulist, type DormInfo, type PlanItem } from './parse.js';

export const todayKst = (sec = nowSec()) => new Date((sec + 9 * 3600) * 1000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

// ---------- 저장 ----------

function saveTimetable(slots: ReturnType<typeof parseStulist>): void {
  const db = openDb();
  const now = new Date().toISOString();
  tx(() => {
    db.exec('delete from timetable');
    const ins = db.prepare('insert into timetable(course_code, weekday, start, end, subject_name, building, room, fetched_at) values(?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of slots) ins.run(s.courseCode, s.weekday, s.start, s.end, s.subjectName, s.building, s.room, now);
  });
  setMeta('timetable_fetched_at', now);
}

function savePlan(items: PlanItem[]): void {
  const db = openDb();
  const now = new Date().toISOString();
  tx(() => {
    const up = db.prepare(`insert into college_plan(schdl_no, title, start_date, end_date, cldr_no, fetched_at) values(?, ?, ?, ?, ?, ?)
      on conflict(schdl_no, cldr_no) do update set title=excluded.title, start_date=excluded.start_date, end_date=excluded.end_date, fetched_at=excluded.fetched_at`);
    for (const p of items) up.run(p.schdlNo, p.title, p.startDate, p.endDate, p.cldrNo, now);
  });
  setMeta('college_plan_fetched_at', now);
}

function saveDorm(info: DormInfo): boolean {
  const db = openDb();
  const now = new Date().toISOString();
  let changed = false;
  tx(() => {
    for (const [k, v] of Object.entries(info)) {
      const old = db.prepare('select value from dorm_info where key = ?').get(k) as { value: string | null } | undefined;
      if (old && old.value === v) continue;
      if (old) changed = true;
      db.prepare('insert into dorm_info(key, value, updated_at) values(?, ?, ?) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at').run(k, v, now);
    }
  });
  setMeta('dorm_fetched_at', now);
  return changed;
}

// ---------- 캘린더 (kind school·dorm) ----------

interface CampusEventRow { id: number; source: string; source_key: string; kind: 'school' | 'dorm'; title: string; start_date: string; end_date: string; gcal_event_id: string | null; status: string }

export interface CampusTarget { sourceKey: string; source: 'portal' | 'kds'; kind: 'school' | 'dorm'; title: string; startDate: string; endDate: string; note: string }

const COLOR = { school: '10', dorm: '5' } as const;

export function campusGEvent(t: Pick<CampusTarget, 'kind' | 'title' | 'startDate' | 'endDate' | 'note' | 'sourceKey'>, prev: string[] = [], cancelled = false): GEvent {
  return {
    summary: `${cancelled ? '[학교 일정에서 사라짐] ' : ''}[${t.kind === 'school' ? '학사' : '생활관'}] ${t.title}`,
    description: [t.note, ...prev, `기록: ${formatKst(nowSec())} (KST). PC에서 kaist sync를 해야 갱신됩니다.`].filter(Boolean).join('\n'),
    start: { date: t.startDate },
    end: { date: addDays(t.endDate, 1) },
    colorId: cancelled ? '8' : COLOR[t.kind],
    // 종일 일정: 시작 전날 09:00 알림 (주요 일정이라 1번만)
    reminders: cancelled ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: [{ method: 'popup', minutes: 15 * 60 }] },
    extendedProperties: { private: { kaistCampus: '1', kaistCampusKey: t.sourceKey, kaistKind: t.kind } },
  };
}

export interface CampusPushResult { created: string[]; updated: string[]; removed: string[] }

/**
 * 대상 목록과 저장된 일정을 맞춘다. 오늘 이후(끝나는 날 기준)만 새로 넣는다.
 * 학교가 날짜를 바꾸면 그 일정을 고치고 이력을 남긴다. 목록에서 사라지면 지우지 않고 제목에 표시한다.
 */
export async function pushCampusEvents(targets: CampusTarget[], scope: { source: 'portal' | 'kds' }, runId: number | null, today = todayKst()): Promise<CampusPushResult> {
  const db = openDb();
  const out: CampusPushResult = { created: [], updated: [], removed: [] };
  const existing = db.prepare('select * from campus_events where source = ?').all(scope.source) as unknown as CampusEventRow[];
  const byKey = new Map(existing.map(e => [e.source_key, e]));
  let calId: string | null = null;
  const cal = async () => (calId ??= await ensureCalendar());
  const now = new Date().toISOString();

  for (const t of targets) {
    const e = byKey.get(t.sourceKey);
    if (e?.status === 'undone') continue; // 사용자가 되돌린 일정은 다시 넣지 않는다
    if (!e) {
      if (t.endDate < today) continue;
      const ev = await gcal.insertEvent(await cal(), campusGEvent(t));
      db.prepare(`insert into campus_events(source, source_key, kind, title, start_date, end_date, gcal_event_id, status, created_by_sync_id, created_at, updated_at)
        values(?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(t.source, t.sourceKey, t.kind, t.title, t.startDate, t.endDate, ev.id!, runId, now, now);
      out.created.push(`${t.startDate} ${t.title}`);
      continue;
    }
    const changes: [string, string, string][] = ([['title', e.title, t.title], ['start_date', e.start_date, t.startDate], ['end_date', e.end_date, t.endDate], ['status', e.status, 'active']] as [string, string, string][]).filter(([, a, b]) => a !== b);
    if (!changes.length) continue;
    const prev = changes.filter(([f]) => f !== 'status').map(([f, a]) => `이전 ${f === 'title' ? '제목' : f === 'start_date' ? '시작' : '끝'}: ${a}`);
    tx(() => {
      db.prepare('update campus_events set title=?, start_date=?, end_date=?, status=\'active\', updated_at=? where id=?').run(t.title, t.startDate, t.endDate, now, e.id);
      const h = db.prepare('insert into campus_event_history(event_id, changed_at, field, old, new, by_sync_id) values(?, ?, ?, ?, ?, ?)');
      for (const [f, a, b] of changes) h.run(e.id, now, f, a, b, runId);
    });
    if (e.gcal_event_id) await gcal.patchEvent(await cal(), e.gcal_event_id, campusGEvent(t, prev));
    out.updated.push(`${t.startDate} ${t.title}`);
  }

  const keys = new Set(targets.map(t => t.sourceKey));
  for (const e of existing) {
    if (keys.has(e.source_key) || e.status !== 'active' || e.end_date < today) continue;
    tx(() => {
      db.prepare('update campus_events set status=\'gone\', updated_at=? where id=?').run(now, e.id);
      db.prepare('insert into campus_event_history(event_id, changed_at, field, old, new, by_sync_id) values(?, ?, ?, ?, ?, ?)').run(e.id, now, 'status', 'active', 'gone', runId);
    });
    if (e.gcal_event_id) {
      await gcal.patchEvent(await cal(), e.gcal_event_id, campusGEvent({ kind: e.kind, title: e.title, startDate: e.start_date, endDate: e.end_date, sourceKey: e.source_key,
        note: '※ 학교 일정 목록에서 사라졌습니다 (취소·변경 가능성). 포털에서 확인하세요.' }, [], true));
    }
    out.removed.push(`${e.start_date} ${e.title}`);
  }
  return out;
}

export const planTargets = (items: PlanItem[]): CampusTarget[] => items.filter(isMajorPlan).map(p => ({
  sourceKey: `plan:${p.schdlNo}`, source: 'portal', kind: 'school', title: p.title, startDate: p.startDate, endDate: p.endDate,
  note: '※ 포털 공식 학사일정에서 자동 등록. 학교가 바꾸면 다음 sync에 고쳐집니다.',
}));

/** 입사·퇴사일만 (거주기간만료는 월까지만 표시돼 날짜 일정으로 넣지 않는다) */
export const dormTargets = (d: DormInfo): CampusTarget[] => ([['moveIn', '생활관 입사'], ['moveOut', '생활관 퇴사']] as const)
  .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(d[k] ?? ''))
  .map(([k, title]) => ({ sourceKey: `dorm:${d.semester ?? ''}:${k}`, source: 'kds', kind: 'dorm', title, startDate: d[k]!, endDate: d[k]!,
    note: '※ 생활관(kds) 배정 정보에서 자동 등록. 호실 등 세부 정보는 kaist dorm으로 보세요.' }));

// ---------- 수집 단계 ----------

export interface CampusResult {
  status: 'ok' | 'skipped' | 'partial';
  sites: Record<'portal' | 'kds', 'ok' | 'expired' | 'no-session' | 'error' | 'skipped'>;
  timetable?: { slots: number };
  plan?: { items: number; major: number };
  dorm?: { changed: boolean };
  calendar: CampusPushResult;
  errors: { step: string; code: string; message: string }[];
  requests: number;
}

const yearRange = (today: string) => {
  // 학기 전후 여유: 지난달 1일 ~ 5개월 뒤 말일
  const [y, m] = today.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 5, 0)).toISOString().slice(0, 10);
  return { from, to };
};

export async function syncCampus(opts: { runId: number | null; calendar?: boolean; onStatus?: (m: string) => void }): Promise<CampusResult> {
  const log = opts.onStatus ?? (() => {});
  const r: CampusResult = { status: 'ok', sites: { portal: 'skipped', kds: 'skipped' }, calendar: { created: [], updated: [], removed: [] }, errors: [], requests: 0 };
  const store = new SessionStore();
  const fail = (step: string, e: unknown) => {
    const err = e instanceof KaistError ? e : new KaistError('INTERNAL', e instanceof Error ? e.message : String(e));
    r.errors.push({ step, code: err.code, message: err.message });
    r.status = 'partial';
  };

  // 포털
  const portal = store.forSite('portal').load();
  if (!portal) r.sites.portal = 'no-session';
  else {
    const http = new SiteHttp('portal', portal, store.forSite('portal'));
    try {
      log('포털: 시간표·학사일정');
      const tt = await http.request('/wz/api/widget/schedule/stulist', { method: 'POST', body: '', headers: { 'Content-Type': 'application/json' } });
      if (tt.status === 401 || !tt.contentType.includes('json')) r.sites.portal = 'expired';
      else {
        const slots = parseStulist(JSON.parse(tt.text));
        saveTimetable(slots);
        r.timetable = { slots: slots.length };
        const { from, to } = yearRange(todayKst());
        const cp = await http.request(`/wz/api/widget/collegePlan?bgngDt=${from}&endDt=${to}`);
        if (cp.status !== 200 || !cp.contentType.includes('json')) throw new KaistError('PORTAL_ERROR', `포털 학사일정 응답이 이상합니다 (HTTP ${cp.status})`);
        const items = parseCollegePlan(JSON.parse(cp.text));
        savePlan(items);
        const targets = planTargets(items);
        r.plan = { items: items.length, major: targets.length };
        r.sites.portal = 'ok';
        http.markUsed();
        if (opts.calendar !== false) {
          const p = await pushCampusEvents(targets, { source: 'portal' }, opts.runId);
          for (const k of ['created', 'updated', 'removed'] as const) r.calendar[k].push(...p[k]);
        }
      }
    } catch (e) { r.sites.portal = 'error'; fail('portal', e); }
    r.requests += http.requestCount;
  }

  // 생활관
  const kds = store.forSite('kds').load();
  if (!kds) r.sites.kds = 'no-session';
  else {
    const http = new SiteHttp('kds', kds, store.forSite('kds'));
    try {
      log('생활관: 배정 정보·일정');
      const info = await http.request('/myDorm/selectDormPostngInfo.do', { method: 'POST', body: '', headers: KDS_HEADERS });
      if (info.status === 500 || (info.status >= 300 && info.status < 400)) r.sites.kds = 'expired';
      else if (info.status !== 200) throw new KaistError('KDS_ERROR', `생활관 배정 정보 HTTP ${info.status}`);
      else {
        const d = parseDormInfo(info.text);
        r.dorm = { changed: saveDorm(d) };
        const ym = todayKst().slice(0, 7).replace('-', '');
        const sc = await http.request('/semesterScheduleList.do', { method: 'POST', body: `yearMonth=${ym}`, headers: KDS_HEADERS });
        if (sc.status === 200 && sc.contentType.includes('json')) {
          const now = new Date().toISOString();
          const ins = openDb().prepare(`insert into dorm_schedule(id, title, start_date, end_date, dorm, fetched_at) values(?, ?, ?, ?, ?, ?)
            on conflict(id) do update set title=excluded.title, start_date=excluded.start_date, end_date=excluded.end_date, dorm=excluded.dorm, fetched_at=excluded.fetched_at`);
          for (const s of parseDormSchedule(JSON.parse(sc.text))) ins.run(s.id, s.title, s.startDate, s.endDate, s.dorm, now);
        }
        r.sites.kds = 'ok';
        http.markUsed();
        if (opts.calendar !== false) {
          const p = await pushCampusEvents(dormTargets(d), { source: 'kds' }, opts.runId);
          for (const k of ['created', 'updated', 'removed'] as const) r.calendar[k].push(...p[k]);
        }
      }
    } catch (e) { r.sites.kds = 'error'; fail('kds', e); }
    r.requests += http.requestCount;
  }
  return r;
}

// ---------- 조회 (로컬만) ----------

export function listTimetable() {
  const rows = openDb().prepare(`select t.*, c.name course_name, c.id course_id from timetable t left join courses c on c.code = t.course_code and c.active = 1 order by weekday, start`).all() as Record<string, any>[];
  const DAY = ['', '월', '화', '수', '목', '금', '토', '일'];
  return {
    fetchedAt: getMeta('timetable_fetched_at'),
    slots: rows.map(r => ({ course: r.course_code as string, courseName: (r.course_name ?? r.subject_name) as string, inKlms: r.course_id != null, weekday: r.weekday as number, day: DAY[r.weekday]!, start: r.start as string, end: r.end as string, building: r.building as string, room: r.room as string })),
  };
}

/** 그 과목의 그 날짜 수업 (휴강 시각 규칙). 시간표를 받은 적 없으면 null */
export function classesOn(courseCode: string, date: string): { start: string; end: string; building: string; room: string }[] | null {
  if (!getMeta('timetable_fetched_at')) return null;
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  const weekday = d === 0 ? 7 : d;
  return openDb().prepare('select start, end, building, room from timetable where course_code = ? and weekday = ? order by start').all(courseCode, weekday) as { start: string; end: string; building: string; room: string }[];
}

export function listCampusEvents(opts: { from?: string; all?: boolean } = {}) {
  const from = opts.from ?? todayKst();
  const rows = openDb().prepare('select * from campus_events order by start_date').all() as unknown as CampusEventRow[];
  return rows.filter(e => e.end_date >= from && (opts.all || e.status === 'active'))
    .map(e => ({ id: e.id, kind: e.kind, title: e.title, startDate: e.start_date, endDate: e.end_date, status: e.status }));
}

export function listCollegePlan(opts: { from?: string; to?: string; major?: boolean } = {}) {
  const rows = openDb().prepare('select schdl_no schdlNo, title, start_date startDate, end_date endDate, cldr_no cldrNo from college_plan where cldr_no = ? order by start_date').all('38') as unknown as PlanItem[];
  return rows.filter(p => (!opts.from || p.endDate >= opts.from) && (!opts.to || p.startDate <= opts.to) && (!opts.major || isMajorPlan(p)))
    .map(p => ({ title: p.title, startDate: p.startDate, endDate: p.endDate, major: isMajorPlan(p) }));
}

export function dormSummary() {
  const db = openDb();
  const info = Object.fromEntries((db.prepare('select key, value from dorm_info').all() as { key: string; value: string | null }[]).map(r => [r.key, r.value]));
  const schedule = db.prepare('select title, start_date startDate, end_date endDate, dorm from dorm_schedule order by start_date').all();
  return { fetchedAt: getMeta('dorm_fetched_at'), info, schedule };
}


/**
 * 자동 등록한 학사·생활관 일정 되돌리기. 캘린더에서 지우고 'undone'으로 남겨 다음 sync가 다시 넣지 않게 한다.
 * yes가 없으면 대상만 돌려준다.
 */
export async function undoCampus(syncId: number | 'last', yes: boolean): Promise<{ syncId: number | null; targets: ReturnType<typeof listCampusEvents>; deleted: boolean }> {
  const db = openDb();
  const sid = syncId === 'last'
    ? (db.prepare(`select max(created_by_sync_id) s from campus_events where status = 'active'`).get() as { s: number | null }).s
    : syncId;
  if (sid === null) return { syncId: null, targets: [], deleted: false };
  const rows = db.prepare(`select * from campus_events where created_by_sync_id = ? and status = 'active' order by start_date`).all(sid) as unknown as CampusEventRow[];
  const targets = rows.map(e => ({ id: e.id, kind: e.kind, title: e.title, startDate: e.start_date, endDate: e.end_date, status: e.status }));
  if (!yes || rows.length === 0) return { syncId: sid, targets, deleted: false };
  const calId = await ensureCalendar();
  const now = new Date().toISOString();
  for (const e of rows) {
    if (e.gcal_event_id) await gcal.deleteEvent(calId, e.gcal_event_id).catch(err => { if (!(err instanceof KaistError && err.code === 'GCAL_NOT_FOUND')) throw err; });
    tx(() => {
      db.prepare(`update campus_events set status = 'undone', gcal_event_id = null, updated_at = ? where id = ?`).run(now, e.id);
      db.prepare('insert into campus_event_history(event_id, changed_at, field, old, new, by_sync_id) values(?, ?, ?, ?, ?, ?)').run(e.id, now, 'undo', 'active', 'undone', sid);
    });
  }
  return { syncId: sid, targets, deleted: true };
}
