// 로컬 AI 공급자 (node-llama-cpp, Vulkan/CPU). 모델은 %LOCALAPPDATA%\kaist-cli\models.
// node-llama-cpp는 ESM·네이티브라 여기서만 동적 import 한다.
import path from 'node:path';
import { paths, ensureDir } from '../config.js';
import type { AiProvider } from './provider.js';

// 기본 모델: 한국어 되는 중소형 GGUF(Qwen2.5-3B Q4, 약 2GB). 설정 aiModelUri로 바꿀 수 있다.
export const DEFAULT_MODEL_URI = 'hf:bartowski/Qwen2.5-3B-Instruct-GGUF:Qwen2.5-3B-Instruct-Q4_K_M.gguf';

/* eslint-disable @typescript-eslint/no-explicit-any */
export class LocalProvider implements AiProvider {
  readonly name = 'local';
  private uri: string;
  private llama: any = null;
  private model: any = null;
  private modelPath: string | null = null;

  constructor(uri?: string) {
    this.uri = uri ?? DEFAULT_MODEL_URI;
  }

  async ensureReady(onStatus?: (m: string) => void): Promise<void> {
    if (this.model) return;
    const nlc = await import('node-llama-cpp');
    const modelsDir = path.join(paths.home, 'models');
    ensureDir(modelsDir);
    onStatus?.('AI 모델을 준비하고 있습니다(처음이면 다운로드)…');
    // URI면 받아서 로컬 경로로, 이미 로컬 경로면 그대로
    this.modelPath = /^(hf:|https?:)/.test(this.uri) ? await nlc.resolveModelFile(this.uri, modelsDir) : this.uri;
    this.llama = await nlc.getLlama();
    this.model = await this.llama.loadModel({ modelPath: this.modelPath });
    onStatus?.('AI 모델 준비 완료.');
  }

  private async session(system: string): Promise<{ session: any; ctx: any }> {
    await this.ensureReady();
    const nlc = await import('node-llama-cpp');
    const ctx = await this.model.createContext({ contextSize: 8192 });
    const session = new nlc.LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: system });
    return { session, ctx };
  }

  async complete(system: string, user: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    const { session, ctx } = await this.session(system);
    try {
      const out = await session.prompt(user, { maxTokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.2 });
      return String(out).trim();
    } finally {
      await ctx.dispose();
    }
  }

  async completeJson<T = unknown>(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}): Promise<T> {
    await this.ensureReady();
    const nlc = await import('node-llama-cpp');
    const ctx = await this.model.createContext({ contextSize: 8192 });
    try {
      const grammar = await this.llama.createGrammarForJsonSchema(schema);
      const session = new nlc.LlamaChatSession({ contextSequence: ctx.getSequence(), systemPrompt: system });
      const out = await session.prompt(user, { grammar, maxTokens: opts.maxTokens ?? 512, temperature: 0 });
      return grammar.parse(out) as T;
    } finally {
      await ctx.dispose();
    }
  }

  async dispose(): Promise<void> {
    await this.model?.dispose?.();
    this.model = null;
  }
}
