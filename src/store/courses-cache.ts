// 과목 목록 (DB courses 테이블). 이번 학기 과목만 active=1.
import type { Course, Semester } from '../klms/courses.js';
import { getMeta, openDb, setMeta, tx } from './db.js';

export interface CoursesCache {
  fetchedAt: string;
  semester: Semester;
  courses: Course[];
}

interface CourseRow { id: number; code: string; name: string; shortname: string; category: string | null; startdate: number; enddate: number; url: string }

export function loadCourses(): CoursesCache | null {
  const fetchedAt = getMeta('courses_fetched_at');
  const semester = getMeta('semester');
  if (!fetchedAt || !semester) return null;
  const rows = openDb().prepare('select * from courses where active = 1 order by code').all() as unknown as CourseRow[];
  return { fetchedAt, semester: JSON.parse(semester) as Semester, courses: rows.map(r => ({ ...r })) };
}

export function saveCourses(cache: CoursesCache): void {
  const d = openDb();
  tx(() => {
    d.prepare('update courses set active = 0').run();
    const up = d.prepare(`insert into courses(id, code, name, shortname, category, startdate, enddate, url, semester, active)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      on conflict(id) do update set code=excluded.code, name=excluded.name, shortname=excluded.shortname, category=excluded.category,
        startdate=excluded.startdate, enddate=excluded.enddate, url=excluded.url, semester=excluded.semester, active=1`);
    for (const c of cache.courses) up.run(c.id, c.code, c.name, c.shortname, c.category, c.startdate, c.enddate, c.url, cache.semester.label);
    setMeta('semester', JSON.stringify(cache.semester));
    setMeta('courses_fetched_at', cache.fetchedAt);
  });
}
