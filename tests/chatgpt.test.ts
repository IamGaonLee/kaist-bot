// Continue with ChatGPT: 인증 URL·콜백 검사·모델 목록·SSE 해석·공급자 (네트워크 없음, fetch는 가짜)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, parseCallback, pickModels, decodeJwtPayload, pkcePair, SCOPES, RESOURCE } from '../src/ai/chatgpt-auth.js';
import { parseSseEvents, collectResponseText, adjustResponsesBody, ChatGptProvider } from '../src/ai/chatgpt.js';

test('pkcePair: S256 챌린지는 base64url, 패딩 없음', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.doesNotMatch(challenge, /[+/=]/);
});

test('buildAuthorizeUrl: 첫 등록은 dynamic_agent_client + agent_name_hint, 재로그인은 저장된 client_id + id_token_hint', () => {
  const base = { hostId: 'host-1', redirectUri: 'http://127.0.0.1:1455/auth/callback', state: 's', nonce: 'n', challenge: 'c' };
  const first = new URL(buildAuthorizeUrl(base));
  assert.equal(first.origin + first.pathname, 'https://auth.openai.com/api/accounts/authorize');
  assert.equal(first.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(first.searchParams.get('agent_name_hint'), 'KAISTBOT');
  assert.equal(first.searchParams.get('ext_agent_host_id'), 'host-1');
  assert.equal(first.searchParams.get('scope'), SCOPES.join(' '));
  assert.equal(first.searchParams.get('resource'), RESOURCE);
  assert.equal(first.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(first.searchParams.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback');
  assert.equal(first.searchParams.get('id_token_hint'), null);

  const again = new URL(buildAuthorizeUrl({ ...base, clientId: 'oaiapp_x', idTokenHint: 'jwt', loginHint: 'a@b.c' }));
  assert.equal(again.searchParams.get('client_id'), 'oaiapp_x');
  assert.equal(again.searchParams.get('agent_name_hint'), null);
  assert.equal(again.searchParams.get('id_token_hint'), 'jwt');
  assert.equal(again.searchParams.get('login_hint'), 'a@b.c');
});

test('parseCallback: state 검사, 거절, 첫 등록은 client_id 필수, 재로그인은 일치해야 함', () => {
  const q = (s: string) => new URLSearchParams(s);
  assert.throws(() => parseCallback(q('code=1&state=bad'), { state: 'ok' }), /state/);
  assert.throws(() => parseCallback(q('error=access_denied&state=ok'), { state: 'ok' }), /취소/);
  assert.throws(() => parseCallback(q('code=1&state=ok'), { state: 'ok' }), /client_id/);
  assert.deepEqual(parseCallback(q('code=1&state=ok&client_id=oaiapp_a&scope=openid+chatgpt.tokens.use.direct'), { state: 'ok' }), { code: '1', clientId: 'oaiapp_a', scope: 'openid chatgpt.tokens.use.direct' });
  assert.deepEqual(parseCallback(q('code=2&state=ok'), { state: 'ok', clientId: 'oaiapp_a' }), { code: '2', clientId: 'oaiapp_a', scope: undefined });
  assert.throws(() => parseCallback(q('code=2&state=ok&client_id=oaiapp_b'), { state: 'ok', clientId: 'oaiapp_a' }), /다릅니다/);
});

test('pickModels: visibility=list만, 서버 순서 유지, data 배열(표준 형식)도 허용', () => {
  assert.deepEqual(pickModels({ models: [
    { slug: 'gpt-5.1', display_name: 'GPT-5.1', visibility: 'list' },
    { slug: 'gpt-5-hidden', display_name: 'x', visibility: 'hidden' },
    { slug: 'gpt-5.1-mini', display_name: 'GPT-5.1 mini', visibility: 'list' },
  ] }), [{ slug: 'gpt-5.1', name: 'GPT-5.1' }, { slug: 'gpt-5.1-mini', name: 'GPT-5.1 mini' }]);
  assert.deepEqual(pickModels({ data: [{ id: 'gpt-4o' }] }), [{ slug: 'gpt-4o', name: 'gpt-4o' }]);
  assert.deepEqual(pickModels(null), []);
});

test('decodeJwtPayload: payload만 읽는다(검증 없음)', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'a@b.c', nonce: 'n1' })).toString('base64url');
  assert.deepEqual(decodeJwtPayload(`h.${payload}.sig`), { email: 'a@b.c', nonce: 'n1' });
  assert.equal(decodeJwtPayload('garbage'), null);
  assert.equal(decodeJwtPayload(undefined), null);
});

const SSE_OK = [
  'event: response.created\ndata: {"type":"response.created"}',
  'data: {"type":"response.output_text.delta","delta":"안녕"}',
  'data: {"type":"response.output_text.delta","delta":"하세요"}',
  'data: {"type":"response.completed","response":{"output":[]}}',
].join('\n\n') + '\n\n';

test('parseSseEvents/collectResponseText: 델타를 이어 붙인다', () => {
  const ev = parseSseEvents(SSE_OK);
  assert.equal(ev.length, 4);
  assert.equal(collectResponseText(ev), '안녕하세요');
});

test('collectResponseText: 델타 없이 완료 이벤트만 오면 output에서 꺼낸다', () => {
  const ev = parseSseEvents('data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"본문"}]}]}}\n\n');
  assert.equal(collectResponseText(ev), '본문');
});

test('collectResponseText: 플랜 한도 초과는 AI_RATE + 사용량 관리 링크', () => {
  const ev = parseSseEvents('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"limit"}}}\n\n');
  assert.throws(() => collectResponseText(ev), (e: { code: string; message: string }) => e.code === 'AI_RATE' && /chatgpt.com\/settings\/usage/.test(e.message));
});

test('adjustResponsesBody: 문구에 맞는 필드를 빼고, 못 알아보면 reasoning → text 순', () => {
  const b = { model: 'm', reasoning: { effort: 'high' }, text: { format: {} } };
  assert.deepEqual(adjustResponsesBody(b, "Unsupported parameter: 'text.format'"), { model: 'm', reasoning: { effort: 'high' } });
  assert.deepEqual(adjustResponsesBody(b, 'unknown'), { model: 'm', text: { format: {} } });
  assert.equal(adjustResponsesBody({ model: 'm' }, 'x'), null);
});

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (c: Call, n: number) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} }; calls.push(c);
    return handler(c, calls.length);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

test('ChatGptProvider.complete: /v1/responses에 store:false·stream:true·instructions로 보내고 SSE를 모은다', async () => {
  const { fetch, calls } = fakeFetch(() => new Response(SSE_OK, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  const p = new ChatGptProvider('gpt-5.1', fetch, async () => 'tok');
  const out = await p.complete('시스템', '질문', { effort: 'high', maxTokens: 300 });
  assert.equal(out, '안녕하세요');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.equal(body.model, 'gpt-5.1');
  assert.match(body.instructions, /^시스템/);
  assert.deepEqual(body.input, [{ role: 'user', content: '질문' }]);
  assert.deepEqual(body.reasoning, { effort: 'high' });
  assert.equal('max_output_tokens' in body, false);
  assert.equal('temperature' in body, false);
  assert.equal(p.label, 'gpt-5.1 · ChatGPT 플랜');
});

test('ChatGptProvider: 401이면 토큰을 한 번 강제 재발급해 다시 보낸다', async () => {
  const { fetch, calls } = fakeFetch((_c, n) => n === 1 ? new Response('expired', { status: 401 }) : new Response(SSE_OK, { status: 200 }));
  const forced: boolean[] = [];
  const p = new ChatGptProvider('m', fetch, async (force) => { forced.push(!!force); return force ? 'new' : 'old'; });
  assert.equal(await p.complete('s', 'u'), '안녕하세요');
  assert.deepEqual(forced, [false, true]);
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer new');
});

test('ChatGptProvider: 400에 reasoning 거부 문구면 빼고 재시도, 429는 AI_RATE', async () => {
  const { fetch, calls } = fakeFetch((c, n) => {
    const body = JSON.parse(String(c.init.body));
    if (n === 1 && body.reasoning) return new Response('{"error":{"message":"Unsupported parameter: reasoning"}}', { status: 400 });
    return new Response(SSE_OK, { status: 200 });
  });
  const p = new ChatGptProvider('m', fetch, async () => 't');
  assert.equal(await p.complete('s', 'u', { effort: 'low' }), '안녕하세요');
  assert.equal(calls.length, 2);
  assert.equal('reasoning' in JSON.parse(String(calls[1].init.body)), false);

  const limited = new ChatGptProvider('m', fakeFetch(() => new Response('', { status: 429 })).fetch, async () => 't');
  await assert.rejects(limited.complete('s', 'u'), (e: { code: string }) => e.code === 'AI_RATE');
});

test('ChatGptProvider.completeJson: text.format json_schema를 붙이고 결과 JSON을 뽑는다', async () => {
  const sse = 'data: {"type":"response.output_text.delta","delta":"```json\\n{\\"a\\":1}\\n```"}\n\ndata: {"type":"response.completed","response":{}}\n\n';
  const { fetch, calls } = fakeFetch(() => new Response(sse, { status: 200 }));
  const p = new ChatGptProvider('m', fetch, async () => 't');
  const r = await p.completeJson<{ a: number }>('s', 'u', { type: 'object', properties: { a: { type: 'number' } } });
  assert.deepEqual(r, { a: 1 });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
});
