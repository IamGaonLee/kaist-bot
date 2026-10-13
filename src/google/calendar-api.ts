// Google Calendar REST (필요한 것만). 범위상 이 앱이 만든 캘린더만 다룰 수 있다.
import { KaistError } from '../errors.js';
import { accessToken } from './oauth.js';

const API = 'https://www.googleapis.com/calendar/v3';

export interface GEvent {
  id?: string;
  summary: string;
  description?: string;
  /** 시각 일정은 dateTime, 종일 일정은 date(YYYY-MM-DD) */
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  colorId?: string;
  reminders?: { useDefault: boolean; overrides?: { method: 'popup' | 'email'; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
  htmlLink?: string;
  status?: string;
}

async function call<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const r = await fetch(API + pathAndQuery, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({})) as any;
  if (!r.ok) {
    const msg = j?.error?.message ?? r.statusText;
    if (r.status === 404) throw new KaistError('GCAL_NOT_FOUND', `구글 캘린더: 찾을 수 없음 (${msg})`);
    if (r.status === 403) throw new KaistError('GCAL_FORBIDDEN', `구글 캘린더: 권한 없음 (${msg}). 이 CLI는 자신이 만든 캘린더만 다룰 수 있습니다.`);
    throw new KaistError('GCAL_ERROR', `구글 캘린더 HTTP ${r.status}: ${msg}`);
  }
  return j as T;
}

export const gcal = {
  createCalendar: (summary: string, description: string) =>
    call<{ id: string }>('POST', '/calendars', { summary, description, timeZone: 'Asia/Seoul' }),
  getCalendar: (id: string) => call<{ id: string; summary: string }>('GET', `/calendars/${encodeURIComponent(id)}`),
  listEvents: async (calId: string, params: Record<string, string>): Promise<GEvent[]> => {
    const out: GEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ singleEvents: 'true', maxResults: '250', ...params, ...(pageToken ? { pageToken } : {}) });
      const r = await call<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calId)}/events?${q}`);
      out.push(...(r.items ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  },
  insertEvent: (calId: string, ev: GEvent) => call<GEvent>('POST', `/calendars/${encodeURIComponent(calId)}/events`, ev),
  patchEvent: (calId: string, id: string, ev: Partial<GEvent>) => call<GEvent>('PATCH', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, ev),
  getEvent: (calId: string, id: string) => call<GEvent>('GET', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`),
  deleteEvent: (calId: string, id: string) => call<void>('DELETE', `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`),
};
