// AI 공급자 추상화 (결정 8). 기본은 로컬(node-llama-cpp), 설정에 API 키가 있고 aiUseExternal이 꺼져 있지 않으면 외부 모델.
// 코어는 이 인터페이스만 쓴다. node-llama-cpp는 로컬 공급자에서만 동적 import(미사용 시 안 불러옴).
import { loadSettings, type AiEffort } from '../config.js';

export interface CompleteOptions {
  maxTokens?: number;
  temperature?: number;
  /** 추론 모델이면 reasoning_effort로 전달. 로컬 모델은 무시(길이는 maxTokens로) */
  effort?: AiEffort;
}

export interface AiProvider {
  /** 이름(로그·표시용): 'local' | 'byo-key' */
  readonly name: string;
  /** 사용자에게 보여줄 모델 이름 */
  readonly label: string;
  /** 자유 텍스트 생성 */
  complete(system: string, user: string, opts?: CompleteOptions): Promise<string>;
  /** JSON 스키마에 맞는 결과만 (로컬은 grammar로 강제, 외부는 JSON 모드) */
  completeJson<T = unknown>(system: string, user: string, schema: object, opts?: { maxTokens?: number }): Promise<T>;
  /** 모델 준비(다운로드·로드). onStatus로 진행 알림 */
  ensureReady?(onStatus?: (m: string) => void): Promise<void>;
  dispose?(): Promise<void>;
}

/** 노력 단계 → 답변 토큰 상한. 로컬 모델은 이것만 달라진다(추론 단계가 없음) */
export const EFFORT_MAX_TOKENS: Record<AiEffort, number> = { low: 300, medium: 600, high: 1200 };

export function useExternal(s = loadSettings()): boolean {
  return !!s.aiApiKey && s.aiUseExternal !== false;
}

let current: AiProvider | null = null;

/** 설정에 따라 공급자를 고른다(캐시). */
export async function getAiProvider(): Promise<AiProvider> {
  if (current) return current;
  const s = loadSettings();
  if (useExternal(s)) {
    const { OpenAiProvider } = await import('./openai.js');
    current = new OpenAiProvider(s.aiApiKey!, s.aiBaseUrl, s.aiModel);
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
