// 보관된 게시판 목록 원문 전부를 파서로 검사 (네트워크 없음, 내용 출력 없음)
import fs from 'node:fs';
import path from 'node:path';
import { parseBoardList } from '../../src/klms/adapters/courseboard.ts';

const dir = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'snapshots');
for (const f of fs.readdirSync(dir).filter(f => f.startsWith('board-'))) {
  try {
    const p = parseBoardList(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    console.log(f, 'ok', `posts=${p.posts.length}`, `pages=${p.maxPage}`);
  } catch (e) {
    console.log(f, 'FAIL', (e as Error).message);
  }
}
