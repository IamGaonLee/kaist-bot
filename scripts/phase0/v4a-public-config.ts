// V4-a: 로그인 없이 모바일 웹서비스 공개 설정 조회
const BASE = 'https://klms.kaist.ac.kr';

const res = await fetch(`${BASE}/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{ index: 0, methodname: 'tool_mobile_get_public_config', args: {} }]),
  redirect: 'manual',
});
console.log('status', res.status, res.headers.get('location') ?? '');
const text = await res.text();
console.log(text.slice(0, 4000));
