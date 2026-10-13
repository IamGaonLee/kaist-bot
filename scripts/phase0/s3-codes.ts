// 제출/채점 상태 코드와 문구 조합 확인 (네트워크 없음)
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const d = new DatabaseSync(path.join(process.env.LOCALAPPDATA!, 'kaist-cli', 'kaist.db'));
console.log(d.prepare(`select submission_code, submission_text, grading_code, count(*) n from tasks group by 1, 2, 3`).all());
