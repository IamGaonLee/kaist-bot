// 과제 페이지 (mod/assign/view.php?id=<cmid>) 파서
import * as cheerio from 'cheerio';
import { ParseError } from '../../errors.js';
import { parseKoreanDateTime } from '../../util/time.js';
import { ASSIGN_ROW, SEL } from '../selectors.js';

export interface ParsedAssignPage {
  title: string;
  introHtml: string;
  /** 과제 설명 첨부 (제출물 파일은 제외) */
  attachments: { filename: string; url: string }[];
  /** td 클래스의 상태 코드, 예: submitted, new, draft. 없으면 null */
  submissionCode: string | null;
  submissionText: string | null;
  gradingCode: string | null;
  gradingText: string | null;
  dueText: string | null;
  due: number | null;
  lastModifiedText: string | null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const NO_ATTEMPT = /^(시도 하지 않음|No attempt)$/i;

export function parseAssignPage(html: string, where = '과제 페이지'): ParsedAssignPage {
  const $ = cheerio.load(html);
  const title = clean($(SEL.assign.title).first().text());
  if (!title) throw new ParseError(where, '과제 제목(h2)을 찾지 못했습니다');

  const intro = $(SEL.assign.intro).first();
  const introHtml = (intro.find('.no-overflow').first().html() ?? intro.html() ?? '').trim();

  const seen = new Set<string>();
  const attachments: ParsedAssignPage['attachments'] = [];
  $(SEL.assign.introAttachments).each((_, a) => {
    const url = $(a).attr('href')!;
    if (seen.has(url)) return;
    seen.add(url);
    attachments.push({ filename: clean($(a).text()) || decodeURIComponent(url.split('/').pop()!.split('?')[0]!), url });
  });

  const rows = new Map<string, { text: string; cls: string }>();
  $(SEL.assign.statusRows).each((_, tr) => {
    const th = clean($(tr).find('th').first().text());
    const td = $(tr).find('td').first();
    if (th) rows.set(th, { text: clean(td.text()), cls: td.attr('class') ?? '' });
  });
  const row = (names: readonly string[]) => names.map(n => rows.get(n)).find(Boolean) ?? null;
  const sub = row(ASSIGN_ROW.submission);
  const grade = row(ASSIGN_ROW.grading);
  const due = row(ASSIGN_ROW.due);
  const lastMod = row(ASSIGN_ROW.lastModified);

  const dueSec = due ? parseKoreanDateTime(due.text) : null;
  if (due && due.text && dueSec === null && !/없음|none/i.test(due.text)) {
    throw new ParseError(where, `마감 일시를 해석하지 못했습니다: "${due.text}"`);
  }

  return {
    title,
    introHtml,
    attachments,
    // "시도 하지 않음" 칸에는 상태 클래스가 없다(S3 확인) → 문구로 보완
    submissionCode: sub?.cls.match(/\bsubmissionstatus(\w+)/)?.[1] ?? (sub && NO_ATTEMPT.test(sub.text) ? 'noattempt' : null),
    submissionText: sub?.text ?? null,
    gradingCode: grade?.cls.match(/\bsubmission(graded|notgraded)\b/)?.[1] ?? null,
    gradingText: grade?.text ?? null,
    dueText: due?.text ?? null,
    due: dueSec,
    lastModifiedText: lastMod?.text ?? null,
  };
}
