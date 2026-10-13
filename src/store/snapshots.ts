// 받은 HTML 원문 최근 1회분 보관 (파서 고장 재현용, 저장소 밖)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';

export const snapshotDir = path.join(paths.home, 'snapshots');

export function saveSnapshot(name: string, html: string): void {
  ensureDir(snapshotDir);
  fs.writeFileSync(path.join(snapshotDir, `${name}.html`), html);
}

export function loadSnapshot(name: string): string | null {
  const p = path.join(snapshotDir, `${name}.html`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

export const sha1 = (...parts: (string | number | null | undefined)[]) =>
  crypto.createHash('sha1').update(parts.map(p => p ?? '').join('\u0000')).digest('hex');
