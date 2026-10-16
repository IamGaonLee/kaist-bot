// 렌더러 UI 로직 (plain JS). window.kaist는 preload가 노출.
const $ = id => document.getElementById(id);
const screens = ['wizard', 'idle', 'progress', 'approve', 'done', 'fail', 'sync', 'chat', 'suggest'];
const KIND_KO = { exam: '시험', no_class: '휴강', online: '온라인 수업', makeup: '보강' };
let loggedIn = false;
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
}

// ---- 첫 실행 설정 마법사 ----
async function refreshWizard() {
  let st;
  try { st = await window.kaist.setupState(); } catch (e) { return null; }
  $('account-badge').textContent = st.hasSavedId ? '✓ 저장됨' : '필요';
  $('wz-login').textContent = st.hasSavedId ? '다시 로그인' : '로그인하고 아이디 저장';
  $('drive-badge').textContent = st.driveRootExists ? '✓' : '폴더 확인 필요';
  $('drive-path').textContent = st.driveRoot;
  $('google-badge').textContent = st.hasGoogleToken ? ('✓ 연결됨' + (st.hasGmail ? ' (메일 포함)' : '')) : '필요';
  if (st.hasGmail) $('wz-gmail').checked = true;
  $('wz-done').disabled = !(st.hasSavedId && st.hasGoogleToken);
  return st;
}
function wzStatus(msg) { $('wz-status').textContent = msg || ''; }

async function refreshAi() {
  let st; try { st = await window.kaist.aiState(); } catch (e) { return; }
  const box = $('ai-models');
  box.innerHTML = '';
  for (const m of st.models) {
    const row = document.createElement('label');
    row.className = 'muted';
    row.style.cssText = 'font-size:12px; display:flex; gap:6px; align-items:flex-start; margin:4px 0';
    const checked = m.selected && !st.usingApiKey ? 'checked' : '';
    row.innerHTML = `<input type="radio" name="aimodel" value="${m.uri}" ${checked}> <span><b>${m.label}</b> · ${m.sizeGb}GB · ${m.license} ${m.downloaded ? '· <span class="ok">받음</span>' : ''}<br><span style="font-size:11px">${m.note}</span></span>`;
    box.appendChild(row);
  }
  $('ai-ext').checked = st.usingApiKey;
  $('ai-ext-fields').classList.toggle('hidden', !st.usingApiKey);
  document.querySelectorAll('.ai-preset').forEach(b => b.addEventListener('click', () => {
    $('ai-ext').checked = true;
    $('ai-ext-fields').classList.remove('hidden');
    $('ai-base').value = b.getAttribute('data-base');
    $('ai-model').value = b.getAttribute('data-model');
    $('ai-key').focus();
  }));
  if (st.apiBaseUrl) $('ai-base').value = st.apiBaseUrl;
  if (st.apiModel) $('ai-model').value = st.apiModel;
  $('ai-badge').textContent = st.usingApiKey ? '외부 AI' : (st.models.find(m => m.selected)?.downloaded ? '✓ 준비됨' : '모델 받기 필요');
  // 외부 선택 토글
  document.querySelectorAll('input[name=aimodel]').forEach(r => r.addEventListener('change', () => {
    $('ai-ext-fields').classList.toggle('hidden', $('ai-ext').checked !== true);
  }));
}
async function aiSave() {
  const sel = document.querySelector('input[name=aimodel]:checked');
  if (!sel) { wzStatus('모델을 고르세요.'); return; }
  if (sel.value === '__ext__') {
    const apiKey = $('ai-key').value.trim();
    if (!apiKey) { wzStatus('API 키를 입력하세요.'); return; }
    await window.kaist.aiSetApiKey({ apiKey, baseUrl: $('ai-base').value.trim(), model: $('ai-model').value.trim() });
    wzStatus('외부 AI로 설정했습니다.');
  } else {
    await window.kaist.aiSetModel(sel.value);
    wzStatus('로컬 모델을 설정했습니다. "모델 받기"로 내려받으세요.');
  }
  await refreshAi();
}
async function aiDownload() {
  wzStatus('모델을 내려받는 중… (수 분 걸릴 수 있어요)');
  let res; try { res = await window.kaist.aiDownload(); } catch (e) { res = { ok: false, error: { message: String(e) } }; }
  wzStatus(res && res.ok ? 'AI 모델 준비 완료.' : ('모델 받기 실패: ' + ((res && res.error && res.error.message) || '')));
  await refreshAi();
}
async function wizardLogin() {
  wzStatus('로그인 창이 뜹니다. 아이디를 입력하고 폰 승인을 해 주세요…');
  let res; try { res = await window.kaist.login({ saveId: true, show: true }); } catch (e) { res = { ok: false, error: { message: String(e) } }; }
  wzStatus(res && res.ok ? '계정 저장 완료.' : ('로그인 실패: ' + ((res && res.error && res.error.message) || '')));
  await refreshWizard();
}
async function wizardDrive() {
  wzStatus('폴더를 선택하세요…');
  let res; try { res = await window.kaist.pickDrive(); } catch (e) { res = { ok: false }; }
  wzStatus(res && res.ok ? '폴더 저장 완료.' : '폴더 선택 취소.');
  await refreshWizard();
}
async function wizardGoogle() {
  wzStatus('브라우저에서 구글 계정으로 승인해 주세요…');
  const gmail = $('wz-gmail').checked;
  let res; try { res = await window.kaist.googleLogin({ gmail }); } catch (e) { res = { ok: false, error: { message: String(e) } }; }
  wzStatus(res && res.ok ? '구글 연결 완료.' : ('구글 승인 실패: ' + ((res && res.error && res.error.message) || '')));
  await refreshWizard();
}

function applyStatus(msg) {
  // 마법사 중에는 마법사 안에만 표시(화면 전환 안 함). 로그인 창이 보여 사용자가 거기서 처리.
  if (!$('screen-wizard').classList.contains('hidden')) { wzStatus(msg); return; }
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
if ($('wz-login')) $('wz-login').addEventListener('click', wizardLogin);
if ($('wz-drive')) $('wz-drive').addEventListener('click', wizardDrive);
if ($('wz-google')) $('wz-google').addEventListener('click', wizardGoogle);
if ($('wz-done')) $('wz-done').addEventListener('click', () => show('idle'));
if ($('ai-save')) $('ai-save').addEventListener('click', aiSave);
if ($('ai-download')) $('ai-download').addEventListener('click', aiDownload);
if ($('btn-setup')) $('btn-setup').addEventListener('click', async () => { await refreshWizard(); await refreshAi(); show('wizard'); });

// 대화
function chatAppend(who, text) {
  const div = document.createElement('div');
  div.style.margin = '6px 0';
  div.innerHTML = '<b style="color:' + (who === '나' ? 'var(--fg)' : 'var(--accent)') + '">' + who + ':</b> ';
  div.appendChild(document.createTextNode(text));
  $('chat-log').appendChild(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}
async function chatSend() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  chatAppend('나', q);
  chatAppend('AI', '…생각 중');
  const thinking = $('chat-log').lastChild;
  let res; try { res = await window.kaist.ask(q); } catch (e) { res = { ok: false, error: { message: String(e) } }; }
  thinking.remove();
  chatAppend('AI', (res && res.ok) ? res.answer : ('오류: ' + ((res && res.error && res.error.message) || '')));
}
// AI 일정 제안
function suggestRender(list) {
  const box = $('suggest-list');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="muted" style="text-align:center; padding:12px">제안할 일정이 없습니다. (새로 받은 공지가 없거나, AI가 일정을 찾지 못함)</div>'; return; }
  for (const s of list) {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid var(--line); border-radius:9px; padding:10px; margin:7px 0';
    const time = s.start ? ' ' + s.start : '';
    row.innerHTML = `<div><b>${s.date}${time}</b> · ${s.course} · ${KIND_KO[s.kind] || s.kind} <span class="muted" style="font-size:11px">[${s.grade}]</span></div>`
      + `<div class="muted" style="font-size:12px; margin:3px 0">"${s.quote}"</div>`
      + (s.reasons && s.reasons.length ? `<div class="muted" style="font-size:11px">확인: ${s.reasons.join(', ')}</div>` : '');
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex; gap:6px; margin-top:7px';
    const reg = document.createElement('button'); reg.textContent = '등록'; reg.style.cssText = 'font-size:12px; padding:6px 12px';
    const dis = document.createElement('button'); dis.textContent = '무시'; dis.style.cssText = 'font-size:12px; padding:6px 12px; background:transparent; color:var(--sub); border:1px solid var(--line)';
    const msg = document.createElement('span'); msg.className = 'muted'; msg.style.cssText = 'font-size:11px; align-self:center';
    reg.addEventListener('click', async () => {
      reg.disabled = true; dis.disabled = true; msg.textContent = '등록 중…';
      const r = await window.kaist.eventsRegister({ candidateId: s.candidateId, course: s.course, kind: s.kind, date: s.date, start: s.start || undefined, quote: s.quote }).catch(e => ({ ok: false, error: { message: String(e) } }));
      msg.textContent = r.ok ? '✓ 캘린더에 등록' : ('실패: ' + ((r.error && r.error.message) || ''));
      if (r.ok) { reg.remove(); dis.remove(); }
      else { reg.disabled = false; dis.disabled = false; }
    });
    dis.addEventListener('click', async () => { await window.kaist.eventsDismiss(s.candidateId); row.style.opacity = .4; reg.remove(); dis.remove(); msg.textContent = '무시함'; });
    btns.appendChild(reg); btns.appendChild(dis); btns.appendChild(msg);
    row.appendChild(btns); box.appendChild(row);
  }
}
async function suggestRun(all) {
  $('suggest-list').innerHTML = '<div class="muted" style="text-align:center; padding:12px">공지를 분석하는 중… (로컬 AI, 수십 초 걸릴 수 있어요)</div>';
  let res; try { res = await window.kaist.eventsSuggest({ all: !!all }); } catch (e) { res = { ok: false, error: { message: String(e) } }; }
  if (res && res.ok) suggestRender(res.suggestions);
  else $('suggest-list').innerHTML = '<div class="err" style="text-align:center; padding:12px">오류: ' + ((res && res.error && res.error.message) || '') + '</div>';
}
if ($('btn-suggest')) $('btn-suggest').addEventListener('click', () => { show('suggest'); $('suggest-list').innerHTML = '<div class="muted" style="text-align:center; padding:12px">"공지 분석"을 눌러 주세요. (새 공지가 없으면 "미리보기"로 전체를 봅니다)</div>'; });
if ($('suggest-run')) $('suggest-run').addEventListener('click', () => suggestRun(false));
if ($('suggest-preview')) $('suggest-preview').addEventListener('click', () => suggestRun(true));
if ($('suggest-back')) $('suggest-back').addEventListener('click', () => show(loggedIn ? 'done' : 'idle'));

if ($('btn-chat')) $('btn-chat').addEventListener('click', () => { show('chat'); $('chat-input').focus(); });
if ($('chat-send')) $('chat-send').addEventListener('click', chatSend);
if ($('chat-input')) $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') chatSend(); });
if ($('chat-back')) $('chat-back').addEventListener('click', () => show(loggedIn ? 'done' : 'idle'));

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
    // 설정이 덜 됐으면 마법사부터
    const st = await refreshWizard();
    await refreshAi();
    if (st && !(st.hasSavedId && st.hasGoogleToken)) show('wizard');
    else show('idle');
  } catch (e) { $('ver').textContent = 'init 오류'; }
})();
