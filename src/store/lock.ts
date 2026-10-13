// sync 동시 실행 방지 (%LOCALAPPDATA%\kaist-cli\sync.lock, pid 기록)
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';
import { KaistError } from '../errors.js';

const lockFile = path.join(paths.home, 'sync.lock');

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

export function acquireSyncLock(): () => void {
  ensureDir(paths.home);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' });
      return () => { try { fs.rmSync(lockFile, { force: true }); } catch { /* 이미 없음 */ } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder: { pid?: number; at?: string } = {};
      try { holder = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { /* 깨진 잠금 */ }
      if (holder.pid && alive(holder.pid)) {
        throw new KaistError('SYNC_RUNNING', `다른 kaist sync가 실행 중입니다 (pid ${holder.pid}, ${holder.at ?? ''} 시작). 끝난 뒤 다시 실행해 주세요.`);
      }
      fs.rmSync(lockFile, { force: true }); // 죽은 프로세스의 잠금은 치운다
    }
  }
  throw new KaistError('SYNC_LOCK', '실행 잠금을 얻지 못했습니다.');
}
