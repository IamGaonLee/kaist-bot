// 과목 목록 로컬 캐시. S2에서 수집 기록 DB로 옮긴다.
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';
import type { Course, Semester } from '../klms/courses.js';

export interface CoursesCache {
  fetchedAt: string;
  semester: Semester;
  courses: Course[];
}

export function loadCourses(): CoursesCache | null {
  if (!fs.existsSync(paths.coursesCache)) return null;
  try { return JSON.parse(fs.readFileSync(paths.coursesCache, 'utf8')) as CoursesCache; } catch { return null; }
}

export function saveCourses(cache: CoursesCache): void {
  ensureDir(path.dirname(paths.coursesCache));
  fs.writeFileSync(paths.coursesCache, JSON.stringify(cache, null, 2));
}
