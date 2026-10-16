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
  /** 로컬 AI 모델 GGUF (node-llama-cpp URI 또는 로컬 경로). 없으면 기본값 */
  aiModelUri?: string;
  /** 자기 API 키로 외부 모델 사용 (OpenAI 호환). 넣으면 로컬 대신 이 모델 */
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  /** 키가 있어도 로컬을 쓰려면 false (대화창 모델 선택기). 기본: 키가 있으면 외부 */
  aiUseExternal?: boolean;
  /** 답변 노력(길이·추론). 로컬은 답변 길이 상한, 외부 추론 모델은 reasoning_effort */
  aiEffort?: AiEffort;
}

export type AiEffort = 'low' | 'medium' | 'high';

export function loadSettings(): Settings {
  const file = path.join(home, 'config.json');
  let user: Partial<Settings> = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Partial<Settings>; }
    catch { throw new Error(`설정 파일을 읽지 못했습니다: ${file}`); }
  }
  return { driveRoot: process.env.KAIST_DRIVE_ROOT ?? user.driveRoot ?? 'G:\\내 드라이브\\KAIST' };
}

const configFile = () => path.join(home, 'config.json');

/** config.json의 일부를 병합 저장 (없던 키는 추가) */
export function saveSettings(patch: Partial<Settings>): void {
  let cur: Partial<Settings> = {};
  if (fs.existsSync(configFile())) {
    try { cur = JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, '')) as Partial<Settings>; } catch { /* 새로 쓴다 */ }
  }
  ensureDir(home);
  fs.writeFileSync(configFile(), JSON.stringify({ ...cur, ...patch }, null, 2));
}

/** 설정 파일이 있는지 (첫 실행 판별 보조) */
export const hasConfig = () => fs.existsSync(configFile());
