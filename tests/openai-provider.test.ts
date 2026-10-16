// 외부 AI 호환층: 제공자별 400 거부에 맞춰 필드를 고쳐 다시 보내는지 (네트워크 없음, fetch는 가짜)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAiProvider, adjustForError, extractJson } from '../src/ai/openai.js';

function fakeServer(reject: (body: Record<string, unknown>) => string | null, content = '답') {
  const calls: Record<string, unknown>[] = [];
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(body);
    const err = reject(body);
    if (err) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: err } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('OpenAI GPT-5/6: max_tokens 거부 → max_completion_tokens, temperature 거부 → 제거', async () => {
  const { f, calls } = fakeServer(b => {
    if ('max_tokens' in b) return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    if ('temperature' in b) return "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.";
    return null;
  });
  const p = new OpenAiProvider('k', 'https://api.openai.com/v1', 'gpt-6-luna', f);
  assert.equal(await p.complete('s', 'u', { maxTokens: 300, effort: 'high' }), '답');
  assert.equal(calls.length, 3);
  const last = calls[2]!;
  assert.equal(last.max_completion_tokens, 300);
  assert.ok(!('max_tokens' in last) && !('temperature' in last));
  assert.equal(last.reasoning_effort, 'high');
});

test('Anthropic 호환층: temperature<1 거부 → 제거, response_format 무시돼도 JSON을 뽑는다', async () => {
  const { f, calls } = fakeServer(b => ('temperature' in b ? 'temperature: must be 1 for this model' : null), '물론입니다!\n```json\n{"isEvent":true,"kind":"exam"}\n```');
  const p = new OpenAiProvider('k', 'https://api.anthropic.com/v1', 'claude-haiku-5-5', f);
  const r = await p.completeJson<{ isEvent: boolean; kind: string }>('s', 'u', { type: 'object' });
  assert.deepEqual(r, { isEvent: true, kind: 'exam' });
  assert.ok(!('temperature' in calls[calls.length - 1]!));
  assert.match((calls[0]!.messages as { content: string }[])[0]!.content, /JSON 객체만 출력/);
});

test('Gemini 호환층: 그대로 통과(1회)', async () => {
  const { f, calls } = fakeServer(() => null);
  const p = new OpenAiProvider('k', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash-lite', f);
  await p.complete('s', 'u', { effort: 'low' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.reasoning_effort, 'low');
});

test('문구를 못 알아보면 순서대로 빼고, 다 빼도 안 되면 오류', async () => {
  const { f, calls } = fakeServer(() => 'bad request');
  const p = new OpenAiProvider('k', undefined, 'x', f);
  await assert.rejects(p.complete('s', 'u', { effort: 'high' }), /AI 요청/);
  assert.ok(calls.length >= 4);
  assert.equal(adjustForError({ model: 'x' }, 'bad'), null);
});

test('401·404·429는 바로 사용자 문구로', async () => {
  const mk = (status: number) => (async () => ({ ok: false, status, text: async () => '' })) as unknown as typeof fetch;
  await assert.rejects(new OpenAiProvider('k', undefined, 'x', mk(401)).complete('s', 'u'), /API 키/);
  await assert.rejects(new OpenAiProvider('k', undefined, 'x', mk(404)).complete('s', 'u'), /모델/);
  await assert.rejects(new OpenAiProvider('k', undefined, 'x', mk(429)).complete('s', 'u'), /한도/);
});

test('Gemini: 키 오류는 400으로 오지만 키 문구로 안내', async () => {
  const f = (async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}' })) as unknown as typeof fetch;
  await assert.rejects(new OpenAiProvider('bad', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash-lite', f).complete('s', 'u'), /API 키/);
});

test('extractJson: 코드펜스·앞뒤 설명 제거', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('결과:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('없음'), /JSON/);
});
