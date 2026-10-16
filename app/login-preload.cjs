// 숨긴 로그인 창의 preload. window.alert/confirm/prompt을 가로채 메시지를 보관한다(네이티브 창이 뜨지 않게).
// contextIsolation:false로 페이지 메인 월드에서 돈다. Node는 쓰지 않는다.
(() => {
  const record = (m) => { try { window.__kaistDialogMsg = String(m == null ? '' : m); } catch (e) { /* ignore */ } };
  window.alert = (m) => record(m);
  window.confirm = (m) => { record(m); return false; };
  window.prompt = (m) => { record(m); return null; };
})();
