// 렌더러 UI 로직 (plain JS). window.kaist는 preload가 노출.
const $ = id => document.getElementById(id);
const screens = ['idle', 'progress', 'approve', 'done', 'fail', 'sync'];
let loggedIn = false;
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

function applyStatus(msg) {
  const m = /인증 번호:\s*([0-9A-Za-z]+)/.exec(msg || '');
  if (m) { $('auth-num').textContent = m[1]; show('approve'); return; }
  // 동기화 중이면 sync 화면의 보조 문구를 갱신
  if (!$('screen-sync').classList.contains('hidden')) { $('sync-sub').textContent = msg; return; }
  if (/로그인 중|연쇄 로그인/.test(msg || '')) { $('progress-sub').textContent = msg; show('progress'); }
}

async function doSync() {
  show('sync');
  $('sync-sub').textContent = '수집을 시작합니다…';
  let res;
  try { res = await window.kaist.sync(); }
  catch (e) { res = { ok: false, error: { message: String(e) } }; }
  show('done');
  if (res && res.ok) {
    const parts = [`변경 ${res.changes}건`];
    if (res.newCandidates) parts.push(`새 일정 후보 ${res.newCandidates}`);
    if (res.warnings && res.warnings.length) parts.push(`경고 ${res.warnings.length}`);
    $('sync-result').textContent = '✓ 동기화 완료 · ' + parts.join(' · ') + (res.warnings && res.warnings.length ? '\n' + res.warnings.join('\n') : '');
  } else if (res && res.aborted) {
    $('sync-result').textContent = (res.code === 'SESSION_EXPIRED') ? '세션이 만료됐습니다. "다시 로그인"을 눌러 주세요.' : ('중단: ' + (res.message || ''));
  } else {
    $('sync-result').textContent = '동기화 실패: ' + ((res && res.error && res.error.message) || '오류');
  }
}

async function doLogin() {
  if (!window.kaist || !window.kaist.login) { $('fail-sub').textContent = 'preload가 로드되지 않았습니다(window.kaist 없음).'; show('fail'); return; }
  show('progress');
  $('progress-sub').textContent = '학교 사이트에 연결하고 있습니다.';
  let res;
  try { res = await window.kaist.login(); }
  catch (e) { res = { ok: false, error: { message: String(e) } }; }
  if (res && res.ok) {
    loggedIn = true;
    $('done-sub').textContent = '세션을 저장했습니다.';
    $('done-sites').textContent = (res.sites || []).map(s => s.site + ' ' + (s.state === 'ok' ? '✓' : s.state)).join('   ');
    $('sync-result').textContent = '';
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
for (const id of ['btn-sync', 'btn-sync-idle']) { if ($(id)) $(id).addEventListener('click', doSync); }

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
    if (window.kaist && window.kaist.onTriggerSync) window.kaist.onTriggerSync(() => { if (loggedIn) doSync(); });
  } catch (e) { $('ver').textContent = 'init 오류'; }
})();
