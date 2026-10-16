// 학교 계정 아이디 저장 (선택, 기본 꺼짐 — 결정 2). 비밀번호는 저장하지 않는다.
// 지금은 %LOCALAPPDATA%\kaist-cli\account.json 평문(쿠키·토큰과 같은 저장소 밖 폴더). 앱(Electron)에서는 safeStorage로 바꾼다.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';

const file = () => path.join(paths.home, 'account.json');

export function getSavedId(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^﻿/, '')) as { kaistId?: string };
    return v.kaistId && v.kaistId.trim() ? v.kaistId.trim() : null;
  } catch { return null; }
}

export function saveId(id: string): void {
  if (!id.trim()) return;
  fs.writeFileSync(file(), JSON.stringify({ kaistId: id.trim() }));
}

export function forgetId(): void {
  try { fs.rmSync(file(), { force: true }); } catch { /* 없으면 그만 */ }
}
