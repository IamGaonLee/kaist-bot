// 렌더러 UI 로직 (plain JS, Node 접근 없음). window.kaist는 preload가 노출.
(async () => {
  try {
    const info = await window.kaist.appInfo();
    document.getElementById('ver').textContent = `v${info.version} · Electron ${info.electron}`;
  } catch (e) {
    document.getElementById('status').textContent = '앱 정보를 불러오지 못했습니다: ' + e;
  }
  window.kaist.onStatus?.(msg => { document.getElementById('status').textContent = msg; });
})();
