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
// 공유 구글 OAuth 클라이언트를 설치 파일 안(dist-electron/google-client.json)으로. app/main.ts가 이 경로를 번들 클라이언트로 등록한다.
// 출처: app/google-client.json(저장소에는 없음, 릴리스 CI가 시크릿 GOOGLE_OAUTH_CLIENT_JSON으로 만든다. .gitignore)
//       → 없으면 개발 PC의 %LOCALAPPDATA%\kaist-cli\google-client.json. 둘 다 없으면 빌드를 멈춘다
//       (v1.0.0~1.2.0은 이 파일이 빠져 다른 PC에서 구글 연결이 안 됐다).
const clientCandidates = [
  path.join(process.cwd(), 'app', 'google-client.json'),
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'kaist-cli', 'google-client.json') : '',
].filter(Boolean);
const clientSrc = clientCandidates.find(f => fs.existsSync(f));
if (!clientSrc) { console.error('구글 OAuth 클라이언트 파일이 없습니다(app/google-client.json 또는 %LOCALAPPDATA%\\kaist-cli\\google-client.json). 구글 연결이 되는 설치 파일을 만들 수 없습니다.'); process.exit(1); }
fs.copyFileSync(clientSrc, path.join(process.cwd(), 'dist-electron', 'google-client.json'));
console.log('renderer·preload·google-client 복사 완료 →', path.relative(process.cwd(), appDst));
