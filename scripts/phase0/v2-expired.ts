// 만료 응답 재현: 무효한 MoodleSession / 무효한 토큰으로 요청했을 때의 응답 형태
import { short, BASE } from './http.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fake = { Cookie: 'MoodleSession=invalidsession000000000000' };

const r1 = await fetch(`${BASE}/my/`, { redirect: 'manual', headers: fake });
console.log('/my/ (무효 세션):', r1.status, short(r1.headers.get('location')));
await sleep(1200);
const r2 = await fetch(`${BASE}/lib/ajax/service.php?sesskey=x&info=core_calendar_get_action_events_by_timesort`, {
  method: 'POST', redirect: 'manual', headers: { ...fake, 'Content-Type': 'application/json' },
  body: JSON.stringify([{ index: 0, methodname: 'core_calendar_get_action_events_by_timesort', args: { limitnum: 1 } }]),
});
console.log('ajax (무효 세션):', r2.status, (await r2.text()).slice(0, 250));
await sleep(1200);
const r3 = await fetch(`${BASE}/webservice/rest/server.php?moodlewsrestformat=json&wsfunction=core_webservice_get_site_info&wstoken=00000000000000000000000000000000`);
console.log('ws (무효 토큰):', r3.status, (await r3.text()).slice(0, 250));
