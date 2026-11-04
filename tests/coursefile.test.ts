// coursefile(KLMS 전용 파일 모듈): 과목 페이지 파싱, 리다이렉트 해석, 불변식. 합성 데이터만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoursePage } from '../src/klms/adapters/course-page.js';
import { coursefileFromLocation } from '../src/klms/coursefile.js';
import { checkCoursePage, HANDLED, NOT_IN_UPDATES } from '../src/sync/invariants.js';

const html = `<html><body><ul class="weeks">
<li class="section main" id="section-10"><div class="content"><h3 class="sectionname"><span class="sectionname">10주차<em>2026.11.02 ~ 2026.11.08</em></span></h3><div class="summary"></div>
<ul class="section img-text">
<li class="activity coursefile modtype_coursefile" id="module-1302057"><div><div class="activityinstance"><a class="aalink" href="https://klms.kaist.ac.kr/mod/coursefile/view.php?id=1302057"><img src="https://klms.kaist.ac.kr/theme/image.php/oklass39/core/1/f/pdf-24" class="iconlarge activityicon" /><span class="instancename">Chapter7<span class="accesshide"> 파일</span></span></a></div></div></li>
<li class="activity resource modtype_resource" id="module-1303219"><div><div class="activityinstance"><div class="aalink" onclick="M.course.format.downloadFile(&#039;https://klms.kaist.ac.kr/pluginfile.php/1959154/mod_resource/content/0/Chapter8.pdf&#039;, &#039;Chapter8.pdf&#039;)"><img src="https://klms.kaist.ac.kr/theme/image.php/oklass39/core/1/f/pdf-24" class="activityicon" /><span class="instancename">Chapter8<span class="accesshide"> 파일</span></span></div></div></li>
<li class="activity courseboard modtype_courseboard" id="module-1"><div><div class="activityinstance"><a class="aalink" href="https://klms.kaist.ac.kr/mod/courseboard/view.php?id=1"><img src="https://klms.kaist.ac.kr/theme/image.php/oklass39/courseboard/1/notice" class="activityicon" /><span class="instancename">공지</span></a></div></div></li>
</ul></div></li></ul></body></html>`;

test('coursefile 모듈: 유형·주소는 읽고 파일 링크는 비워 둔다 (resource 링크 추출률에 포함되지 않음)', () => {
  const page = parseCoursePage(html, '테스트');
  const cf = page.modules.find(m => m.cmid === 1302057)!;
  assert.equal(cf.modname, 'coursefile');
  assert.equal(cf.name, 'Chapter7');
  assert.equal(cf.url, 'https://klms.kaist.ac.kr/mod/coursefile/view.php?id=1302057');
  assert.equal(cf.file, null);
  assert.equal(page.resourceWithoutLink, 0);
  assert.deepEqual(page.modules.find(m => m.cmid === 1303219)!.file, { url: 'https://klms.kaist.ac.kr/pluginfile.php/1959154/mod_resource/content/0/Chapter8.pdf', filename: 'Chapter8.pdf' });
});

test('coursefileFromLocation: mod_coursefile pluginfile만, 파일명은 디코딩', () => {
  assert.deepEqual(coursefileFromLocation('https://klms.kaist.ac.kr/pluginfile.php/1957946/mod_coursefile/content/0/Chapter7.pdf?forcedownload=1'),
    { url: 'https://klms.kaist.ac.kr/pluginfile.php/1957946/mod_coursefile/content/0/Chapter7.pdf?forcedownload=1', filename: 'Chapter7.pdf' });
  assert.equal(coursefileFromLocation('https://klms.kaist.ac.kr/pluginfile.php/1/mod_coursefile/content/0/%EA%B0%95%EC%9D%98%201.pdf')!.filename, '강의 1.pdf');
  assert.equal(coursefileFromLocation('https://klms.kaist.ac.kr/login/index.php'), null);
  assert.equal(coursefileFromLocation('http://klms.kaist.ac.kr/pluginfile.php/1/mod_coursefile/content/0/a.pdf'), null, 'https만');
  assert.equal(coursefileFromLocation(null), null);
  assert.equal(coursefileFromLocation('not a url'), null);
});

test('불변식 1: coursefile은 수집 대상이지만 updates_since에 없어도 실패가 아니다', () => {
  assert.ok(HANDLED.has('coursefile'));
  assert.ok(NOT_IN_UPDATES.has('coursefile'));
  const page = parseCoursePage(html, '테스트');
  const r = checkCoursePage(page, new Set([1303219]));
  assert.deepEqual(r.failures, []);
  assert.equal(r.stats.resources, 2);
});
