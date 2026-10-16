// ChatGPT 플랜 공급자: Sign in with ChatGPT 토큰으로 Responses API 호출.
// 공식 제약(https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations, 2026-10-16):
//  - POST https://api.openai.com/v1/responses 만(backend-api 금지), store:false·stream:true 필수
//  - 시스템 내용은 instructions로(system role 메시지는 거부), previous_response_id 금지
//  - temperature·top_p·max_output_tokens·metadata·user 등은 보낼 수 없다 → 길이는 지시문으로만 조절
//  - 한도 초과는 스트림 중 response.failed(subscription_sharing_usage_limit_exceeded)로 온다
import { KaistError } from '../errors.js';
import type { AiProvider, CompleteOptions } from './provider.js';
import { extractJson } from './openai.js';
import { chatGptAccessToken, RESOURCE, USAGE_URL } from './chatgpt-auth.js';

type Body = Record<string, unknown>;
export type TokenGetter = (force?: boolean) => Promise<string>;

/** SSE 본문에서 data: JSON 이벤트만 뽑는다 */
export function parseSseEvents(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { out.push(JSON.parse(data) as Record<string, unknown>); } catch { /* 깨진 조각은 건너뜀 */ }
  }
  return out;
}

/** 스트림 이벤트를 모아 최종 텍스트로. 실패 이벤트는 오류로 바꾼다 */
export function collectResponseText(events: Record<string, unknown>[]): string {
  let text = '';
  let completedText: string | null = null;
  for (const ev of events) {
    const type = String(ev.type ?? '');
    if (type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
    else if (type === 'response.failed' || type === 'error') throw failureError(ev);
    else if (type === 'response.completed' || type === 'response.incomplete') {
      // 델타를 못 받았으면 완료 이벤트의 output에서 텍스트를 꺼낸다
      const resp = (ev.response ?? {}) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
      const joined = (resp.output ?? []).filter(o => o.type === 'message').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '').join('');
      if (joined) completedText = joined;
    }
  }
  return text || completedText || '';
}

function failureError(ev: Record<string, unknown>): KaistError {
  const resp = (ev.response ?? {}) as { error?: { code?: string; message?: string } };
  const err = (resp.error ?? (ev.error as { code?: string; message?: string } | undefined) ?? (ev as { code?: string; message?: string }));
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  if (code === 'subscription_sharing_usage_limit_exceeded') return new KaistError('AI_RATE', `ChatGPT 플랜 사용 한도에 도달했습니다. 사용량 관리: ${USAGE_URL}`);
  if (code === 'subscription_sharing_usage_unavailable') return new KaistError('AI_RATE', `지금은 ChatGPT 플랜 사용을 할 수 없습니다(요금제나 설정 확인). 사용량 관리: ${USAGE_URL}`);
  return new KaistError('AI_HTTP', `ChatGPT 응답 실패: ${code} ${msg}`.trim());
}

/** 400 문구를 보고 다음 시도에서 뺄 필드를 정한다(미리보기 제약이 바뀔 수 있어 방어적으로) */
export function adjustResponsesBody(body: Body, message: string): Body | null {
  const m = message.toLowerCase();
  const next = { ...body };
  const drop = (k: string) => { delete next[k]; return next; };
  if ('reasoning' in next && m.includes('reasoning')) return drop('reasoning');
  if ('text' in next && (m.includes('text.format') || m.includes('json_schema') || m.includes("'text'") || m.includes('"text"'))) return drop('text');
  if ('reasoning' in next) return drop('reasoning');
  if ('text' in next) return drop('text');
  return null;
}

export class ChatGptProvider implements AiProvider {
  readonly name = 'chatgpt';
  readonly label: string;
  constructor(private model: string, private fetchImpl: typeof fetch = fetch, private getToken: TokenGetter = (force) => chatGptAccessToken(fetch, force)) {
    this.label = `${model} · ChatGPT 플랜`;
  }

  private async post(body: Body, token: string): Promise<Response> {
    return this.fetchImpl(`${RESOURCE}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  private async run(instructions: string, user: string, opts: CompleteOptions & { jsonSchema?: object } = {}): Promise<string> {
    let body: Body = { model: this.model, instructions, input: [{ role: 'user', content: user }], store: false, stream: true };
    if (opts.effort && opts.effort !== 'medium') body.reasoning = { effort: opts.effort };
    if (opts.jsonSchema) body.text = { format: { type: 'json_schema', name: 'result', schema: opts.jsonSchema, strict: true } };
    let token = await this.getToken();
    let refreshed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await this.post(body, token);
      if (r.ok) return collectResponseText(parseSseEvents(await r.text()));
      const text = await r.text().catch(() => '');
      if (r.status === 401 && !refreshed) { refreshed = true; token = await this.getToken(true); continue; }
      if (r.status === 401 || r.status === 403) throw new KaistError('CHATGPT_REAUTH', 'ChatGPT 로그인이 만료됐거나 권한이 없습니다. 설정에서 다시 로그인해 주세요.');
      if (r.status === 404) throw new KaistError('AI_MODEL', `모델을 찾지 못했습니다 (HTTP 404): ${this.model}. 설정에서 다른 모델을 고르세요.`);
      if (r.status === 429) throw new KaistError('AI_RATE', `ChatGPT 플랜 사용 한도에 도달했거나 요청이 너무 잦습니다 (HTTP 429). 사용량 관리: ${USAGE_URL}`);
      if (r.status !== 400) throw new KaistError('AI_HTTP', `ChatGPT 요청 실패 (HTTP ${r.status})`);
      const next = adjustResponsesBody(body, text);
      if (!next) throw new KaistError('AI_HTTP', `ChatGPT 요청 거부 (HTTP 400): ${text.slice(0, 200)}`);
      body = next;
    }
    throw new KaistError('AI_HTTP', 'ChatGPT 요청을 여러 번 고쳐 보냈지만 거부됐습니다.');
  }

  async complete(system: string, user: string, opts: CompleteOptions = {}): Promise<string> {
    // max_output_tokens를 못 쓰므로 길이는 지시문으로
    const len = opts.maxTokens ? `\n\n답변은 약 ${Math.round(opts.maxTokens * 0.7)}자 이내로 간결하게.` : '';
    return (await this.run(system + len, user, opts)).trim();
  }

  async completeJson<T = unknown>(system: string, user: string, schema: object, opts: { maxTokens?: number } = {}): Promise<T> {
    const sys = `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체만 출력한다(설명·코드펜스 없이): ${JSON.stringify(schema)}`;
    const text = await this.run(sys, user, { ...opts, jsonSchema: schema });
    return extractJson(text) as T;
  }
}
