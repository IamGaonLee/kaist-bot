// 구글 OAuth (데스크톱 앱, loopback + PKCE). 토큰은 %LOCALAPPDATA%\kaist-cli\google-token.json에만.
// 범위는 calendar.app.created: 이 앱이 만든 캘린더만 접근 가능 (사용자 결정).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { paths } from '../config.js';
import { KaistError } from '../errors.js';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
/** 학교 메일(Dooray→Gmail 전달) 읽기 전용 (S7, 사용자 결정: 캘린더와 한 토큰) */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const clientFile = path.join(paths.home, 'google-client.json');
const tokenFile = path.join(paths.home, 'google-token.json');

interface Client { client_id: string; client_secret: string }
interface Token { access_token: string; refresh_token: string; expires_at: number; scope: string }

/** 앱 빌드에 포함된 공유 OAuth 클라이언트(설치 파일 안). app/main.ts가 등록한다. CLI(개발 PC)는 사용자 파일만 쓴다. */
let bundledClientFile: string | null = null;
export function setBundledGoogleClientFile(file: string): void { bundledClientFile = file; }

/** 데스크톱 앱 클라이언트 JSON(installed 또는 web) 해석 */
export function parseGoogleClient(text: string): Client {
  let j: { installed?: Client; web?: Client };
  try { j = JSON.parse(text.replace(/^﻿/, '')) as typeof j; }
  catch { throw new KaistError('GOOGLE_BAD_CLIENT', 'OAuth 클라이언트 파일이 JSON이 아닙니다 (데스크톱 앱 JSON이어야 함).'); }
  const c = j.installed ?? j.web;
  if (!c?.client_id || !c.client_secret) throw new KaistError('GOOGLE_BAD_CLIENT', 'OAuth 클라이언트 파일 형식이 맞지 않습니다 (데스크톱 앱 JSON이어야 함).');
  return { client_id: c.client_id, client_secret: c.client_secret };
}

export type GoogleClientSource = 'user' | 'env' | 'bundled';

/** 쓸 클라이언트 파일. 우선순위: 사용자 자기 클라이언트(%LOCALAPPDATA%\kaist-cli\google-client.json) → KAIST_GOOGLE_CLIENT 환경변수 경로 → 빌드에 포함된 공유 클라이언트 */
export function googleClientFile(): { file: string; source: GoogleClientSource } | null {
  if (fs.existsSync(clientFile)) return { file: clientFile, source: 'user' };
  const env = process.env.KAIST_GOOGLE_CLIENT;
  if (env && fs.existsSync(env)) return { file: env, source: 'env' };
  if (bundledClientFile && fs.existsSync(bundledClientFile)) return { file: bundledClientFile, source: 'bundled' };
  return null;
}
export const hasGoogleClient = (): boolean => googleClientFile() !== null;

function loadClient(): Client {
  const found = googleClientFile();
  if (!found) {
    // 앱(번들 경로가 등록됨)인데 파일이 없으면 빌드에 클라이언트가 안 들어간 것. v1.0.0~1.2.0 설치 파일이 그랬다.
    throw new KaistError('GOOGLE_NO_CLIENT', bundledClientFile
      ? `이 설치 파일에는 구글 연결 정보(OAuth 클라이언트)가 들어 있지 않습니다. 최신 설치 파일로 다시 설치하거나, 구글 클라우드에서 데스크톱 앱 클라이언트 JSON을 받아 ${clientFile}에 저장해 주세요.`
      : `OAuth 클라이언트 파일이 없습니다: ${clientFile}. 구글 클라우드에서 데스크톱 앱 클라이언트 JSON을 받아 이 위치에 저장해 주세요.`);
  }
  return parseGoogleClient(fs.readFileSync(found.file, 'utf8'));
}

const loadToken = (): Token | null => (fs.existsSync(tokenFile) ? JSON.parse(fs.readFileSync(tokenFile, 'utf8')) as Token : null);
const saveToken = (t: Token) => fs.writeFileSync(tokenFile, JSON.stringify(t, null, 2));

export const hasGoogleToken = () => fs.existsSync(tokenFile);

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }> {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json() as Record<string, any>;
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new KaistError('GOOGLE_REAUTH', '구글 승인이 만료됐거나 취소됐습니다. `kaist cal login`을 다시 실행해 주세요.');
    throw new KaistError('GOOGLE_TOKEN', `구글 토큰 요청 실패: ${j.error} ${j.error_description ?? ''}`);
  }
  return j as any;
}

/** 브라우저로 동의 화면을 열고 loopback으로 코드를 받는다 */
export async function googleLogin(onStatus: (m: string) => void, opts: { gmail?: boolean } = {}): Promise<void> {
  const scopes = opts.gmail ? [SCOPE, GMAIL_SCOPE] : [SCOPE];
  const client = loadClient();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const server = http.createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const redirect = `http://127.0.0.1:${port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), include_granted_scopes: 'true',
    code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KaistError('GOOGLE_TIMEOUT', '구글 승인 대기 시간(5분)이 지났습니다.')), 5 * 60_000);
    server.on('request', (req, res) => {
      const q = new URL(req.url ?? '/', redirect).searchParams;
      if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(q.get('error') ? '<p>승인이 취소됐습니다. 이 창을 닫아도 됩니다.</p>' : '<p>kaist-cli 승인 완료. 이 창을 닫아도 됩니다.</p>');
      clearTimeout(timer);
      if (q.get('state') !== state) reject(new KaistError('GOOGLE_STATE', 'OAuth state가 맞지 않습니다.'));
      else if (q.get('error')) reject(new KaistError('GOOGLE_DENIED', `구글 승인이 거부됐습니다: ${q.get('error')}`));
      else resolve(q.get('code')!);
    });
    onStatus('브라우저에서 구글 계정으로 승인해 주세요. 창이 안 열리면 아래 주소를 직접 여세요.');
    onStatus(url);
    spawn('cmd', ['/c', 'start', '""', `"${url}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
  }).finally(() => server.close());

  const t = await tokenRequest({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
  if (!t.refresh_token) throw new KaistError('GOOGLE_NO_REFRESH', '구글이 refresh token을 주지 않았습니다. 구글 계정의 앱 권한에서 kaist-cli를 삭제한 뒤 다시 시도해 주세요.');
  const granted = t.scope.split(' ');
  const missing = scopes.filter(x => !granted.includes(x));
  if (missing.length) throw new KaistError('GOOGLE_SCOPE', `요청한 권한이 일부 승인되지 않았습니다: ${missing.map(x => x.split('/').pop()).join(', ')}. 동의 화면에서 모든 항목을 체크해 주세요.`);
  saveToken({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope });
}

/** 유효한 access token (필요하면 갱신) */
export async function accessToken(): Promise<string> {
  const tok = loadToken();
  if (!tok) throw new KaistError('GOOGLE_NO_TOKEN', '구글 캘린더가 연결되지 않았습니다. `kaist cal login`을 먼저 실행해 주세요.');
  if (Date.now() < tok.expires_at) return tok.access_token;
  const client = loadClient();
  const t = await tokenRequest({ refresh_token: tok.refresh_token, client_id: client.client_id, client_secret: client.client_secret, grant_type: 'refresh_token' });
  const next = { ...tok, access_token: t.access_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
  saveToken(next);
  return next.access_token;
}

/** 저장된 토큰에 Gmail 읽기 권한이 있는지 (예전 캘린더 전용 토큰이면 false) */
export function hasGmailScope(): boolean {
  const tok = loadToken();
  return !!tok && tok.scope.split(' ').includes(GMAIL_SCOPE);
}
