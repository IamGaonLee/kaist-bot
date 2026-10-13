import fs from 'node:fs';
import path from 'node:path';

/** 쿠키·토큰·DB 등 비밀값이 사는 곳. 드라이브/OneDrive 밖이어야 한다. */
function resolveHome(): string {
  const override = process.env.KAIST_HOME;
  if (override) return path.resolve(override);
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('LOCALAPPDATA 환경변수가 없습니다. Windows에서 실행해야 합니다.');
  return path.join(localAppData, 'kaist-cli');
}

const home = resolveHome();
if (/[\\/](OneDrive|Google Drive|내 드라이브|My Drive)([\\/]|$)/i.test(home)) {
  throw new Error(`로컬 상태 저장소가 동기화 폴더 안에 있습니다: ${home}. 세션 쿠키가 클라우드로 올라가므로 거부합니다.`);
}

export const paths = {
  home,
  session: path.join(home, 'session.json'),
  data: path.join(home, 'data'),
};

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 사용자 설정 (%LOCALAPPDATA%\kaist-cli\config.json). 없으면 기본값 */
export interface Settings {
  /** 드라이브 동기화 폴더 안의 루트. 기본 G:\내 드라이브\KAIST */
  driveRoot: string;
}

export function loadSettings(): Settings {
  const file = path.join(home, 'config.json');
  let user: Partial<Settings> = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Partial<Settings>; }
    catch { throw new Error(`설정 파일을 읽지 못했습니다: ${file}`); }
  }
  return { driveRoot: process.env.KAIST_DRIVE_ROOT ?? user.driveRoot ?? 'G:\\내 드라이브\\KAIST' };
}
