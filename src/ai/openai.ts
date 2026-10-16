// 외부 AI 공급자 (OpenAI 호환 /chat/completions). 사용자가 자기 API 키를 넣으면 사용(결정 8).
// 이 경우 프롬프트 내용이 그 제공자로 나간다 — 사용자의 선택.
//
// 제공자마다 받는 필드가 다르다(2026-10-16 문서 확인):
// - OpenAI GPT-5/6 계열: max_tokens 거부(→ max_completion_tokens), temperature는 기본값만, reasoning_effort 지원
// - Anthropic 호환층(api.anthropic.com/v1): response_format·reasoning_effort 무시, Claude 4.7+는 temperature<1이면 400
// - Gemini 호환층(generativelanguage.googleapis.com/v1beta/openai): reasoning_effort·response_format 지원
// 그래서 400이 오면 오류 문구에 적힌 필드를 빼거나 바꿔 다시 보낸다(최대 4회). SDK 없이 fetch만 쓴다.
import { KaistError } from '../errors.js';
import type { AiProvider, CompleteOptions } from './provider.js';

type Body = Record<string, unknown>;

/** 400 응답 문구를 보고 다음 시도에서 고칠 것을 정한다. 못 알아보면 순서대로 하나씩 뺀다. 고칠 게 없으면 null */
export function adjustForError(body: Body, message: string): Body | null {
  const m = message.toLowerCase();
  const next = { ...body };
  const fix = (f: () => void) => { f(); return next; };
  if (m.includes('max_tokens') && 'max_tokens' in next) return fix(() => { next.max_completion_tokens = next.max_tokens; delete next.max_tokens; });
  if (m.includes('temperature') && 'temperature' in next) return fix(() => { delete next.temperature; });
  if (m.includes('reasoning_effort') && 'reasoning_effort' in next) return fix(() => { delete next.reasoning_effort; });
  if (m.includes('response_format') && 'response_format' in next) return fix(() => { delete next.response_format; });
  // 문구를 못 알아보면 흔한 순서대로
  if ('reasoning_effort' in next) return fix(() => { delete next.reasoning_effort; });
  if ('temperature' in next) return fix(() => { delete next.temperature; });
  if ('max_tokens' in next) return fix(() => { next.max_completion_tokens = next.max_tokens; delete next.max_tokens; });
  if ('response_format' in next) return fix(() => { delete next.response_format; });
  return null;
}

/** 응답에서 JSON 객체만 뽑는다(코드펜스·앞뒤 설명 제거). response_format을 무시하는 제공자(Anthropic 호환층) 대비 */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* 아래에서 중괄호 범위로 재시도 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 실패 */ } }
  throw new KaistError('AI_JSON', 'AI가 JSON을 돌려주지 않았습니다.');
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'byo-key';
  readonly label: string;
  constructor(private key: string, private baseUrl = 'https://api.openai.com/v1', private model = 'gpt-6-luna', private fetchImpl: typeof fetch = fetch) {
    this.label = model;
  }

  private async post(body: Body): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
    });
  }

  private async chat(messages: object[], opts: CompleteOptions & { jsonSchema?: object } = {}): Promise<string> {
    let body: Body = { model: this.model, messages, max_tokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.2 };
    if (opts.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'result', schema: opts.jsonSchema, strict: true } };
    if (opts.effort && opts.effort !== 'medium') body.reasoning_effort = opts.effort;
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await this.post(body);
      if (r.ok) {
        const j = await r.json() as { choices?: { message?: { content?: string } }[] };
        return j.choices?.[0]?.message?.content ?? '';
      }
      const text = await r.text().catch(() => '');
      if (r.status === 401 || r.status === 403) throw new KaistError('AI_AUTH', 'API 키가 틀렸거나 권한이 없습니다 (HTTP ' + r.status + ').');
      if (r.status === 404) throw new KaistError('AI_MODEL', `모델이나 주소를 찾지 못했습니다 (HTTP 404). 모델명·Base URL을 확인하세요: ${this.model}`);
      if (r.status === 429) throw new KaistError('AI_RATE', '요청 한도를 넘었거나 잔액이 없습니다 (HTTP 429).');
      if (r.status !== 400) throw new KaistError('AI_HTTP', `AI 요청 실패 (HTTP ${r.status})`);
      // Gemini는 키가 틀려도 400(API_KEY_INVALID)을 돌려준다
      if (/api[_ ]key[_ ]invalid|api key not valid/i.test(text)) throw new KaistError('AI_AUTH', 'API 키가 틀렸습니다 (Gemini: API key not valid).');
      const next = adjustForError(body, text);
      if (!next) throw new KaistError('AI_HTTP', `AI 요청 거부 (HTTP 400): ${text.slice(0, 200)}`);
      body = next;
    }
    throw new KaistError('AI_HTTP', 'AI 요청을 여러 번 고쳐 보냈지만 거부됐습니다.');
  }

  async complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
    return (await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], opts)).trim();
  }

  async completeJson<T = unknown>(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}): Promise<T> {
    // response_format을 무시하는 제공자를 위해 지시문도 함께 준다
    const sys = `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체만 출력한다(설명·코드펜스 없이): ${JSON.stringify(schema)}`;
    const text = await this.chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { ...opts, temperature: 0, jsonSchema: schema });
    return extractJson(text) as T;
  }
}
