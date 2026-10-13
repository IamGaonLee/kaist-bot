// KLMS 전용 게시판 (mod/courseboard) 목록·글 파서. API가 없어 HTML이 유일한 소스.
import * as cheerio from 'cheerio';
import { ParseError } from '../../errors.js';
import { parseDashKst, parseKoreanDateTime } from '../../util/time.js';
import { SEL } from '../selectors.js';

export interface BoardListItem {
  bwid: number;
  title: string;
  author: string;
  /** 목록의 작성일(날짜만, KST 0시) */
  listDate: number | null;
  hasAttachment: boolean;
  url: string;
}

export interface ParsedBoardList {
  boardTitle: string;
  posts: BoardListItem[];
  currentPage: number;
  maxPage: number;
}

export interface ParsedArticle {
  title: string;
  author: string;
  postedText: string;
  postedAt: number | null;
  bodyHtml: string;
  attachments: { filename: string; url: string }[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseBoardList(html: string, where = '게시판 목록'): ParsedBoardList {
  const $ = cheerio.load(html);
  const table = $('table.courseboard_table');
  if (table.length === 0) throw new ParseError(where, '게시판 표(table.courseboard_table)를 찾지 못했습니다');

  // 머리글 이름으로 열 위치를 찾는다 (번호/제목/작성자/작성일/조회수)
  const headers = table.find('thead th').map((_, th) => clean($(th).text())).get();
  const col = (names: string[], fallback: number) => {
    const i = headers.findIndex(h => names.includes(h));
    return i >= 0 ? i : fallback;
  };
  const cWriter = col(['작성자', 'Writer', 'Author'], 2);
  const cDate = col(['작성일', 'Date'], 3);

  const posts: BoardListItem[] = [];
  $(SEL.board.rows).each((_, tr) => {
    const tds = $(tr).find('td');
    const link = $(tr).find('a[href*="article.php"]').first();
    if (link.length === 0) {
      // "등록된 게시글이 없습니다" 안내 행(칸 하나, colspan)만 건너뛰고, 그 밖에 링크 없는 행은 마크업 변화로 본다
      if (tds.length === 1 && tds.first().attr('colspan')) return;
      throw new ParseError(where, `글 링크가 없는 행이 있습니다: "${clean($(tr).text()).slice(0, 40)}"`);
    }
    const url = link.attr('href')!;
    const bwid = Number(url.match(/[?&]bwid=(\d+)/)?.[1]);
    if (!bwid) throw new ParseError(where, `글 링크에서 bwid를 찾지 못했습니다: ${url}`);
    const dateText = clean(tds.eq(cDate).text());
    posts.push({
      bwid,
      title: clean(link.text()),
      author: clean(tds.eq(cWriter).text()),
      listDate: parseDashKst(dateText),
      hasAttachment: $(tr).find(SEL.board.attachIcon).length > 0,
      url,
    });
  });

  const active = Number(clean($(SEL.board.activePage).first().text())) || 1;
  const pages = $(SEL.board.pageLinks).map((_, a) => Number($(a).attr('href')!.match(/[?&]page=(\d+)/)?.[1] ?? 0)).get();
  return {
    boardTitle: clean($(SEL.board.title).first().text()),
    posts,
    currentPage: active,
    maxPage: Math.max(active, ...pages),
  };
}

/** ".info .writer" 같은 "라벨 : 값" 요소에서 값만 */
function labelValue(text: string): string {
  const t = clean(text);
  const i = t.indexOf(':');
  return i >= 0 ? t.slice(i + 1).trim() : t;
}

export function parseArticle(html: string, where = '게시판 글'): ParsedArticle {
  const $ = cheerio.load(html);
  const root = $(SEL.article.root);
  if (root.length === 0) throw new ParseError(where, '글 본문 영역(.courseboard_view)을 찾지 못했습니다');
  const title = clean(root.find(SEL.article.subject).first().text());
  if (!title) throw new ParseError(where, '글 제목을 찾지 못했습니다');
  const postedText = labelValue(root.find(SEL.article.date).first().text());
  const body = root.find(SEL.article.body).first();
  const seen = new Set<string>();
  const attachments: ParsedArticle['attachments'] = [];
  root.find(SEL.article.files).each((_, a) => {
    const url = $(a).attr('href')!;
    if (seen.has(url) || !url.includes('/mod_courseboard/')) return;
    seen.add(url);
    attachments.push({ filename: clean($(a).text()) || decodeURIComponent(url.split('/').pop()!.split('?')[0]!), url });
  });
  return {
    title,
    author: labelValue(root.find(SEL.article.writer).first().text()),
    postedText,
    postedAt: parseKoreanDateTime(postedText),
    bodyHtml: (body.length ? body.html() : root.find(SEL.article.bodyFallback).first().html())?.trim() ?? '',
    attachments,
  };
}
