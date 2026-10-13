// 과목 페이지 (course/view.php?id=X&section=0) 파서
import * as cheerio from 'cheerio';
import { ParseError } from '../../errors.js';
import { parseEndDt } from '../../util/time.js';
import { BOARD_KIND_BY_ICON, SEL } from '../selectors.js';

export interface ParsedSection {
  number: number;
  name: string;
  /** "2026.08.31 ~ 2026.09.06" 형태 원문, 없으면 null */
  dateRange: string | null;
  summaryText: string;
}

export interface ParsedModule {
  cmid: number;
  modname: string;
  section: number;
  name: string;
  url: string | null;
  /** resource: downloadFile(...)의 pluginfile URL과 파일명 */
  file: { url: string; filename: string } | null;
  /** strong.end-dt 원문과 해석 결과 */
  endDtText: string | null;
  endDt: { start: number | null; end: number | null } | null;
  status: string | null;
  /** courseboard 종류 (아이콘 파일명 기준) */
  boardKind: 'notice' | 'qna' | 'board' | null;
  /** label 본문 텍스트 */
  text: string | null;
}

export interface ParsedCoursePage {
  theme: string | null;
  themerev: string | null;
  userId: number | null;
  sections: ParsedSection[];
  modules: ParsedModule[];
  /** downloadFile 링크를 못 뽑은 resource 수 (불변식 2) */
  resourceWithoutLink: number;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseCoursePage(html: string, where = '과목 페이지'): ParsedCoursePage {
  const $ = cheerio.load(html);
  const theme = html.match(/"theme":"([^"]+)"/)?.[1] ?? null;
  const themerev = html.match(/"themerev":"?(\d+)/)?.[1] ?? null;
  const userIdAttr = $(SEL.course.userId).first().attr('data-user-id');
  const userId = userIdAttr && /^\d+$/.test(userIdAttr) ? Number(userIdAttr) : null;

  const sections: ParsedSection[] = [];
  const modules: ParsedModule[] = [];
  let resourceWithoutLink = 0;

  $(SEL.course.section).each((_, el) => {
    const sec = $(el);
    const number = Number(sec.attr('id')!.replace('section-', ''));
    if (!Number.isInteger(number)) throw new ParseError(where, `섹션 id 형식이 이상합니다: ${sec.attr('id')}`);
    const nameEl = sec.find(SEL.course.sectionName).first().clone();
    const dateRange = clean(nameEl.find(SEL.course.sectionDates).text()) || null;
    nameEl.find(SEL.course.sectionDates).remove();
    sections.push({
      number,
      name: clean(nameEl.text()) || `섹션 ${number}`,
      dateRange,
      summaryText: clean(sec.find(SEL.course.sectionSummary).first().text()),
    });

    sec.find(SEL.course.module).each((__, mel) => {
      const m = $(mel);
      const cmid = Number(m.attr('id')!.replace('module-', ''));
      const modname = (m.attr('class') ?? '').match(/\bmodtype_(\w+)/)?.[1];
      if (!Number.isInteger(cmid) || !modname) throw new ParseError(where, `활동 항목의 id/유형을 읽지 못했습니다: ${m.attr('id')}`);

      const nameEl = m.find(SEL.course.moduleName).first().clone();
      nameEl.find(SEL.course.moduleNameHidden).remove();
      const name = clean(nameEl.text());

      let file: ParsedModule['file'] = null;
      if (modname === 'resource') {
        const onclick = m.find(SEL.course.moduleDownload).attr('onclick') ?? '';
        const fm = onclick.match(/downloadFile\(\s*'([^']+)'\s*,\s*'([^']*)'/);
        if (fm) file = { url: fm[1]!, filename: fm[2]! };
        else resourceWithoutLink++;
      }

      const endDtText = clean(m.find(SEL.course.moduleEndDt).first().text()) || null;
      const endDt = endDtText ? parseEndDt(endDtText) : null;
      if (endDtText && !endDt) throw new ParseError(where, `기간 표기를 해석하지 못했습니다 (cmid ${cmid}): "${endDtText}"`);

      const icon = m.find(SEL.course.moduleIcon).attr('src') ?? '';
      const boardKind = modname === 'courseboard' ? BOARD_KIND_BY_ICON[icon.split('/').pop() ?? ''] ?? 'board' : null;

      modules.push({
        cmid,
        modname,
        section: number,
        name: name || (modname === 'label' ? '' : `(이름 없음 ${cmid})`),
        url: m.find(SEL.course.moduleLink).attr('href') ?? null,
        file,
        endDtText,
        endDt,
        status: clean(m.find(SEL.course.moduleStatus).first().text()) || null,
        boardKind,
        text: modname === 'label' ? clean(m.find(SEL.course.labelContent).text()) : null,
      });
    });
  });

  if (sections.length === 0) throw new ParseError(where, '섹션을 하나도 찾지 못했습니다 (format_kaistweeks 마크업이 바뀌었을 수 있음)');
  return { theme, themerev, userId, sections, modules, resourceWithoutLink };
}
