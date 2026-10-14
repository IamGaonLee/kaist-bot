// 세션 쿠키 파일 (%LOCALAPPDATA%\kaist-cli\session.json). 세션의 유일한 저장소.
// v2: 사이트별 쿠키 {version:2, sites:{klms|portal|erp|kds}}. v1(KLMS 쿠키만)은 읽을 때 klms로 옮긴다.
// SSO(sso.kaist.ac.kr) 쿠키는 저장하지 않는다 (사용자 개입 없이 세션을 새로 만드는 일을 막는다).
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';

export const SITES = ['klms', 'portal', 'erp', 'kds'] as const;
export type SiteId = (typeof SITES)[number];

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** 유닉스 초, -1이면 세션 쿠키 */
  expires: number;
}

export interface SessionFile {
  savedAt: string;
  lastUsedAt: string;
  cookies: StoredCookie[];
}

interface FileV2 {
  version: 2;
  sites: Partial<Record<SiteId, SessionFile>>;
}

const isSession = (x: unknown): x is SessionFile => !!x && Array.isArray((x as SessionFile).cookies);

/** 파일 내용 → v2. v1은 klms로 옮기고, 깨진 항목은 버린다 */
export function parseSessionFile(text: string): FileV2 {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return { version: 2, sites: {} }; } // 편집기가 붙인 BOM 허용
  if (data && (data as FileV2).version === 2 && typeof (data as FileV2).sites === 'object') {
    const sites: FileV2['sites'] = {};
    for (const s of SITES) { const v = (data as FileV2).sites[s]; if (isSession(v)) sites[s] = v; }
    return { version: 2, sites };
  }
  return { version: 2, sites: isSession(data) ? { klms: data } : {} };
}

/** 한 사이트의 세션을 읽고 쓴다. 같은 파일을 여러 사이트가 나눠 쓴다 */
export class SessionStore {
  constructor(private readonly file = paths.session, readonly site: SiteId = 'klms') {}

  forSite(site: SiteId): SessionStore {
    return new SessionStore(this.file, site);
  }

  private read(): FileV2 {
    if (!fs.existsSync(this.file)) return { version: 2, sites: {} };
    return parseSessionFile(fs.readFileSync(this.file, 'utf8'));
  }

  private write(data: FileV2): void {
    ensureDir(path.dirname(this.file));
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  load(): SessionFile | null {
    return this.read().sites[this.site] ?? null;
  }

  save(session: SessionFile): void {
    const data = this.read();
    data.sites[this.site] = session;
    this.write(data);
  }

  clear(): void {
    const data = this.read();
    delete data.sites[this.site];
    this.write(data);
  }
}

/** 요청에 붙일 Cookie 헤더 (경로/만료 확인 포함) */
export function cookieHeaderFor(cookies: StoredCookie[], url: URL, now = Date.now() / 1000): string {
  return cookies
    .filter(c => {
      const d = c.domain.replace(/^\./, '');
      const domainOk = url.hostname === d || url.hostname.endsWith('.' + d);
      const pathOk = url.pathname.startsWith(c.path || '/');
      const alive = c.expires === -1 || c.expires > now;
      return domainOk && pathOk && alive;
    })
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

/** 응답의 Set-Cookie를 저장된 쿠키에 반영. 바뀐 게 있으면 true */
export function applySetCookies(cookies: StoredCookie[], setCookies: string[], host: string): boolean {
  let changed = false;
  for (const line of setCookies) {
    const [pair, ...attrs] = line.split(';').map(s => s.trim());
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    let domain = host;
    let cpath = '/';
    let expires = -1;
    for (const a of attrs) {
      const [k = '', v = ''] = a.split('=');
      const key = k.toLowerCase();
      if (key === 'domain' && v) domain = v.replace(/^\./, '');
      else if (key === 'path' && v) cpath = v;
      else if (key === 'max-age') expires = Number(v) <= 0 ? 0 : Math.floor(Date.now() / 1000) + Number(v);
      else if (key === 'expires' && expires === -1) { const t = Date.parse(v); if (!Number.isNaN(t)) expires = Math.floor(t / 1000); }
    }
    const i = cookies.findIndex(c => c.name === name && c.domain.replace(/^\./, '') === domain && c.path === cpath);
    const deleted = value === '' || value === 'deleted' || expires === 0;
    if (deleted) {
      if (i >= 0) { cookies.splice(i, 1); changed = true; }
    } else if (i >= 0) {
      if (cookies[i]!.value !== value) { cookies[i] = { name, value, domain, path: cpath, expires }; changed = true; }
    } else {
      cookies.push({ name, value, domain, path: cpath, expires });
      changed = true;
    }
  }
  return changed;
}
