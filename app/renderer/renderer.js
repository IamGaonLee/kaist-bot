// 렌더러 UI 로직 (plain JS). window.kaist는 preload가 노출.
const $ = id => document.getElementById(id);
const screens = ['idle', 'progress', 'approve', 'done', 'fail'];
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

function applyStatus(msg) {
  const m = /인증 번호:\s*([0-9A-Za-z]+)/.exec(msg || '');
  if (m) { $('auth-num').textContent = m[1]; show('approve'); return; }
  if (/로그인 중|연쇄 로그인/.test(msg || '')) { $('progress-sub').textContent = msg; show('progress'); }
}

async function doLogin() {
  if (!window.kaist || !window.kaist.login) { $('fail-sub').textContent = 'preload가 로드되지 않았습니다(window.kaist 없음).'; show('fail'); return; }
  show('progress');
  $('progress-sub').textContent = '학교 사이트에 연결하고 있습니다.';
  let res;
  try { res = await window.kaist.login(); }
  catch (e) { res = { ok: false, error: { message: String(e) } }; }
  if (res && res.ok) {
    $('done-sub').textContent = '세션을 저장했습니다.';
    $('done-sites').textContent = (res.sites || []).map(s => s.site + ' ' + (s.state === 'ok' ? '✓' : s.state)).join('   ');
    show('done');
  } else {
    $('fail-sub').textContent = (res && res.error && res.error.message) || '알 수 없는 오류';
    show('fail');
  }
}

// 버튼 연결은 가장 먼저 (뒤의 비동기가 실패해도 버튼은 살아 있도록)
for (const id of ['btn-login', 'btn-again', 'btn-retry']) {
  const el = $(id);
  if (el) el.addEventListener('click', doLogin);
}

// 앱 정보·상태 구독 (실패해도 버튼에는 영향 없음)
(async () => {
  try {
    if (window.kaist && window.kaist.appInfo) {
      const info = await window.kaist.appInfo();
      $('ver').textContent = `v${info.version} · Electron ${info.electron}`;
      if (!info.hasSavedId) $('idle-sub').textContent = '처음이면 뜨는 창에서 아이디를 입력하고 폰 승인을 해 주세요.';
    } else {
      $('ver').textContent = '(preload 미로드)';
    }
    if (window.kaist && window.kaist.onStatus) window.kaist.onStatus(applyStatus);
  } catch (e) { $('ver').textContent = 'init 오류'; }
})();
