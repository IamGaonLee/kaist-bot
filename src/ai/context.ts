// 로컬 자료를 모아 AI에게 줄 컨텍스트 문자열을 만든다. 드라이브 요약(_요약.md) 우선, 없으면 로컬 DB로 구성.
// 개인정보(성적·호실)는 넣지 않는다 — 요약 파일에도 없다.
import fs from 'node:fs';
import path from 'node:path';
import { loadSettings } from '../config.js';
import { loadCourses } from '../store/courses-cache.js';
import { listTasks } from '../store/queries.js';
import { formatKst, nowSec } from '../util/time.js';

const MAX = 6500;

function fromDrive(course?: string): string | null {
  const cache = loadCourses();
  if (!cache) return null;
  const { driveRoot } = loadSettings();
  const base = path.join(driveRoot, cache.semester.label);
  const parts: string[] = [];
  const summary = path.join(base, '_요약.md');
  try { if (fs.existsSync(summary)) parts.push(fs.readFileSync(summary, 'utf8')); } catch { /* skip */ }
  // 과목을 특정하면 그 과목정보도 (코드/이름 일부 일치)
  if (course) {
    const c = cache.courses.find(x => x.code.toLowerCase().includes(course.toLowerCase()) || x.name.includes(course));
    if (c) {
      const info = path.join(base, `${c.code} ${c.name}`, '_과목정보.md');
      try { if (fs.existsSync(info)) parts.push(fs.readFileSync(info, 'utf8')); } catch { /* skip */ }
    }
  }
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

function fromDb(): string {
  const now = nowSec();
  const tasks = listTasks({ now, withinSec: 21 * 86400, all: false });
  const lines = ['# 다가오는 과제·마감 (로컬 DB)'];
  for (const t of tasks) lines.push(`- ${t.dueKst ?? '마감 미정'} ${t.course} ${t.name} [${t.submissionText ?? ''}]`);
  if (tasks.length === 0) lines.push('- 다가오는 마감 없음');
  lines.push(`\n(기준 시각: ${formatKst(now)} KST)`);
  return lines.join('\n');
}

export function gatherContext(opts: { course?: string } = {}): string {
  const ctx = fromDrive(opts.course) ?? fromDb();
  return ctx.length > MAX ? ctx.slice(0, MAX) + '\n…(생략)' : ctx;
}

// 소형 로컬 모델은 긴 지시를 되받아치는 경향이 있어 짧게 둔다.
export const CHAT_SYSTEM = '너는 KAIST 학생의 학교생활 비서야. 아래 자료를 보고 한국어로 간결하게 답해. 날짜는 자료의 값을 그대로 쓴다.';
