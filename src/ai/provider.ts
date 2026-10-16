// AI 공급자 추상화 (결정 8). 기본은 로컬(node-llama-cpp), 설정에 API 키가 있으면 그 모델.
// 코어는 이 인터페이스만 쓴다. node-llama-cpp는 로컬 공급자에서만 동적 import(미사용 시 안 불러옴).
import { loadSettings } from '../config.js';

export interface AiProvider {
  /** 이름(로그·표시용) */
  readonly name: string;
  /** 자유 텍스트 생성 */
  complete(system: string, user: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string>;
  /** JSON 스키마에 맞는 결과만 (로컬은 grammar로 강제, 외부는 JSON 모드) */
  completeJson<T = unknown>(system: string, user: string, schema: object, opts?: { maxTokens?: number }): Promise<T>;
  /** 모델 준비(다운로드·로드). onStatus로 진행 알림 */
  ensureReady?(onStatus?: (m: string) => void): Promise<void>;
  dispose?(): Promise<void>;
}

let current: AiProvider | null = null;

/** 설정에 따라 공급자를 고른다(캐시). API 키가 있으면 외부, 없으면 로컬. */
export async function getAiProvider(): Promise<AiProvider> {
  if (current) return current;
  const s = loadSettings();
  if (s.aiApiKey) {
    const { OpenAiProvider } = await import('./openai.js');
    current = new OpenAiProvider(s.aiApiKey, s.aiBaseUrl, s.aiModel);
  } else {
    const { LocalProvider } = await import('./local.js');
    current = new LocalProvider(s.aiModelUri);
  }
  return current;
}

/** 공급자 교체 시 캐시 비우기 */
export async function resetAiProvider(): Promise<void> {
  await current?.dispose?.();
  current = null;
}
