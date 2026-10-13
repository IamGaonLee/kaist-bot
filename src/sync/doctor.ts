// kaist doctor: 불변식 검사만 수행 (DB를 바꾸지 않음). --offline이면 보관된 HTML 원문으로.
import { KaistError } from '../errors.js';
import { parseCoursePage } from '../klms/adapters/course-page.js';
import { parseBoardList } from '../klms/adapters/courseboard.js';
import type { Course } from '../klms/courses.js';
import { ensureSession } from '../klms/session.js';
import { openDb, getMeta } from '../store/db.js';
import { loadSnapshot, saveSnapshot } from '../store/snapshots.js';
import { checkCoursePage, NOT_IN_UPDATES } from './invariants.js';

export interface DoctorCourse {
  id: number;
  code: string;
  name: string;
  ok: boolean;
  failures: string[];
  stats?: Record<string, number>;
}

export interface DoctorResult { mode: 'online' | 'offline'; theme: string | null; courses: DoctorCourse[] }

export async function runDoctor(courses: Course[], opts: { offline: boolean; interactive: boolean; onStatus?: (m: string) => void }): Promise<DoctorResult> {
  const out: DoctorResult = { mode: opts.offline ? 'offline' : 'online', theme: getMeta('theme'), courses: [] };
  const session = opts.offline ? null : await ensureSession({ interactive: opts.interactive, onStatus: opts.onStatus });
  try {
    for (const c of courses) {
      const base = { id: c.id, code: c.code, name: c.name };
      try {
        let html: string | null;
        let updates: Set<number>;
        if (session) {
          html = await session.http.html(`/course/view.php?id=${c.id}&section=0`);
          saveSnapshot(`course-${c.id}`, html);
          const upd = await session.ajax<{ instances?: { contextlevel: string; id: number }[] }>('core_course_get_updates_since', { courseid: c.id, since: 0 });
          updates = new Set((upd.instances ?? []).filter(i => i.contextlevel === 'module').map(i => i.id));
        } else {
          html = loadSnapshot(`course-${c.id}`);
          if (!html) { out.courses.push({ ...base, ok: false, failures: ['보관된 과목 페이지 원문이 없습니다 (sync를 먼저 실행)'] }); continue; }
          // 오프라인: 마지막 sync 때 updates_since에 있던 활동(updates_sig 있음)을 기준으로 삼는다
          const rows = openDb().prepare('select cmid, modname from modules where course_id = ? and removed_at is null and updates_sig is not null').all(c.id) as { cmid: number; modname: string }[];
          updates = new Set(rows.filter(r => !NOT_IN_UPDATES.has(r.modname)).map(r => r.cmid));
        }
        const page = parseCoursePage(html, `${c.code} 과목 페이지`);
        const inv = checkCoursePage(page, updates);
        const failures = [...inv.failures];
        // 게시판은 따로: 첫 게시판 목록이 파싱되는지
        const board = page.modules.find(m => m.modname === 'courseboard');
        if (board) {
          const bh = session ? await session.http.html(`/mod/courseboard/view.php?id=${board.cmid}`) : loadSnapshot(`board-${board.cmid}`);
          if (bh) {
            try { parseBoardList(bh, `${c.code} 게시판`); } catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
          } else failures.push('보관된 게시판 원문이 없습니다');
        }
        out.courses.push({ ...base, ok: failures.length === 0, failures, stats: inv.stats });
      } catch (e) {
        if (e instanceof KaistError && (e.code === 'SESSION_EXPIRED' || e.code === 'BLOCKED')) throw e;
        out.courses.push({ ...base, ok: false, failures: [e instanceof Error ? e.message : String(e)] });
      }
    }
  } finally {
    session?.http.persist();
  }
  return out;
}
