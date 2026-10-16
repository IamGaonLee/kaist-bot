// "Continue with ChatGPT" — OpenAI Sign in with ChatGPT(SIWC) 오픈소스·로컬 앱용 플랜 사용 흐름.
// 공식 문서(2026-10-16 확인): https://developers.openai.com/siwc/token-sharing-open-source/sign-in
//  - PKCE S256 + state + nonce, 콜백은 반드시 http://127.0.0.1:<port>/auth/callback (localhost 금지, 경로 고정, 포트만 가변)
//  - 첫 로그인은 client_id=dynamic_agent_client + agent_name_hint + ext_agent_host_id 로 동적 등록 → 콜백 query의 client_id(oaiapp_…)를 저장
//  - 범위: openid profile email offline_access resource.invoke chatgpt.tokens.use.direct, resource=https://api.openai.com/v1
//  - 토큰 교환/재발급은 form-urlencoded, client secret 없음(공개 클라이언트), refresh token은 회전형
//  - 모델 호출은 api.openai.com/v1/responses 만(backend-api 금지), store:false·stream:true 필수 → src/ai/chatgpt.ts
// API 키 방식(src/ai/openai.ts)과 별개. 토큰은 %LOCALAPPDATA%\kaist-cli\chatgpt-token.json 에만 둔다(저장소·드라이브 밖).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';
import { KaistError } from '../errors.js';

export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const CALLBACK_PATH = '/auth/callback';
export const AGENT_NAME = 'KAISTBOT';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';

const clientFile = () => path.join(paths.home, 'chatgpt-client.json');
const tokenFile = () => path.join(paths.home, 'chatgpt-token.json');

/** 동적 등록으로 받은 client_id와 이 PC의 host id. 로그아웃해도 유지(같은 계정 재로그인에 재사용) */
interface ClientRecord { client_id?: string; host_id: string }
export interface ChatGptModel { slug: string; name: string }
export interface TokenRecord {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_at: number;
  scopes: string[];
  email?: string;
  models?: ChatGptModel[];
  models_at?: number;
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T; } catch { return null; }
}
function writeJson(file: string, v: unknown): void { ensureDir(paths.home); fs.writeFileSync(file, JSON.stringify(v, null, 2)); }

/** host id는 문서 예시대로 URN 형식(urn:uuid:…). 맨 UUID는 authorize에서 invalid_authorize_request(param ext_agent_host_id)로 거부됐다(2026-10-16 실측) */
export const toHostId = (v: string): string => (/^urn:uuid:/i.test(v) ? v : `urn:uuid:${v}`);

function loadClient(): ClientRecord {
  const c = readJson<ClientRecord>(clientFile());
  if (c?.host_id) {
    const fixed = toHostId(c.host_id);
    if (fixed !== c.host_id) { c.host_id = fixed; writeJson(clientFile(), c); }
    return c;
  }
  const fresh = { host_id: toHostId(crypto.randomUUID()) };
  writeJson(clientFile(), fresh);
  return fresh;
}

export const loadChatGptToken = (): TokenRecord | null => readJson<TokenRecord>(tokenFile());
export const hasChatGptToken = (): boolean => !!loadChatGptToken();

// ---- 순수 함수(테스트 대상) ----

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** 인증 URL. 첫 등록이면 dynamic_agent_client, 아니면 저장된 client_id(+id_token_hint) */
export function buildAuthorizeUrl(p: { clientId?: string; hostId: string; redirectUri: string; state: string; nonce: string; challenge: string; idTokenHint?: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId ?? 'dynamic_agent_client',
    ext_agent_host_id: p.hostId,
    response_type: 'code',
    redirect_uri: p.redirectUri,
    scope: SCOPES.join(' '),
    resource: RESOURCE,
    state: p.state,
    nonce: p.nonce,
    code_challenge_method: 'S256',
    code_challenge: p.challenge,
  });
  if (!p.clientId) q.set('agent_name_hint', AGENT_NAME);
  else {
    if (p.idTokenHint) q.set('id_token_hint', p.idTokenHint);
    if (p.loginHint) q.set('login_hint', p.loginHint);
  }
  return `${AUTHORIZE_URL}?${q}`;
}

/** 콜백 query 검사. 반환: code와 (있으면) 발급된 client_id·scope */
export function parseCallback(query: URLSearchParams, expected: { state: string; clientId?: string }): { code: string; clientId?: string; scope?: string } {
  if (query.get('state') !== expected.state) throw new KaistError('CHATGPT_STATE', 'OAuth state가 맞지 않습니다. 다시 시도해 주세요.');
  const err = query.get('error');
  if (err) throw new KaistError('CHATGPT_DENIED', err === 'access_denied' ? 'ChatGPT 로그인을 취소했습니다.' : `ChatGPT 로그인 실패: ${err} ${query.get('error_description') ?? ''}`.trim());
  const code = query.get('code');
  if (!code) throw new KaistError('CHATGPT_NO_CODE', '콜백에 인증 코드가 없습니다.');
  const issued = query.get('client_id') ?? undefined;
  if (!expected.clientId && !issued) throw new KaistError('CHATGPT_NO_CLIENT', '클라이언트 등록이 완료되지 않았습니다(콜백에 client_id 없음). 다시 시도해 주세요.');
  if (expected.clientId && issued && issued !== expected.clientId) throw new KaistError('CHATGPT_CLIENT_MISMATCH', '발급된 client_id가 저장된 것과 다릅니다. 로그아웃 후 다시 로그인해 주세요.');
  return { code, clientId: issued ?? expected.clientId, scope: query.get('scope') ?? undefined };
}

/** ID 토큰 payload(서명 검증은 하지 않음 — 표시용 email과 nonce 대조에만 쓴다) */
export function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> | null {
  if (!jwt) return null;
  const part = jwt.split('.')[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
}

/** 모델 목록 응답에서 쓸 수 있는 모델만(visibility=="list"), 서버 순서 유지 */
export function pickModels(j: unknown): ChatGptModel[] {
  const o = (j ?? {}) as { models?: unknown[]; data?: unknown[] };
  const arr = (o.models ?? o.data ?? []) as Record<string, unknown>[];
  return arr
    .filter(m => m && (m.visibility === undefined || m.visibility === 'list'))
    .map(m => ({ slug: String(m.slug ?? m.id ?? ''), name: String(m.display_name ?? m.slug ?? m.id ?? '') }))
    .filter(m => m.slug);
}

// ---- 네트워크 ----

type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; scopes?: string[] | string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  const r = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const text = await r.text();
  let j: TokenResponse = {} as TokenResponse;
  try { j = JSON.parse(text) as TokenResponse; } catch { /* 아래에서 상태 코드로 처리 */ }
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new KaistError('CHATGPT_REAUTH', 'ChatGPT 로그인이 만료됐거나 취소됐습니다. 다시 로그인해 주세요.');
    throw new KaistError('CHATGPT_TOKEN', `ChatGPT 토큰 요청 실패 (HTTP ${r.status}): ${j.error ?? ''} ${j.error_description ?? text.slice(0, 120)}`.trim());
  }
  if (!j.access_token) throw new KaistError('CHATGPT_TOKEN', 'ChatGPT 토큰 응답에 access_token이 없습니다.');
  return j;
}

function grantedScopes(t: TokenResponse, fallback?: string): string[] {
  if (Array.isArray(t.scopes)) return t.scopes;
  const s = typeof t.scopes === 'string' ? t.scopes : (t.scope ?? fallback ?? '');
  return s.split(' ').filter(Boolean);
}

function openBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', `"${url}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

/** 사용할 수 있는 모델 목록(플랜 토큰으로 /v1/models). 실패하면 빈 배열 */
export async function fetchChatGptModels(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<ChatGptModel[]> {
  const r = await fetchImpl(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return [];
  return pickModels(await r.json().catch(() => null));
}

export interface LoginOptions { openUrl?: (url: string) => void; fetchImpl?: typeof fetch; timeoutMs?: number }

/** 브라우저로 ChatGPT 로그인(동의)을 받고 토큰을 저장한다. 비밀번호는 브라우저(OpenAI)에서만 입력된다 */
export async function chatGptLogin(onStatus: (m: string) => void, opts: LoginOptions = {}): Promise<{ email?: string; models: ChatGptModel[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const client = loadClient();
  const prev = loadChatGptToken();
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  const server = http.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const url = buildAuthorizeUrl({ clientId: client.client_id, hostId: client.host_id, redirectUri, state, nonce, challenge, idTokenHint: prev?.id_token, loginHint: prev?.email });

  const cb = await new Promise<ReturnType<typeof parseCallback>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KaistError('CHATGPT_TIMEOUT', 'ChatGPT 로그인 대기 시간(5분)이 지났습니다.')), opts.timeoutMs ?? 5 * 60_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirectUri);
      if (u.pathname !== CALLBACK_PATH) { res.writeHead(404).end(); return; }
      let parsed: ReturnType<typeof parseCallback> | null = null; let fail: unknown = null;
      try { parsed = parseCallback(u.searchParams, { state, clientId: client.client_id }); } catch (e) { fail = e; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fail ? `<p>${(fail as Error).message} 이 창을 닫아도 됩니다.</p>` : '<p>KAISTBOT: ChatGPT 로그인 완료. 이 창을 닫아도 됩니다.</p>');
      clearTimeout(timer);
      if (fail) reject(fail); else resolve(parsed!);
    });
    onStatus('브라우저에서 ChatGPT 계정으로 계속하세요. 창이 안 열리면 아래 주소를 직접 여세요.');
    onStatus(url);
    (opts.openUrl ?? openBrowser)(url);
  }).finally(() => server.close());

  const t = await tokenRequest({ grant_type: 'authorization_code', client_id: cb.clientId!, code: cb.code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }, fetchImpl);
  const scopes = grantedScopes(t, cb.scope);
  if (!scopes.includes(PLAN_SCOPE)) throw new KaistError('CHATGPT_SCOPE', 'ChatGPT 플랜 사용 권한이 승인되지 않았습니다. 동의 화면에서 플랜 사용을 허용해 주세요.');
  if (!t.refresh_token) throw new KaistError('CHATGPT_NO_REFRESH', 'ChatGPT가 refresh token을 주지 않았습니다. 다시 시도해 주세요.');
  const payload = decodeJwtPayload(t.id_token);
  if (payload && payload.nonce !== undefined && payload.nonce !== nonce) throw new KaistError('CHATGPT_NONCE', 'ID 토큰의 nonce가 맞지 않습니다.');
  const email = typeof payload?.email === 'string' ? payload.email : undefined;

  if (cb.clientId !== client.client_id) writeJson(clientFile(), { ...client, client_id: cb.clientId });
  const rec: TokenRecord = { access_token: t.access_token, refresh_token: t.refresh_token, id_token: t.id_token, expires_at: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000, scopes, email };
  const models = await fetchChatGptModels(t.access_token, fetchImpl);
  if (models.length) { rec.models = models; rec.models_at = Date.now(); }
  writeJson(tokenFile(), rec);
  return { email, models };
}

/** 유효한 access token(만료면 재발급, 회전된 refresh token 저장). 없으면 CHATGPT_NO_TOKEN */
export async function chatGptAccessToken(fetchImpl: typeof fetch = fetch, force = false): Promise<string> {
  const tok = loadChatGptToken();
  if (!tok) throw new KaistError('CHATGPT_NO_TOKEN', 'ChatGPT 계정이 연결되지 않았습니다. 설정에서 "Continue with ChatGPT"로 로그인해 주세요.');
  if (!force && Date.now() < tok.expires_at) return tok.access_token;
  const client = loadClient();
  let t: TokenResponse;
  try {
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id ?? '', resource: RESOURCE }, fetchImpl);
  } catch (e) {
    if ((e as KaistError).code === 'CHATGPT_REAUTH') { try { fs.unlinkSync(tokenFile()); } catch { /* 없음 */ } }
    throw e;
  }
  const next: TokenRecord = {
    ...tok,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? tok.refresh_token,
    id_token: t.id_token ?? tok.id_token,
    expires_at: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000,
    scopes: grantedScopes(t, tok.scopes.join(' ')),
  };
  writeJson(tokenFile(), next);
  return next.access_token;
}

/** 로그아웃: 로컬 토큰 삭제(client_id·host_id는 유지). 문서에 폐기 엔드포인트가 없어 서버 폐기는 하지 않는다 */
export function chatGptLogout(): boolean {
  if (!fs.existsSync(tokenFile())) return false;
  fs.unlinkSync(tokenFile());
  return true;
}

/** 표시용 상태(비밀값 제외) */
export function chatGptState(): { loggedIn: boolean; email?: string; models: ChatGptModel[]; expiresAt?: number } {
  const t = loadChatGptToken();
  if (!t) return { loggedIn: false, models: [] };
  return { loggedIn: true, email: t.email, models: t.models ?? [], expiresAt: t.expires_at };
}

/** 모델 목록 새로고침(토큰 파일에 캐시) */
export async function refreshChatGptModels(fetchImpl: typeof fetch = fetch): Promise<ChatGptModel[]> {
  const token = await chatGptAccessToken(fetchImpl);
  const models = await fetchChatGptModels(token, fetchImpl);
  const t = loadChatGptToken();
  if (t && models.length) writeJson(tokenFile(), { ...t, models, models_at: Date.now() });
  return models;
}
