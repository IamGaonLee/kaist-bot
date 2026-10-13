// 보관된 과제 페이지 원문 전부를 파서로 검사 (네트워크 없음, 내용 출력 없음)
import fs from 'node:fs';
import path from 'node:path';
import { parseAssignPage } from '../../src/klms/adapters/assign-page.ts';

const dir = path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'snapshots');
for (const f of fs.readdirSync(dir).filter(f => f.startsWith('assign-'))) {
  try {
    const p = parseAssignPage(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    console.log(f, 'ok', `code=${p.submissionCode}`, `due=${p.due !== null}`, `intro=${p.introHtml !== null}`, `att=${p.attachments.length}`);
  } catch (e) {
    console.log(f, 'FAIL', (e as Error).message);
  }
}
