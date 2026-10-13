// S3 완료 기준 확인: KLMS 파일 활동 수 vs 받은 파일, 디스크 존재·크기 (네트워크 없음)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const d = new DatabaseSync(path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'kaist.db'));
const perCourse = d.prepare(`select c.code,
  (select count(*) from modules m where m.course_id = c.id and m.modname = 'resource' and m.removed_at is null) klms,
  (select count(*) from files f where f.course_id = c.id and f.source = 'resource' and f.status = 'ok') got,
  (select count(*) from files f where f.course_id = c.id and f.source <> 'resource' and f.status = 'ok') attach
  from courses c where c.active = 1 order by c.code`).all() as { code: string; klms: number; got: number; attach: number }[];
for (const r of perCourse) console.log(r.code.padEnd(14), `KLMS 파일 ${r.klms}`, `받음 ${r.got}`, r.klms === r.got ? 'OK' : 'MISMATCH', `첨부 ${r.attach}`);
const rows = d.prepare(`select status, local_path, length from files`).all() as { status: string; local_path: string | null; length: number }[];
let missing = 0, bad = 0;
for (const r of rows) if (r.status === 'ok') {
  if (!r.local_path || !fs.existsSync(r.local_path)) missing++;
  else if (fs.statSync(r.local_path).size !== r.length) bad++;
}
const st: Record<string, number> = {};
for (const r of rows) st[r.status] = (st[r.status] ?? 0) + 1;
console.log('상태별', JSON.stringify(st), '| 디스크에 없음', missing, '| 크기 불일치', bad);
