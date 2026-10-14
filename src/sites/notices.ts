// S8c 포털 학사 공지: 게시판별 증분 수집 → portal_notices (설계 docs/portal-design.md 3절, 사용자 결정 3)
// 게시판마다 최신 글부터 한 쪽(20개)씩 읽다가, 이미 아는 글이나 30일보다 오래된 글을 만나면 멈춘다. 1회 최대 20쪽.
// 세미나(일정형)는 게시판 필터가 안 돼 통합 목록에서 골라낸다.
// 수강/학적·장학/복지·생활관은 새 글·수정된 글만 본문을 한 번 받고, 세미나는 제목만 저장한다. 첨부는 파일명만.
import { KaistError } from '../errors.js';
import { getMeta, openDb, setMeta } from '../store/db.js';
import { htmlToText } from '../store/queries.js';
import { formatKst, nowSec } from '../util/time.js';
import type { SiteHttp } from './http.js';
import { parseBoardList, parsePostDetail, portalDtToSec, type BoardPost, type PostDetail } from './parse.js';
import { PORTAL_BOARDS } from './sites.js';

export const PAGE_SIZE = 20;
export const STREAM_PAGE_SIZE = 50;
export const MAX_PAGES = 20;
export const BACKFILL_DAYS = 30;

export interface KnownPost { chgText: string; hasBody: boolean }

/**
 * 한 쪽 분류 (순수 함수). 목록은 pstNo(게시 시각) 내림차순이다.
 * - 처음 보는 글: 30일 안이거나 고정글이면 새 글
 * - 아는 글: 수정 시각이 바뀌었거나 본문을 아직 못 받았으면 다시 받음
 * - 고정글이 아닌 글 중 아는 글이나 30일보다 오래된 글이 있으면 다음 쪽은 읽지 않는다
 */
export function classifyPage(posts: BoardPost[], known: Map<number, KnownPost>, cutoffSec: number, wantBody: boolean, pageSize = PAGE_SIZE) {
  const fresh: BoardPost[] = [];
  const changed: BoardPost[] = [];
  let stop = posts.length < pageSize;
  for (const p of posts) {
    const k = known.get(p.pstNo);
    const old = portalDtToSec(p.regDt) < cutoffSec;
    if (!k) { if (!old || p.pinned) fresh.push(p); }
    else if (k.chgText !== p.chgDt || (wantBody && !k.hasBody)) changed.push(p);
    if (!p.pinned && (k || old)) stop = true;
  }
  return { fresh, changed, stop };
}

export interface PortalNoticeResult {
  boards: { no: number; name: string; pages: number; fresh: number; changed: number }[];
  /** 게시판을 처음 받은 경우(30일 백필)는 changes에 넣지 않는다 */
  changes: { pstNo: number; change: 'new' | 'changed'; title: string; detail: string }[];
  bodies: number;
  warnings: string[];
}

function knownPosts(boardNo: number): Map<number, KnownPost> {
  const rows = openDb().prepare('select pst_no, chg_text, body_html is not null has_body from portal_notices where board_no = ?').all(boardNo) as { pst_no: number; chg_text: string; has_body: number }[];
  return new Map(rows.map(r => [r.pst_no, { chgText: r.chg_text, hasBody: r.has_body === 1 }]));
}

function json(text: string, contentType: string, status: number, where: string): unknown {
  if (status !== 200 || !contentType.includes('json')) throw new KaistError('PORTAL_ERROR', `${where} 응답이 이상합니다 (HTTP ${status}, ${contentType || '형식 없음'})`);
  return JSON.parse(text);
}

export async function syncPortalNotices(http: SiteHttp, runId: number | null, log: (m: string) => void = () => {}): Promise<PortalNoticeResult> {
  const res: PortalNoticeResult = { boards: [], changes: [], bodies: 0, warnings: [] };
  const cutoff = nowSec() - BACKFILL_DAYS * 86400;
  const db = openDb();
  const upsert = db.prepare(`insert into portal_notices(pst_no, board_no, board_name, title, dept, reg_at, chg_text, pinned, atch_count, attachments_json, body_html, body_fetched_at, first_seen_sync_id, first_seen_at, updated_at)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(pst_no) do update set title = excluded.title, dept = excluded.dept, chg_text = excluded.chg_text, pinned = excluded.pinned, atch_count = excluded.atch_count,
      attachments_json = coalesce(excluded.attachments_json, portal_notices.attachments_json), body_html = coalesce(excluded.body_html, portal_notices.body_html),
      body_fetched_at = coalesce(excluded.body_fetched_at, portal_notices.body_fetched_at), updated_at = excluded.updated_at`);
  const list = async (query: string, where: string) => {
    const r = await http.request(`/wz/api/board/recents?${query}`);
    return parseBoardList(json(r.text, r.contentType, r.status, where)).posts;
  };
  const state = new Map(PORTAL_BOARDS.map(b => {
    const known = knownPosts(b.no);
    const stat = { no: b.no, name: b.name, pages: 0, fresh: 0, changed: 0 };
    res.boards.push(stat);
    return [b.no, { board: b, known, firstRun: known.size === 0, stat, todo: [] as { post: BoardPost; change: 'new' | 'changed' }[] }];
  }));
  const take = (s: NonNullable<ReturnType<typeof state.get>>, c: ReturnType<typeof classifyPage>) => {
    for (const p of c.fresh) { s.todo.push({ post: p, change: 'new' }); s.known.set(p.pstNo, { chgText: p.chgDt, hasBody: false }); }
    for (const p of c.changed) s.todo.push({ post: p, change: 'changed' });
  };

  // 1) 필터 게시판: 게시판마다 20개씩, 아는 글·30일 밖 글을 만나면 멈춤 (합쳐서 최대 20쪽)
  let pagesLeft = MAX_PAGES;
  for (const s of [...state.values()].filter(x => x.board.via === 'filter')) {
    for (let page = 1; ; page++) {
      if (pagesLeft-- <= 0) { res.warnings.push(`포털 공지: 1회 최대 ${MAX_PAGES}쪽에 닿아 ${s.board.name} 게시판을 끝까지 읽지 못했습니다.`); break; }
      s.stat.pages++;
      log(`포털 공지: ${s.board.name} ${page}쪽`);
      const posts = await list(`pageIndex=${page}&recordCountPerPage=${PAGE_SIZE}&boardNos=${s.board.no}`, `포털 공지 목록(${s.board.name})`);
      const other = posts.find(p => p.boardNo !== s.board.no);
      if (other) throw new KaistError('PORTAL_ERROR', `포털 공지 목록(${s.board.name})에 다른 게시판(${other.boardNo}) 글이 섞여 왔습니다. boardNos 필터가 바뀌었을 수 있습니다.`);
      const c = classifyPage(posts, s.known, cutoff, s.board.body);
      take(s, c);
      if (c.stop) break;
    }
  }

  // 2) 일정형 게시판(세미나): 필터 없는 통합 목록을 50개씩 시간순으로 읽으며 골라낸다.
  //    지난번에 본 가장 새 글 시각(1시간 여유)이나 30일 밖에 닿으면 멈춤 (최대 20쪽)
  const stream = [...state.values()].filter(x => x.board.via === 'stream');
  if (stream.length) {
    const seen = Number(getMeta('portal_stream_newest_reg') ?? 0);
    const streamCutoff = Math.max(cutoff, seen - 3600);
    let newest = 0;
    let done = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      log(`포털 공지: 통합 목록 ${page}쪽 (${stream.map(s => s.board.name).join(', ')})`);
      const posts = await list(`pageIndex=${page}&recordCountPerPage=${STREAM_PAGE_SIZE}`, '포털 공지 통합 목록');
      for (const s of stream) {
        s.stat.pages++;
        take(s, classifyPage(posts.filter(p => p.boardNo === s.board.no), s.known, cutoff, false, 0));
      }
      const dated = posts.filter(p => !p.pinned).map(p => portalDtToSec(p.regDt));
      if (page === 1) newest = Math.max(0, ...dated);
      if (posts.length < STREAM_PAGE_SIZE || dated.some(t => t < streamCutoff)) { done = true; break; }
    }
    if (done) setMeta('portal_stream_newest_reg', String(Math.max(newest, seen)));
    else res.warnings.push(`포털 공지: 통합 목록 ${MAX_PAGES}쪽 안에서 지난번 위치에 닿지 못했습니다. 다음 sync에서 처음부터 다시 읽습니다.`);
  }

  // 3) 저장: 본문 게시판은 새 글·수정된 글만 본문을 한 번 받는다
  for (const s of state.values()) {
    for (const { post, change } of s.todo) {
      let detail: PostDetail | null = null;
      if (s.board.body) {
        const r = await http.request(`/wz/api/board/recents/${post.pstNo}?boardNo=${s.board.no}`);
        detail = parsePostDetail(json(r.text, r.contentType, r.status, `포털 공지 본문(${s.board.name})`), post.pstNo);
        res.bodies++;
      }
      const p = detail ?? post;
      const now = new Date().toISOString();
      upsert.run(p.pstNo, s.board.no, s.board.name, p.title, p.dept, portalDtToSec(p.regDt), p.chgDt, p.pinned ? 1 : 0, p.atchCount,
        detail ? JSON.stringify(detail.attachments) : null, detail?.bodyHtml ?? null, detail ? now : null, runId, now, now);
      if (change === 'new') s.stat.fresh++; else s.stat.changed++;
      if (!s.firstRun) res.changes.push({ pstNo: p.pstNo, change, title: `[${s.board.name}] ${p.title}`, detail: change === 'new' ? (p.dept ?? '포털 공지') : '수정됨' });
    }
  }
  setMeta('portal_notices_fetched_at', new Date().toISOString());
  return res;
}

// ---------- 조회 (로컬만) ----------

export interface PortalNoticeView {
  pstNo: number;
  board: string;
  boardNo: number;
  title: string;
  dept: string | null;
  postedAt: number;
  postedKst: string;
  pinned: boolean;
  attachments: { name: string; size: number }[];
  attachmentCount: number;
  /** 본문을 받는 게시판인지 (세미나는 제목만) */
  hasBody: boolean;
  bodyText?: string;
}

/** board: 번호 또는 이름 일부 */
export function listPortalNotices(opts: { sinceSec?: number; board?: string; body?: boolean; limit?: number } = {}): PortalNoticeView[] {
  const rows = openDb().prepare('select * from portal_notices order by reg_at desc').all() as Record<string, any>[];
  const b = opts.board?.trim();
  return rows
    .filter(r => !b || String(r.board_no) === b || String(r.board_name).includes(b))
    .filter(r => opts.sinceSec === undefined || r.reg_at >= opts.sinceSec)
    .slice(0, opts.limit ?? Infinity)
    .map(r => ({
      pstNo: r.pst_no, board: r.board_name, boardNo: r.board_no, title: r.title, dept: r.dept ?? null,
      postedAt: r.reg_at, postedKst: formatKst(r.reg_at), pinned: r.pinned === 1,
      attachments: JSON.parse(r.attachments_json ?? '[]'), attachmentCount: r.atch_count, hasBody: r.body_html !== null,
      ...(opts.body && r.body_html ? { bodyText: htmlToText(r.body_html) } : {}),
    }));
}

/** 같은 글이 두 번 들어가지 않았는지 (완료 기준: 연속 sync 중복 0). pst_no가 기본키라 제목·날짜 기준으로 본다 */
export function duplicatePortalNotices(): number {
  const r = openDb().prepare('select count(*) n from (select board_no, title, reg_at from portal_notices group by board_no, title, reg_at having count(*) > 1)').get() as { n: number };
  return r.n;
}

export const portalNoticeCount = () => (openDb().prepare('select count(*) n from portal_notices').get() as { n: number }).n;

