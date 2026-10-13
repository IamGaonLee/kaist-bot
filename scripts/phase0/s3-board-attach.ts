// S3 사전 확인: 가장 작은 게시판 첨부 1개를 쿠키로 실제 다운로드 (저장소 밖 samples에 저장)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureSession } from '../../src/klms/session.ts';

const home = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');
const db = new DatabaseSync(path.join(home, 'kaist.db'));
const row = db.prepare(`select key, url, length from files where source = 'notice' and length is not null order by length limit 1`).get() as { key: string; url: string; length: number };
const s = await ensureSession({ interactive: false });
const r = await s.http.request(row.url, 'file');
const buf = Buffer.from(await r.arrayBuffer());
fs.writeFileSync(path.join(home, 'samples', 'board-attachment-test' + path.extname(new URL(row.url).pathname)), buf);
console.log('status', r.status, 'type', r.headers.get('content-type'), 'HEAD length', row.length, 'got', buf.length, 'disposition', (r.headers.get('content-disposition') ?? '').slice(0, 30));
s.http.persist();
