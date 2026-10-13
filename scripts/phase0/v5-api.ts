// V5 (API): 과목 구조와 활동별 데이터를 웹서비스로 받아 local/samples/api-*.json에 저장
import fs from 'node:fs';
import path from 'node:path';
import { get, save, LOCAL, BASE } from './http.ts';

const COURSE = Number(process.argv[2] ?? 155279);
const token = fs.readFileSync(path.join(LOCAL, 'wstoken.txt'), 'utf8').trim();

async function ws(fn: string, params: Record<string, string | number> = {}) {
  const qs = new URLSearchParams({ moodlewsrestformat: 'json', wsfunction: fn, wstoken: token });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await get(`${BASE}/webservice/rest/server.php`, { method: 'POST', body: qs, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json() as any;
  save(`api-${fn}.json`, JSON.stringify(j, null, 2));
  if (j?.exception) console.log(`  ${fn}: ERROR ${j.errorcode} ${j.message}`);
  return j;
}

const contents = await ws('core_course_get_contents', { courseid: COURSE });
const byType: Record<string, number> = {};
for (const s of contents) for (const m of s.modules) byType[m.modname] = (byType[m.modname] ?? 0) + 1;
console.log('섹션 수:', contents.length, '/ 섹션 이름 예:', contents.slice(0, 3).map((s: any) => s.name).join(' | '));
console.log('모듈 유형:', JSON.stringify(byType));
const mod0 = contents.flatMap((s: any) => s.modules)[0];
console.log('모듈 필드:', Object.keys(mod0 ?? {}).join(','));
const withFile = contents.flatMap((s: any) => s.modules).find((m: any) => m.contents?.length);
console.log('contents 필드:', withFile ? Object.keys(withFile.contents[0]).join(',') : '-');
console.log('fileurl 형식:', withFile?.contents[0]?.fileurl?.replace(/\d+/g, 'N'));

const cid = { 'courseids[0]': COURSE };
const a = await ws('mod_assign_get_assignments', cid);
const as = a.courses?.[0]?.assignments ?? [];
console.log('과제 수:', as.length, '/ 필드:', as[0] ? Object.keys(as[0]).join(',') : '-');
if (as[0]) {
  const st = await ws('mod_assign_get_submission_status', { assignid: as[0].id });
  console.log('제출상태 필드:', Object.keys(st).join(','), '/ submission.status:', st.lastattempt?.submission?.status);
}
const q = await ws('mod_quiz_get_quizzes_by_courses', cid);
console.log('퀴즈 수:', q.quizzes?.length, '/ 필드:', q.quizzes?.[0] ? Object.keys(q.quizzes[0]).join(',') : '-');
const f = await ws('mod_forum_get_forums_by_courses', cid);
console.log('게시판:', (f ?? []).map((x: any) => `${x.type}:${x.numdiscussions ?? '?'}`).join(', '));
const forum = (f ?? []).find((x: any) => x.type === 'news') ?? f?.[0];
if (forum) {
  const d = await ws('mod_forum_get_forum_discussions', { forumid: forum.id, perpage: 5 });
  const disc = d.discussions ?? [];
  console.log('글 목록 필드:', disc[0] ? Object.keys(disc[0]).join(',') : '-');
  if (disc[0]) {
    const p = await ws('mod_forum_get_discussion_posts', { discussionid: disc[0].discussion });
    console.log('본문 필드:', p.posts?.[0] ? Object.keys(p.posts[0]).join(',') : '-');
  }
}
for (const fn of ['mod_resource_get_resources_by_courses', 'mod_folder_get_folders_by_courses', 'mod_url_get_urls_by_courses', 'mod_page_get_pages_by_courses']) {
  const r = await ws(fn, cid);
  const key = Object.keys(r).find(k => Array.isArray(r[k]) && k !== 'warnings')!;
  console.log(`${fn}: ${r[key]?.length}개`);
}
