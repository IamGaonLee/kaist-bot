// 렌더러 UI 로직 (plain JS). window.kaist는 preload가 노출.
// 구조: 왼쪽 사이드바(내비·상태) + 상단 제목줄 + 본문(홈/질문/일정/동기화/설정) + 로그인 오버레이.
const $ = id => document.getElementById(id);
const K = window.kaist || {};
const KIND_KO = { exam: '시험', no_class: '휴강', online: '온라인', makeup: '보강' };
const KIND_BADGE = { exam: 'danger', no_class: 'warning', online: 'accent', makeup: 'success' };
const TITLES = { home: '홈', ai: '질문', events: '일정', sync: '동기화', settings: '설정' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const errMsg = (res, fallback) => (res && res.error && res.error.message) || fallback || '오류';
const call = (fn, ...a) => (typeof fn === 'function' ? fn(...a) : Promise.reject(new Error('preload 미로드'))).catch(e => ({ ok: false, error: { message: String(e && e.message || e) } }));

let home = null;        // home:state 결과
let loggedIn = false;   // 이번 세션에서 로그인·동기화 성공 여부
let busy = null;        // 'login' | 'sync' | null
let tab = 'home';

// ---- 내비 ----
function showTab(name) {
  tab = name;
  document.querySelectorAll('.nav__item').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
  $('topbar-title').textContent = TITLES[name] || '';
  $('content').scrollTop = 0;
  if (name === 'home') refreshHome();
  if (name === 'settings') { refreshWizard(); refreshAi(); }
  if (name === 'ai') { refreshChatTools(); setTimeout(() => $('chat-input').focus(), 50); }
  if (name === 'events') { refreshEventList(); if (!$('sg-list').childElementCount) sgEmpty('"새 공지 분석"을 누르면 마지막 동기화 뒤 새로 생긴 후보만, "처리 안 한 후보 전부"는 아직 승인·거절하지 않은 후보를 모두 분석합니다.'); }
}
document.querySelectorAll('.nav__item').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---- 사이드바 상태·홈 ----
function fmtAgo(min) {
  if (min == null) return '동기화 기록 없음';
  if (min < 1) return '방금 동기화';
  if (min < 60) return `${min}분 전 동기화`;
  if (min < 48 * 60) return `${Math.round(min / 60)}시간 전 동기화`;
  return `${Math.round(min / 1440)}일 전 동기화`;
}
function fmtLeft(h) {
  if (h == null) return '';
  if (h < 0) return '지남';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분 남음`;
  if (h < 48) return `${Math.round(h)}시간 남음`;
  return `${Math.floor(h / 24)}일 남음`;
}
function setSidebar() {
  const dot = $('st-dot'), fresh = $('st-fresh'), lg = $('st-login');
  const state = busy ? 'warn' : (loggedIn || (home && home.sessionSaved)) ? 'ok' : (home && home.hasSavedId ? 'warn' : 'bad');
  dot.className = 'dot ' + state;
  lg.textContent = busy ? (busy === 'login' ? '로그인 중' : '동기화 중') : (loggedIn ? '로그인됨' : (home && home.sessionSaved ? '세션 저장됨' : '로그인 필요'));
  const min = home ? home.lastSyncMinutesAgo : null;
  fresh.textContent = fmtAgo(min);
  fresh.classList.toggle('old', min == null || min > 24 * 60);
}
function renderHome() {
  if (!home || !home.ok) {
    $('home-tasks').innerHTML = `<div class="empty"><div class="empty__title">데이터를 못 읽었어요</div><div class="empty__sub">${esc(home ? errMsg(home) : 'preload 미로드')}</div></div>`;
    return;
  }
  const lg = $('home-login');
  if (loggedIn) { lg.className = 'badge badge--dot badge--success'; lg.textContent = '로그인됨'; }
  else if (home.sessionSaved) { lg.className = 'badge badge--dot badge--neutral'; lg.textContent = '세션 저장됨'; }
  else { lg.className = 'badge badge--dot badge--warning'; lg.textContent = '로그인 필요'; }
  $('home-sync').textContent = fmtAgo(home.lastSyncMinutesAgo);
  const b = $('home-banner');
  const upd = b.querySelector('.banner--update');
  b.innerHTML = '';
  if (upd) b.appendChild(upd);
  if (!home.sessionSaved && !loggedIn) {
    const el = document.createElement('div');
    el.className = 'banner banner--warn';
    el.innerHTML = `<span>${home.hasSavedId ? '세션이 없어요. 로그인하면 폰 승인 한 번으로 끝납니다.' : '처음이면 설정에서 계정을 저장해 주세요.'}</span>`;
    const btn = document.createElement('button'); btn.className = 'btn btn--sm btn--primary'; btn.textContent = home.hasSavedId ? '로그인' : '설정';
    btn.addEventListener('click', () => home.hasSavedId ? doLogin() : showTab('settings'));
    el.appendChild(btn); b.appendChild(el);
  }
  const tasks = (home.tasks || []).slice(0, 8);
  const tb = $('home-tasks');
  if (!tasks.length) tb.innerHTML = '<div class="empty"><div class="empty__title">2주 안에 마감이 없어요</div><div class="empty__sub">동기화하면 최신으로 갱신됩니다.</div></div>';
  else tb.innerHTML = tasks.map(t => {
    const h = t.hoursLeft;
    const cls = t.submission === 'submitted' ? 'row--done' : (h != null && h < 24 ? 'row--urgent' : (h != null && h < 72 ? 'row--soon' : ''));
    const badge = t.submission === 'submitted' ? '<span class="badge badge--success">제출됨</span>' : (t.needsReview ? '<span class="badge badge--warning">확인 필요</span>' : `<span class="badge ${h != null && h < 24 ? 'badge--danger' : 'badge--neutral'}">${esc(fmtLeft(h))}</span>`);
    return `<div class="row ${cls}"><span class="row__rail"></span><div class="row__title" title="${esc(t.name)}">${esc(t.name)}</div><div class="row__meta">${esc(t.course)} · ${esc(t.dueKst || '마감 미정')}</div><div class="row__right">${badge}</div></div>`;
  }).join('');
  const evs = (home.events || []).slice(0, 8);
  const eb = $('home-events');
  if (!evs.length) eb.innerHTML = '<div class="empty"><div class="empty__title">예정된 시험·휴강이 없어요</div><div class="empty__sub">"일정"에서 공지를 분석해 추가할 수 있어요.</div></div>';
  else eb.innerHTML = evs.map(e => eventRow(e, false)).join('');
}
function eventRow(e, withCancel) {
  const kb = `<span class="badge badge--${KIND_BADGE[e.kind] || 'neutral'}">${esc(KIND_KO[e.kind] || e.kind)}</span>`;
  const cancel = withCancel ? `<button class="btn btn--sm btn--ghost ev-cancel" data-id="${e.id}" title="캘린더에서 취소">취소</button>` : '';
  return `<div class="row" data-id="${e.id}"><span class="row__rail"></span><div class="row__title">${esc(e.title || KIND_KO[e.kind] || '')}</div><div class="row__meta">${esc(e.date)}${e.startKst ? ' ' + esc(e.startKst) : ''} · ${esc(e.course)}${e.location ? ' · ' + esc(e.location) : ''}${e.confidence === 'auto' ? ' · 자동' : ''}</div><div class="row__right">${kb}${cancel}</div></div>`;
}
async function refreshHome() {
  home = await call(K.homeState);
  setSidebar();
  renderHome();
}

// ---- 새 버전 감지 ----
function showUpdate(info) {
  const old = document.querySelector('.banner--update');
  if (old) old.remove();
  $('st-update').style.display = info && info.available ? '' : 'none';
  if (!info || !info.available) return;
  const el = document.createElement('div');
  el.className = 'banner banner--ok banner--update';
  el.innerHTML = `<span>새 버전 v${esc(info.latest)}이 나왔어요 (현재 v${esc(info.current)})</span>`;
  const btn = document.createElement('button'); btn.className = 'btn btn--sm btn--primary'; btn.textContent = '다운로드';
  btn.addEventListener('click', () => call(K.updateOpen));
  el.appendChild(btn);
  $('home-banner').prepend(el);
}
async function checkUpdate(manual) {
  const hint = $('app-update-hint');
  if (manual) hint.textContent = '확인 중…';
  const info = await call(K.updateCheck);
  if (info && info.latest !== undefined) {
    showUpdate(info);
    hint.textContent = info.error ? `확인 실패: ${info.error}` : (info.available ? `새 버전 v${info.latest} (다운로드는 홈 배너)` : `최신 버전입니다 (v${info.current})`);
  } else if (manual) hint.textContent = errMsg(info, '확인 실패');
}
$('st-update-btn').addEventListener('click', () => call(K.updateOpen));

// ---- 로그인 오버레이 ----
function authShow(title, sub) {
  $('auth').classList.add('on');
  $('auth-title').textContent = title; $('auth-sub').textContent = sub || '';
  $('auth-num').style.display = 'none'; $('auth-num').className = 'auth__num'; $('auth-num').textContent = '–';
  $('auth-wait').style.display = ''; $('auth-wait-text').textContent = '잠시만요';
  $('auth-close').style.display = 'none';
}
function authFinish(ok, title, sub) {
  $('auth-title').textContent = title; $('auth-sub').textContent = sub || '';
  $('auth-wait').style.display = 'none';
  const n = $('auth-num');
  if (n.style.display !== 'none') n.className = 'auth__num ' + (ok ? 'ok' : 'bad');
  $('auth-close').style.display = '';
  if (ok) setTimeout(() => $('auth').classList.remove('on'), 1200);
}
$('auth-close').addEventListener('click', () => $('auth').classList.remove('on'));

function applyStatus(msg) {
  msg = msg || '';
  const m = /인증 번호:\s*([0-9A-Za-z]+)/.exec(msg);
  if (m && busy === 'login') {
    $('auth-title').textContent = '휴대폰에서 승인하세요';
    $('auth-sub').textContent = '아래 번호와 같은 것을 누르면 됩니다.';
    $('auth-num').textContent = m[1]; $('auth-num').style.display = '';
    $('auth-wait-text').textContent = '승인 기다리는 중';
    return;
  }
  if (busy === 'login') { $('auth-wait-text').textContent = msg; return; }
  if (busy === 'sync') { $('sync-step').textContent = msg; return; }
  if (tab === 'settings') { const h = $('wz-hint-' + step); if (h) h.textContent = msg; return; }
  if (tab === 'ai') $('chat-model-note').textContent = msg;
}

async function doLogin() {
  if (busy) return;
  busy = 'login'; setSidebar();
  authShow('로그인 중…', '학교 사이트에 연결하고 있습니다.');
  const res = await call(K.login);
  busy = null;
  if (res && res.ok) {
    loggedIn = true;
    authFinish(true, '로그인 완료', (res.sites || []).map(s => s.site + (s.state === 'ok' ? ' ✓' : ` ${s.state}`)).join('  '));
  } else {
    authFinish(false, '로그인 실패', errMsg(res, '알 수 없는 오류'));
  }
  refreshHome();
}

// ---- 동기화 ----
function syncBanner(kind, text, btnLabel, onBtn) {
  const b = $('sync-banner'); b.innerHTML = '';
  if (!kind) return;
  const el = document.createElement('div'); el.className = 'banner banner--' + kind;
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (btnLabel) { const btn = document.createElement('button'); btn.className = 'btn btn--sm btn--primary'; btn.textContent = btnLabel; btn.addEventListener('click', onBtn); el.appendChild(btn); }
  b.appendChild(el);
}
async function doSync() {
  if (busy) return;
  showTab('sync');
  busy = 'sync'; setSidebar();
  syncBanner(null);
  $('sync-go').disabled = true; $('q-sync').disabled = true;
  $('sync-progress').style.display = ''; $('sync-step').textContent = '수집을 시작합니다…';
  const res = await call(K.sync);
  busy = null;
  $('sync-go').disabled = false; $('q-sync').disabled = false;
  $('sync-progress').style.display = 'none';
  const wrap = $('sync-result-wrap'), out = $('sync-result');
  if (res && res.ok) {
    loggedIn = true;
    const parts = [`변경 ${res.changes}건`];
    if (res.newCandidates) parts.push(`새 일정 후보 ${res.newCandidates}건`);
    if (res.warnings && res.warnings.length) parts.push(`경고 ${res.warnings.length}`);
    syncBanner('ok', '동기화 완료 · ' + parts.join(' · '), res.newCandidates ? '일정 제안 보기' : null, () => { showTab('events'); sgRun(false); });
    navBadge('events', res.newCandidates || 0);
    out.innerHTML = `<div style="font-weight:600">${esc(new Date().toLocaleString('ko-KR', { hour12: false }))}</div><div class="caption" style="margin-top:4px">${parts.map(esc).join(' · ')}</div>` + (res.warnings && res.warnings.length ? `<div class="caption" style="margin-top:8px;color:var(--warning)">${res.warnings.map(esc).join('<br>')}</div>` : '');
    wrap.style.display = '';
  } else if (res && res.aborted) {
    if (res.code === 'SESSION_EXPIRED') syncBanner('warn', '세션이 만료됐어요. 로그인하면 폰 승인 한 번으로 끝납니다.', '로그인', doLogin);
    else syncBanner('danger', '중단: ' + (res.message || ''));
  } else {
    syncBanner('danger', '동기화 실패: ' + errMsg(res));
  }
  refreshHome();
}
function navBadge(name, n) { const b = $('nb-' + name); if (!b) return; b.textContent = n; b.classList.toggle('on', n > 0); }

// ---- 질문(AI 대화): 모델 선택기·노력 단계 ----
let effort = 'medium';
let aiInfo = null;
async function refreshChatTools() {
  aiInfo = await call(K.aiState);
  if (!aiInfo || aiInfo.error) return;
  const sel = $('chat-model'); sel.innerHTML = '';
  const src = aiInfo.source || (aiInfo.usingApiKey ? 'key' : 'local');
  for (const m of aiInfo.models) {
    const o = document.createElement('option'); o.value = 'local:' + m.uri;
    o.textContent = m.label.replace(/\s*\(.*\)$/, '') + (m.downloaded ? '' : ' · 받기 필요');
    if (m.selected && src === 'local') o.selected = true;
    sel.appendChild(o);
  }
  // ChatGPT 플랜: 로그인돼 있으면 모델마다 한 줄, 아니면 안내 한 줄(비활성)
  const cg = aiInfo.chatgpt || { loggedIn: false, models: [] };
  if (cg.loggedIn && cg.models.length) {
    for (const m of cg.models) {
      const o = document.createElement('option'); o.value = 'chatgpt:' + m.slug;
      o.textContent = `${m.name || m.slug} · ChatGPT 플랜`;
      if (src === 'chatgpt' && m.slug === cg.model) o.selected = true;
      sel.appendChild(o);
    }
  } else {
    const o = document.createElement('option'); o.value = 'chatgpt:';
    o.textContent = cg.loggedIn ? 'ChatGPT 플랜 (모델 목록 없음)' : 'ChatGPT 플랜 (설정에서 로그인)';
    o.disabled = !cg.loggedIn;
    if (src === 'chatgpt') o.selected = true;
    sel.appendChild(o);
  }
  const ext = document.createElement('option'); ext.value = 'external';
  ext.textContent = aiInfo.hasApiKey ? `${aiInfo.apiModel || 'gpt-6-luna'} · 외부(API 키)` : '외부 AI (설정에서 키 입력)';
  ext.disabled = !aiInfo.hasApiKey;
  if (src === 'key') ext.selected = true;
  sel.appendChild(ext);
  effort = aiInfo.effort || 'medium';
  document.querySelectorAll('#chat-effort button').forEach(b => b.classList.toggle('on', b.dataset.v === effort));
  $('chat-model-note').textContent = src === 'chatgpt' ? 'Using ChatGPT plan · 질문 내용이 OpenAI로 전송됩니다' : src === 'key' ? '질문 내용이 외부 서비스로 전송됩니다' : '로컬에서 실행 · 외부 전송 없음';
  $('chat-usage-link').style.display = src === 'chatgpt' ? '' : 'none';
}
$('chat-usage-link').addEventListener('click', e => { e.preventDefault(); call(K.chatgptUsage); });
$('chat-model').addEventListener('change', async e => {
  const v = e.target.value;
  const sel = v === 'external' ? { external: true } : v.startsWith('chatgpt:') ? { chatgpt: true, model: v.slice(8) || undefined } : { uri: v.slice(6) };
  const r = await call(K.aiSelect, sel);
  if (!r.ok) $('chat-model-note').textContent = errMsg(r);
  refreshChatTools();
});
document.querySelectorAll('#chat-effort button').forEach(b => b.addEventListener('click', () => {
  effort = b.dataset.v;
  document.querySelectorAll('#chat-effort button').forEach(x => x.classList.toggle('on', x === b));
  call(K.aiSetEffort, effort);
}));
function bubble(cls, text) {
  const e = $('chat-empty'); if (e) e.remove();
  const d = document.createElement('div'); d.className = 'bubble ' + cls; d.textContent = text;
  $('chat-log').appendChild(d); $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight; return d;
}
async function chatSend() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  bubble('bubble--user', q);
  const t = document.createElement('div'); t.className = 'typing'; t.innerHTML = '<span></span><span></span><span></span>';
  $('chat-log').appendChild(t); $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
  $('chat-send').disabled = true;
  const res = await call(K.ask, q, { effort });
  $('chat-send').disabled = false; t.remove();
  if (res && res.ok) {
    bubble('bubble--bot', res.answer);
    const meta = document.createElement('div'); meta.className = 'bubble__meta';
    meta.textContent = `${res.model || res.provider} · ${{ low: '빠르게', medium: '보통', high: '꼼꼼히' }[res.effort] || ''}`;
    $('chat-log').appendChild(meta);
  } else bubble('bubble--bot', '오류: ' + errMsg(res));
  $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
  $('chat-input').focus();
}
$('chat-send').addEventListener('click', chatSend);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) chatSend(); });

// ---- 일정: 제안(승인/거절) + 등록된 일정(취소) ----
function sgEmpty(text, cls) { $('sg-list').innerHTML = `<div class="card"><div class="empty"><div class="empty__sub" style="max-width:none;${cls === 'err' ? 'color:var(--danger)' : ''}">${esc(text)}</div></div></div>`; }
function sgRender(list) {
  const box = $('sg-list'); box.innerHTML = '';
  navBadge('events', list.length);
  if (!list.length) { sgEmpty('제안할 일정이 없어요. 새 공지가 없거나, AI가 일정을 찾지 못했습니다.'); return; }
  for (const s of list) {
    const card = document.createElement('div'); card.className = 'sugg';
    const grade = s.grade === 'A' ? '<span class="badge badge--success">검사 통과</span>' : '<span class="badge badge--warning">검사 보류 · 직접 확인</span>';
    card.innerHTML = `<div class="sugg__head"><span class="badge badge--${KIND_BADGE[s.kind] || 'neutral'}">${esc(KIND_KO[s.kind] || s.kind)}</span><span class="sugg__title">${esc(s.date)}${s.start ? ' ' + esc(s.start) : ''}</span>${grade}</div>`
      + `<div class="sugg__meta">${esc(s.course)} · ${esc(s.courseName || '')}</div>`
      + `<div class="sugg__quote">${esc(s.quote)}</div>`
      + (s.reasons && s.reasons.length ? `<div class="sugg__meta">검사: ${s.reasons.map(esc).join(', ')}</div>` : '');
    const act = document.createElement('div'); act.className = 'sugg__actions';
    const ok = document.createElement('button'); ok.className = 'btn btn--primary btn--sm'; ok.textContent = '승인 · 캘린더 등록';
    const no = document.createElement('button'); no.className = 'btn btn--ghost btn--sm'; no.textContent = '거절';
    const msg = document.createElement('span'); msg.className = 'sugg__meta';
    ok.addEventListener('click', async () => {
      ok.disabled = true; no.disabled = true; msg.textContent = '등록 중…';
      const r = await call(K.eventsRegister, { candidateId: s.candidateId, course: s.course, kind: s.kind, date: s.date, start: s.start || undefined, quote: s.quote });
      if (r.ok) { msg.innerHTML = '<span class="badge badge--success">승인됨 · 캘린더 등록</span>'; ok.remove(); no.remove(); refreshEventList(); refreshHome(); navBadge('events', Math.max(0, Number($('nb-events').textContent) - 1)); }
      else { msg.textContent = '실패: ' + errMsg(r); ok.disabled = false; no.disabled = false; }
    });
    no.addEventListener('click', async () => { await call(K.eventsDismiss, s.candidateId); card.classList.add('off'); ok.remove(); no.remove(); msg.textContent = '거절함 · 다시 묻지 않음'; navBadge('events', Math.max(0, Number($('nb-events').textContent) - 1)); });
    act.append(ok, no, msg); card.appendChild(act); box.appendChild(card);
  }
}
async function sgRun(all) {
  $('sg-run').disabled = true; $('sg-preview').disabled = true;
  $('sg-list').innerHTML = '<div class="card"><div class="empty"><div class="spinner"></div><div class="empty__title">공지를 분석하는 중</div><div class="empty__sub">로컬 AI라 후보 하나에 수 초, 전체는 수 분 걸릴 수 있어요.</div></div></div>';
  const res = await call(K.eventsSuggest, { all: !!all });
  $('sg-run').disabled = false; $('sg-preview').disabled = false;
  if (res && res.ok) sgRender(res.suggestions); else sgEmpty('오류: ' + errMsg(res), 'err');
}
$('sg-run').addEventListener('click', () => sgRun(false));
$('sg-preview').addEventListener('click', () => sgRun(true));
async function refreshEventList() {
  const r = await call(K.eventsList);
  const box = $('ev-list');
  if (!r || !r.ok) { box.innerHTML = `<div class="empty"><div class="empty__sub">${esc(errMsg(r))}</div></div>`; return; }
  if (!r.events.length) { box.innerHTML = '<div class="empty"><div class="empty__title">등록된 일정이 없어요</div></div>'; return; }
  box.innerHTML = r.events.map(e => eventRow(e, true)).join('');
  box.querySelectorAll('.ev-cancel').forEach(b => b.addEventListener('click', async () => {
    const row = b.closest('.row');
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '정말 취소'; b.className = 'btn btn--sm btn--danger'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = '취소'; b.className = 'btn btn--sm btn--ghost ev-cancel'; } }, 4000); return; }
    b.disabled = true;
    const r2 = await call(K.eventsCancel, Number(b.dataset.id));
    if (r2.ok) { row.style.opacity = .4; b.remove(); refreshHome(); }
    else { b.disabled = false; b.textContent = '실패: ' + errMsg(r2); }
  }));
}
$('ev-refresh').addEventListener('click', refreshEventList);

// ---- 설정: 네 항목(계정·드라이브·구글·AI)을 한 화면에 전부 펼친다(마법사 이전/다음 없음). step은 "마지막으로 만진 항목"(상태 메시지 표시용)
let step = 0;
let aiReady = false;
let aiSel = null;
function setStep(n) {
  step = Math.max(0, Math.min(3, n));
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('on', Number(s.dataset.step) === step));
  const el = document.querySelector(`.step[data-step="${step}"]`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
document.querySelectorAll('.step').forEach(s => s.addEventListener('click', () => { step = Number(s.dataset.step); document.querySelectorAll('.step').forEach(x => x.classList.toggle('on', x === s)); }, true));
const hint = (n, msg) => { $('wz-hint-' + n).textContent = msg || ''; };
function badge(id, ok, text) { const b = $(id); b.className = 'badge ' + (ok ? 'badge--success' : 'badge--warning'); b.textContent = text; }
async function refreshWizard() {
  const st = await call(K.setupState);
  if (!st || st.error) return null;
  badge('st-account', st.hasSavedId, st.hasSavedId ? '저장됨' : '필요');
  $('wz-login').textContent = st.hasSavedId ? '다시 로그인' : '로그인하고 아이디 저장';
  badge('st-drive', st.driveRootExists, st.driveRootExists ? '확인됨' : '폴더 확인 필요');
  $('wz-drive-path').textContent = st.driveRoot || '';
  badge('st-google', st.hasGoogleToken, st.hasGoogleToken ? ('연결됨' + (st.hasGmail ? ' · 메일' : '')) : '필요');
  if (st.hasGmail) $('wz-gmail').checked = true;
  return st;
}
function selectAi(uri) {
  aiSel = uri;
  document.querySelectorAll('.radio-card').forEach(c => c.classList.toggle('on', c.dataset.uri === uri));
  $('ai-ext-fields').style.display = uri === '__ext__' ? '' : 'none';
  $('ai-cg-fields').style.display = uri === '__chatgpt__' ? '' : 'none';
}
// ChatGPT 플랜 카드: 로그인 전/후 표시
function renderChatgptCard(cg) {
  const inEl = $('ai-cg-in'), outEl = $('ai-cg-out');
  inEl.style.display = cg.loggedIn ? '' : 'none';
  outEl.style.display = cg.loggedIn ? 'none' : '';
  if (!cg.loggedIn) return;
  $('ai-cg-who').textContent = `로그인됨${cg.email ? ' · ' + cg.email : ''} · Using ChatGPT plan`;
  const sel = $('ai-cg-model'); sel.innerHTML = '';
  if (!cg.models.length) { const o = document.createElement('option'); o.textContent = '모델 목록을 받지 못했습니다 (다시 로그인)'; o.value = ''; sel.appendChild(o); return; }
  for (const m of cg.models) { const o = document.createElement('option'); o.value = m.slug; o.textContent = m.name || m.slug; if (m.slug === cg.model) o.selected = true; sel.appendChild(o); }
}
async function refreshAi() {
  const st = await call(K.aiState);
  if (!st || st.error) return;
  const box = $('ai-models'); box.innerHTML = '';
  for (const m of st.models) {
    const c = document.createElement('div'); c.className = 'radio-card'; c.dataset.uri = m.uri;
    c.innerHTML = `<span class="radio-dot"></span><div style="flex:1;min-width:0"><b>${esc(m.label)}</b> ${m.downloaded ? '<span class="badge badge--success" style="height:18px">받음</span>' : ''}<div class="caption">${esc(m.sizeGb)}GB · ${esc(m.license)} · ${esc(m.note)}</div></div>`;
    c.addEventListener('click', () => selectAi(m.uri));
    box.appendChild(c);
  }
  if (st.apiBaseUrl) $('ai-base').value = st.apiBaseUrl;
  if (st.apiModel) $('ai-model').value = st.apiModel;
  const cur = st.models.find(m => m.selected);
  const src = st.source || (st.usingApiKey ? 'key' : 'local');
  renderChatgptCard(st.chatgpt || { loggedIn: false, models: [] });
  selectAi(src === 'key' ? '__ext__' : src === 'chatgpt' ? '__chatgpt__' : (cur ? cur.uri : null));
  aiReady = src !== 'local' || !!(cur && cur.downloaded);
  badge('st-ai', aiReady, src === 'key' ? '외부 AI' : src === 'chatgpt' ? 'ChatGPT 플랜' : (aiReady ? '준비됨' : '모델 받기 필요'));
  $('ai-download').style.display = src === 'local' ? '' : 'none';
}
$('ai-ext-card').addEventListener('click', () => selectAi('__ext__'));
$('ai-cg-card').addEventListener('click', () => selectAi('__chatgpt__'));
$('ai-cg-login').addEventListener('click', async e => {
  e.stopPropagation();
  $('ai-cg-login').disabled = true; hint(3, '브라우저에서 ChatGPT 계정으로 계속하세요 (5분 안에)…');
  const r = await call(K.chatgptLogin);
  $('ai-cg-login').disabled = false;
  if (!r.ok) { hint(3, errMsg(r)); return; }
  // 첫 로그인 1회 안내(OpenAI UI 지침: "You're using your ChatGPT plan")
  let seen = false; try { seen = localStorage.getItem('cg-plan-notice') === '1'; } catch { /* 무시 */ }
  if (!seen) { hint(3, 'ChatGPT 플랜을 사용합니다. 이 앱의 AI 질문·일정 제안이 내 ChatGPT 플랜 한도에서 차감됩니다. 한도는 chatgpt.com 설정 → Usage에서 관리할 수 있어요.'); try { localStorage.setItem('cg-plan-notice', '1'); } catch { /* 무시 */ } }
  else hint(3, `ChatGPT 연결 완료${r.email ? ' · ' + r.email : ''}.`);
  refreshAi(); refreshChatTools();
});
$('ai-cg-logout').addEventListener('click', async e => { e.stopPropagation(); await call(K.chatgptLogout); hint(3, 'ChatGPT 연결을 해제했습니다. 로컬 모델을 씁니다.'); refreshAi(); refreshChatTools(); });
$('ai-cg-usage').addEventListener('click', e => { e.stopPropagation(); call(K.chatgptUsage); });
$('ai-cg-model').addEventListener('click', e => e.stopPropagation());
$('ai-cg-model').addEventListener('change', async e => { e.stopPropagation(); if (e.target.value) { await call(K.aiSelect, { chatgpt: true, model: e.target.value }); refreshChatTools(); } });
document.querySelectorAll('.ai-preset').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation(); selectAi('__ext__');
  $('ai-base').value = b.dataset.base; $('ai-model').value = b.dataset.model; $('ai-key').focus();
}));
$('ai-save').addEventListener('click', async () => {
  if (!aiSel) { hint(3, '모델을 고르세요.'); return; }
  if (aiSel === '__chatgpt__') {
    const r = await call(K.aiSelect, { chatgpt: true, model: $('ai-cg-model').value || undefined });
    hint(3, r.ok ? 'ChatGPT 플랜으로 설정했습니다.' : errMsg(r));
  } else if (aiSel === '__ext__') {
    const apiKey = $('ai-key').value.trim();
    if (!apiKey) { hint(3, 'API 키를 입력하세요.'); return; }
    await call(K.aiSetApiKey, { apiKey, baseUrl: $('ai-base').value.trim(), model: $('ai-model').value.trim() });
    hint(3, '외부 AI로 설정했습니다.');
  } else {
    await call(K.aiSetModel, aiSel);
    hint(3, '로컬 모델을 설정했습니다. 아직 없으면 "모델 받기"로 내려받으세요.');
  }
  refreshAi();
});
$('ai-download').addEventListener('click', async () => {
  $('ai-download').disabled = true; hint(3, '모델을 내려받는 중… (수 분 걸릴 수 있어요)');
  const r = await call(K.aiDownload);
  $('ai-download').disabled = false;
  hint(3, r && r.ok ? 'AI 모델 준비 완료.' : ('모델 받기 실패: ' + errMsg(r)));
  refreshAi();
});
$('wz-login').addEventListener('click', async () => {
  hint(0, '로그인 창이 뜹니다. 아이디를 입력하고 폰 승인을 해 주세요…');
  const r = await call(K.login, { saveId: true, show: true });
  if (r && r.ok) loggedIn = true;
  hint(0, r && r.ok ? '계정 저장 완료.' : ('로그인 실패: ' + errMsg(r)));
  refreshWizard(); refreshHome();
});
$('wz-drive').addEventListener('click', async () => {
  hint(1, '폴더를 선택하세요…');
  const r = await call(K.pickDrive);
  hint(1, r && r.ok ? '폴더 저장 완료.' : '폴더 선택 취소.');
  refreshWizard();
});
$('wz-google').addEventListener('click', async () => {
  hint(2, '브라우저에서 구글 계정으로 승인해 주세요…');
  const r = await call(K.googleLogin, { gmail: $('wz-gmail').checked });
  hint(2, r && r.ok ? '구글 연결 완료.' : ('구글 승인 실패: ' + errMsg(r)));
  refreshWizard();
});
$('app-update-btn').addEventListener('click', () => checkUpdate(true));

// ---- 빠른 동작 ----
$('q-sync').addEventListener('click', doSync);
$('sync-go').addEventListener('click', doSync);
$('q-events').addEventListener('click', () => showTab('events'));
$('q-ai').addEventListener('click', () => showTab('ai'));
$('home-more-events').addEventListener('click', () => showTab('events'));

// ---- 초기화 ----
(async () => {
  try {
    const info = await call(K.appInfo);
    if (info && info.version) { $('app-ver').textContent = `v${info.version}`; $('app-ver2').textContent = `v${info.version} · Electron ${info.electron}`; }
    if (K.onStatus) K.onStatus(applyStatus);
    if (K.onTriggerSync) K.onTriggerSync(() => doSync());
    if (K.onUpdate) K.onUpdate(showUpdate);
    const st = await refreshWizard();
    await refreshAi();
    await refreshHome();
    if (st && !(st.hasSavedId && st.hasGoogleToken)) { showTab('settings'); setStep(st.hasSavedId ? 2 : 0); }
    else showTab('home');
    checkUpdate(false);
  } catch (e) { console.error('init', e); showTab('home'); }
})();
