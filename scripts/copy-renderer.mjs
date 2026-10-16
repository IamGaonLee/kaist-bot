// 렌더러 정적 파일(html/js/css)을 dist-electron로 복사한다 (tsc는 .ts만 내보냄).
import fs from 'node:fs';
import path from 'node:path';

const src = path.join(process.cwd(), 'app', 'renderer');
const dst = path.join(process.cwd(), 'dist-electron', 'app', 'renderer');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (/\.(html|js|css|png|svg)$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
// tsc가 내보내지 않는 preload(.cjs)도 복사
const appDst = path.join(process.cwd(), 'dist-electron', 'app');
for (const f of ['login-preload.cjs', 'preload.cjs']) {
  fs.copyFileSync(path.join(process.cwd(), 'app', f), path.join(appDst, f));
}
console.log('renderer·preload 복사 완료 →', path.relative(process.cwd(), appDst));
