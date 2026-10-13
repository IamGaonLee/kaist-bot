// 세션 쿠키 파일 (%LOCALAPPDATA%\kaist-cli\session.json). 세션의 유일한 저장소.
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';

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

export class SessionStore {
  constructor(private readonly file = paths.session) {}

  load(): SessionFile | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const text = fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''); // 편집기가 붙인 BOM 허용
      const data = JSON.parse(text) as SessionFile;
      return Array.isArray(data.cookies) ? data : null;
    } catch {
      return null; // 깨진 파일은 세션 없음으로 본다
    }
  }

  save(session: SessionFile): void {
    ensureDir(path.dirname(this.file));
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
    fs.renameSync(tmp, this.file);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
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
