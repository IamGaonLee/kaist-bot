// V3: 쿠키만으로 HTTP 요청 / V4-b: 세션 AJAX API / V4-a: 모바일 토큰 발급
import fs from 'node:fs';
import path from 'node:path';
import { get, ajax, sesskeyOf, save, short, LOCAL, BASE } from './http.ts';

// V3
const r1 = await get('/my/');
console.log('[V3] GET /my/ ->', r1.status, short(r1.headers.get('location')));
const html = await r1.text();
save('my.html', html);
const sesskey = sesskeyOf(html);
console.log('[V3] sesskey 존재:', !!sesskey, '/ logout 링크:', html.includes('login/logout.php'), '/ 길이:', html.length);
const ver = html.match(/Moodle\s*([\d.]+)/i)?.[0] ?? html.match(/theme\/(\w+)\//)?.[0];
console.log('[V3] 버전 힌트:', ver ?? '없음');
if (!sesskey) process.exit(0);

// V4-b
for (const [name, args] of [
  ['core_course_get_enrolled_courses_by_timeline_classification', { offset: 0, limit: 0, classification: 'all', sort: 'fullname' }],
  ['core_calendar_get_action_events_by_timesort', { limitnum: 50, timesortfrom: Math.floor(Date.now() / 1000) - 86400 }],
] as const) {
  const r = await ajax(sesskey, name, args);
  save(`ajax-${name}.json`, r.body);
  let summary = r.body.slice(0, 300);
  try {
    const j = JSON.parse(r.body)[0];
    if (j.error) summary = `ERROR ${JSON.stringify(j.exception ?? j).slice(0, 300)}`;
    else {
      const d = j.data;
      const list = d.courses ?? d.events ?? [];
      summary = `OK, 항목 ${list.length}개, 첫 항목 필드: ${list[0] ? Object.keys(list[0]).join(',') : '-'}`;
    }
  } catch {}
  console.log(`[V4-b] ${name} -> ${r.status} ${summary}`);
}

// V4-a: launch.php 토큰 발급 (토큰 값은 출력하지 않고 local/에만 저장)
const passport = String(Math.floor(Math.random() * 1e9));
const r2 = await get(`/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`);
const loc = r2.headers.get('location') ?? '';
console.log('[V4-a] launch.php ->', r2.status, loc.startsWith('moodlemobile://') ? 'moodlemobile://token=<redacted>' : short(loc));
if (r2.status === 200) save('launch.html', await r2.text());
const m = loc.match(/token=([A-Za-z0-9+/=]+)/);
if (m) {
  const parts = Buffer.from(m[1], 'base64').toString().split(':::');
  const token = parts[1];
  console.log('[V4-a] 토큰 발급됨, 구성요소 수:', parts.length);
  fs.writeFileSync(path.join(LOCAL, 'wstoken.txt'), token);
  const r3 = await get(`${BASE}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info&wstoken=${token}`);
  const info = await r3.json() as any;
  if (info.exception) console.log('[V4-a] site_info 오류:', info.errorcode, info.message);
  else {
    console.log('[V4-a] release:', info.release, 'version:', info.version);
    console.log('[V4-a] 사용 가능 함수 수:', info.functions?.length);
    fs.writeFileSync(path.join(LOCAL, 'samples', 'ws-functions.txt'), (info.functions ?? []).map((f: any) => f.name).join('\n'));
  }
}
