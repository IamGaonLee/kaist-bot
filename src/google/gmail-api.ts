// Gmail REST (읽기 전용, gmail.readonly). Dooray에서 전달된 학교 메일을 가져오는 데만 쓴다.
import { KaistError } from '../errors.js';
import { accessToken, hasGmailScope } from './oauth.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function call<T>(pathAndQuery: string): Promise<T> {
  if (!hasGmailScope()) throw new KaistError('GOOGLE_REAUTH', 'Gmail 읽기 권한이 없습니다. `kaist google login`으로 다시 승인해 주세요 (캘린더와 Gmail을 함께 묻습니다).');
  const token = await accessToken();
  const r = await fetch(API + pathAndQuery, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({})) as any;
  if (!r.ok) {
    const msg = j?.error?.message ?? r.statusText;
    if (r.status === 403 && /has not been used|disabled/i.test(msg)) throw new KaistError('GMAIL_API_DISABLED', 'Google Cloud 콘솔에서 Gmail API가 꺼져 있습니다. 프로젝트에서 Gmail API를 "사용"으로 바꿔 주세요.');
    if (r.status === 401 || r.status === 403) throw new KaistError('GOOGLE_REAUTH', `Gmail 접근이 거부됐습니다 (${msg}). \`kaist google login\`을 다시 실행해 주세요.`);
    throw new KaistError('GMAIL_ERROR', `Gmail HTTP ${r.status}: ${msg}`);
  }
  return j as T;
}

export interface GmailPart { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] }
export interface GmailMessage { id: string; threadId: string; internalDate: string; snippet?: string; labelIds?: string[]; payload?: GmailPart }

/** 검색어에 맞는 메시지 id 전부 (페이지 넘김) */
export async function listMessageIds(q: string, max = 2000): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ q, maxResults: '500', ...(pageToken ? { pageToken } : {}) });
    const r = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${p}`);
    for (const m of r.messages ?? []) ids.push(m.id);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

export const getMessage = (id: string) => call<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function header(m: GmailMessage, name: string): string | null {
  return m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** MIME 트리에서 본문 텍스트 (text/plain 우선, 없으면 text/html을 텍스트로) */
export function bodyText(m: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename) return; // 첨부는 본문이 아니다
    if (p.body?.data) {
      const text = b64(p.body.data).toString('utf8');
      if (p.mimeType === 'text/plain') plain.push(text);
      else if (p.mimeType === 'text/html') html.push(text);
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(m.payload);
  if (plain.length) return plain.join('\n').trim();
  return html.join('\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function attachmentNames(m: GmailMessage): { filename: string; size: number }[] {
  const out: { filename: string; size: number }[] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename) out.push({ filename: p.filename, size: p.body?.size ?? 0 });
    for (const c of p.parts ?? []) walk(c);
  };
  walk(m.payload);
  return out;
}
