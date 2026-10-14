// 이번 학기 수강 목록에서 빠진 과목(수강 취소 등) 처리 (사용자 결정 2026-10-14):
// 드라이브 폴더를 "_수강취소_<코드> <과목명>"으로 바꾸고, _과목정보 맨 위에 안내를 넣는다. 자료는 지우지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../store/db.js';
import { formatKst, nowSec } from '../util/time.js';
import { courseDir, safeName, semesterDir } from './layout.js';

export const DROPPED_PREFIX = '_수강취소_';

export interface DroppedCourse { id: number; code: string; name: string; folder: string | null }

/** 같은 학기인데 active=0이고 아직 처리하지 않은 과목 */
export function findDropped(semesterLabel: string): { id: number; code: string; name: string }[] {
  return openDb().prepare(`select id, code, name from courses where active = 0 and semester = ? and dropped_at is null`).all(semesterLabel) as { id: number; code: string; name: string }[];
}

export function handleDropped(root: string, semesterLabel: string, courses: { id: number; code: string; name: string }[]): DroppedCourse[] {
  const db = openDb();
  const out: DroppedCourse[] = [];
  for (const c of courses) {
    const src = courseDir(root, semesterLabel, c);
    const dst = path.join(semesterDir(root, semesterLabel), safeName(`${DROPPED_PREFIX}${c.code} ${c.name}`));
    let folder: string | null = null;
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.renameSync(src, dst);
      // 받은 파일 경로도 새 폴더 기준으로 바꾼다
      const rows = db.prepare(`select key, local_path from files where course_id = ? and local_path is not null`).all(c.id) as { key: string; local_path: string }[];
      const up = db.prepare(`update files set local_path = ? where key = ?`);
      for (const r of rows) if (r.local_path.startsWith(src)) up.run(dst + r.local_path.slice(src.length), r.key);
      folder = dst;
    } else if (fs.existsSync(dst)) folder = dst;
    if (folder) {
      const md = path.join(folder, '_과목정보.md');
      if (fs.existsSync(md)) {
        const banner = `> ⚠ ${formatKst(nowSec())} sync에서 이 과목이 KLMS 수강 목록에 없어 수집을 멈췄습니다(수강 취소). 이 폴더는 더 이상 갱신되지 않습니다.\n\n`;
        const text = fs.readFileSync(md, 'utf8');
        if (!text.includes('수강 목록에 없어 수집을 멈췄습니다')) fs.writeFileSync(md, text.replace(/^(# [^\n]*\n\n)/, `$1${banner}`));
      }
    }
    db.prepare(`update courses set dropped_at = ? where id = ?`).run(new Date().toISOString(), c.id);
    out.push({ ...c, folder });
  }
  return out;
}
