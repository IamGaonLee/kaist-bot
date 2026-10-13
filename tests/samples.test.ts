// 실제 KLMS HTML 샘플로 파서 검사. 샘플은 개인정보가 있어 저장소 밖(%LOCALAPPDATA%\kaist-cli\samples)에 있고,
// 없으면 건너뛴다. 출력에 이름·본문을 찍지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseCoursePage } from '../src/klms/adapters/course-page.js';
import { parseAssignPage } from '../src/klms/adapters/assign-page.js';
import { parseArticle, parseBoardList } from '../src/klms/adapters/courseboard.js';

const dir = path.join(process.env.LOCALAPPDATA ?? '', 'kaist-cli', 'samples');
const sample = (f: string) => { const p = path.join(dir, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const maybe = (f: string, fn: (html: string) => void) => {
  const html = sample(f);
  test(`샘플 ${f}`, { skip: html ? false : '샘플 없음' }, () => fn(html!));
};

maybe('html-course-186294.html', html => {
  const p = parseCoursePage(html);
  assert.equal(p.sections.length, 17);
  assert.equal(p.resourceWithoutLink, 0);
  assert.ok(p.modules.filter(m => m.modname === 'resource').every(m => m.file?.url.includes('/pluginfile.php/')));
  assert.ok(p.modules.some(m => m.modname === 'lti'));
  assert.ok(p.modules.filter(m => m.modname === 'courseboard').every(m => m.boardKind));
  assert.equal(p.theme, 'oklass39');
  assert.ok(p.userId);
});

maybe('html-course-189782.html', html => {
  const p = parseCoursePage(html);
  const assigns = p.modules.filter(m => m.modname === 'assign');
  assert.equal(assigns.length, 6);
  assert.ok(assigns.every(a => a.endDt?.end));
  // HW1: 2026-09-15 00:00 KST
  assert.equal(assigns.find(a => a.cmid === 1283626)?.endDt?.end, Date.UTC(2026, 8, 14, 15, 0) / 1000);
});

maybe('html-assign-1283626.html', html => {
  const p = parseAssignPage(html);
  assert.equal(p.title, 'HW1');
  assert.equal(p.due, Date.UTC(2026, 8, 14, 15, 0) / 1000);
  assert.equal(p.submissionCode, 'submitted');
  assert.equal(p.gradingCode, 'notgraded');
  assert.equal(p.attachments.length, 1);
  assert.ok(p.attachments.every(a => a.url.includes('/mod_assign/introattachment/')));
});

maybe('html-courseboard.html', html => {
  const p = parseBoardList(html);
  assert.ok(p.posts.length > 0);
  assert.ok(p.posts.every(x => x.bwid > 0 && x.title && x.listDate));
  assert.ok(p.maxPage >= 2);
});

maybe('html-courseboard-post.html', html => {
  const p = parseArticle(html);
  assert.ok(p.title);
  assert.ok(p.postedAt);
  assert.ok(p.bodyHtml.length > 0);
});
