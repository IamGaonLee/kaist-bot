// S3 진단: 실패한 파일 하나를 로컬 폴더로 받아 스트림에서 센 바이트와 Content-Length 비교
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureSession } from '../../src/klms/session.ts';

const home = path.join(process.env.LOCALAPPDATA!, 'kaist-cli');
const db = new DatabaseSync(path.join(home, 'kaist.db'));
const row = db.prepare(`select url, length from files where status = 'error' and length between 100000 and 600000 order by length limit 1`).get() as { url: string; length: number };
const s = await ensureSession({ interactive: false });
const r = await s.http.request(row.url, 'file');
let counted = 0;
const chunks: Buffer[] = [];
for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) { counted += c.length; chunks.push(Buffer.from(c)); }
const local = path.join(home, 'samples', 'trunc-test.bin');
fs.writeFileSync(local, Buffer.concat(chunks));
console.log('content-length', r.headers.get('content-length'), 'HEAD length', row.length, 'stream counted', counted, 'local stat', fs.statSync(local).size,
  'encoding', r.headers.get('content-encoding'), 'type', r.headers.get('content-type'));
s.http.persist();
