// 외부 AI 공급자 (OpenAI 호환 /chat/completions). 사용자가 자기 API 키를 넣으면 사용(결정 8).
// 이 경우 프롬프트 내용이 그 제공자로 나간다 — 사용자의 선택.
import { KaistError } from '../errors.js';
import type { AiProvider } from './provider.js';

export class OpenAiProvider implements AiProvider {
  readonly name = 'byo-key';
  constructor(private key: string, private baseUrl = 'https://api.openai.com/v1', private model = 'gpt-4o-mini') {}

  private async chat(messages: object[], opts: { maxTokens?: number; temperature?: number; jsonSchema?: object } = {}): Promise<string> {
    const body: Record<string, unknown> = { model: this.model, messages, max_tokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.2 };
    if (opts.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: opts.jsonSchema, strict: true } };
    const r = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new KaistError('AI_HTTP', `AI 요청 실패 (HTTP ${r.status})`);
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }

  async complete(system: string, user: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string> {
    return (await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], opts)).trim();
  }

  async completeJson<T = unknown>(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}): Promise<T> {
    const text = await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], { ...opts, temperature: 0, jsonSchema: schema });
    try { return JSON.parse(text) as T; }
    catch { throw new KaistError('AI_JSON', 'AI가 JSON을 돌려주지 않았습니다.'); }
  }
}
