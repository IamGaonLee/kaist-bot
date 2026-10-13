// 강의자료·과제 첨부·게시판 첨부 다운로드 (S3). HEAD로 ETag/Last-Modified/Length 비교 후 받는다.
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ensureDir, paths } from '../config.js';
import { BlockedError, KaistError, SessionExpiredError } from '../errors.js';
import { probe, type KlmsSession } from '../klms/session.js';
import { openDb } from '../store/db.js';
import { formatKst } from '../util/time.js';
import { assignmentDir, boardFileDir, courseDir, materialPath, previousVersionPath, safeName } from './layout.js';

const stagingDir = path.join(paths.home, 'staging');

export interface FileCandidate {
  key: string;
  courseId: number;
  source: 'resource' | 'assign' | 'notice';
  ref: number;
  url: string;
  filename: string;
  section: number | null;
  updatesSig: string | null;
  target: string;
}

interface FileRow {
  key: string; url: string; status: string; local_path: string | null; updates_sig: string | null;
  etag: string | null; last_modified: string | null; length: number | null;
  dl_etag: string | null; dl_last_modified: string | null; dl_length: number | null;
}

export interface HeadInfo { status: 'ok' | 'viewer_only' | 'missing'; etag: string | null; lastModified: string | null; length: number | null; contentType: string | null; note?: string }

/** 과목 안에서 이름이 겹치는 과제는 폴더 이름에 cmid를 붙인다 (markdown.ts와 같은 규칙) */
export function taskFolder(cdir: string, courseId: number, cmid: number, name: string): string {
  const dup = (openDb().prepare(`select count(*) n from tasks t join modules m on m.cmid = t.cmid
    where t.course_id = ? and m.removed_at is null and t.name = ?`).get(courseId, name) as { n: number }).n > 1;
  return assignmentDir(cdir, dup ? `${name} (${cmid})` : name);
}

/** 대상 과목들의 받을 파일 목록 (로컬 DB 기준) */
export function collectCandidates(root: string, semesterLabel: string, courseIds: number[]): FileCandidate[] {
  const db = openDb();
  const out: FileCandidate[] = [];
  for (const cid of courseIds) {
    const c = db.prepare('select code, name from courses where id = ?').get(cid) as { code: string; name: string } | undefined;
    if (!c) continue;
    const cdir = courseDir(root, semesterLabel, c);
    const sections = new Map((db.prepare('select number, name from sections where course_id = ?').all(cid) as { number: number; name: string }[]).map(s => [s.number, s.name]));

    const res = db.prepare(`select cmid, section, file_url, file_name, updates_sig from modules
      where course_id = ? and modname = 'resource' and removed_at is null and file_url is not null order by section, cmid`).all(cid) as { cmid: number; section: number; file_url: string; file_name: string; updates_sig: string | null }[];
    for (const r of res) {
      out.push({ key: `r:${r.cmid}`, courseId: cid, source: 'resource', ref: r.cmid, url: r.file_url, filename: r.file_name, section: r.section, updatesSig: r.updates_sig,
        target: materialPath(cdir, sections.get(r.section) ?? `섹션 ${r.section}`, r.file_name) });
    }
    const tasks = db.prepare(`select t.cmid, t.name, t.attachments_json from tasks t join modules m on m.cmid = t.cmid
      where t.course_id = ? and m.removed_at is null and t.attachments_json is not null`).all(cid) as { cmid: number; name: string; attachments_json: string }[];
    for (const t of tasks) for (const a of JSON.parse(t.attachments_json) as { filename: string; url: string }[]) {
      out.push({ key: `a:${t.cmid}:${a.filename}`, courseId: cid, source: 'assign', ref: t.cmid, url: a.url, filename: a.filename, section: null, updatesSig: null,
        target: path.join(taskFolder(cdir, cid, t.cmid, t.name), safeName(a.filename, 120)) });
    }
    const notices = db.prepare(`select bwid, title, posted_at, list_date, attachments_json from notices where course_id = ? and attachments_json is not null and attachments_json <> '[]'`).all(cid) as { bwid: number; title: string; posted_at: number | null; list_date: number | null; attachments_json: string }[];
    for (const n of notices) for (const a of JSON.parse(n.attachments_json) as { filename: string; url: string }[]) {
      const when = n.posted_at ?? n.list_date;
      out.push({ key: `n:${n.bwid}:${a.filename}`, courseId: cid, source: 'notice', ref: n.bwid, url: a.url, filename: a.filename, section: null, updatesSig: null,
        target: path.join(boardFileDir(cdir, when ? formatKst(when).slice(0, 10) : null, n.title), safeName(a.filename, 120)) });
    }
  }
  // 같은 경로로 가는 파일이 둘 이상이면 이름 뒤에 ref를 붙여 구분
  const seen = new Map<string, number>();
  for (const f of out) seen.set(f.target.toLowerCase(), (seen.get(f.target.toLowerCase()) ?? 0) + 1);
  for (const f of out) if ((seen.get(f.target.toLowerCase()) ?? 0) > 1) {
    const p = path.parse(f.target);
    f.target = path.join(p.dir, `${p.name} (${f.ref})${p.ext}`);
  }
  return out;
}

/** HEAD 요청. 세션 만료처럼 보이는 HTML 응답은 세션을 다시 확인해 뷰어 전용과 구별한다 */
export async function headFile(session: KlmsSession, url: string): Promise<HeadInfo> {
  try {
    const r = await session.http.request(url, 'file', { method: 'HEAD' });
    if (r.status === 404 || r.status === 410) return { status: 'missing', etag: null, lastModified: null, length: null, contentType: null, note: `HTTP ${r.status}` };
    if (r.status >= 300 && r.status < 400) {
      return { status: 'viewer_only', etag: null, lastModified: null, length: null, contentType: null, note: `직접 다운로드 대신 ${new URL(r.headers.get('location') ?? '', url).pathname}로 이동` };
    }
    if (r.status !== 200) throw new KaistError('HTTP_ERROR', `파일 확인 실패 HTTP ${r.status}`);
    const len = r.headers.get('content-length');
    return { status: 'ok', etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified'), length: len ? Number(len) : null, contentType: r.headers.get('content-type') };
  } catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
    const p = await probe(session.http);
    if (!p.ok) throw e;
    return { status: 'viewer_only', etag: null, lastModified: null, length: null, contentType: 'text/html', note: '파일 대신 HTML 페이지가 옴 (뷰어 전용으로 판단)' };
  }
}

/** 마지막으로 성공한 다운로드(dl_*)와 비교 */
const changedSinceDownload = (row: FileRow, h: HeadInfo) =>
  (h.etag && row.dl_etag) ? h.etag !== row.dl_etag : (h.length !== row.dl_length || h.lastModified !== row.dl_last_modified);

export interface FilePlanItem {
  cand: FileCandidate;
  head: HeadInfo | null;
  action: 'download' | 'update' | 'skip' | 'unavailable';
  reason: string;
  prevStatus: string | null;
  /** 이미 받아 둔 로컬 사본 (갱신 시 이 파일을 _이전버전으로 옮긴다) */
  localPath: string | null;
}

/** 무엇을 받을지 정한다. HEAD는 새 파일·변경 신호·이전 실패·로컬 사본 없음에만 보낸다 */
export async function planFiles(session: KlmsSession, cands: FileCandidate[]): Promise<FilePlanItem[]> {
  const db = openDb();
  const plan: FilePlanItem[] = [];
  for (const cand of cands) {
    const row = db.prepare('select * from files where key = ?').get(cand.key) as FileRow | undefined;
    const localPath = row?.local_path && fs.existsSync(row.local_path) ? row.local_path : null;
    const base = { cand, prevStatus: row?.status ?? null, localPath };
    const signal = !row || row.url !== cand.url || ['error', 'missing', 'pending'].includes(row.status)
      || (cand.source === 'resource' && row.updates_sig !== cand.updatesSig)
      || !localPath && row.status !== 'viewer_only';
    if (!signal) { plan.push({ ...base, head: null, action: 'skip', reason: row.status === 'viewer_only' ? '뷰어 전용 (이전 확인)' : '변경 신호 없음' }); continue; }
    if (row?.status === 'pending' && !localPath && row.updates_sig === cand.updatesSig && row.url === cand.url && (row.etag || row.length)) {
      plan.push({ ...base, head: { status: 'ok', etag: row.etag, lastModified: row.last_modified, length: row.length, contentType: null }, action: 'download', reason: '확인 대기 중이던 파일' });
      continue;
    }
    const head = await headFile(session, cand.url);
    if (head.status !== 'ok') { plan.push({ ...base, head, action: 'unavailable', reason: head.note ?? head.status }); continue; }
    // 로컬 사본이 있으면 상태(오류 등)와 무관하게 마지막 성공 다운로드와 내용으로 비교한다
    if (localPath && row && row.dl_length !== null) {
      plan.push({ ...base, head, action: changedSinceDownload(row, head) ? 'update' : 'skip', reason: changedSinceDownload(row, head) ? '내용이 바뀜 (이전 버전 보관)' : '같음' });
    } else {
      plan.push({ ...base, head, action: 'download', reason: localPath ? '비교 기준 없음' : '새 파일' });
    }
  }
  return plan;
}

/** 계획을 DB에 기록 (다운로드 전) */
export function recordPlan(plan: FilePlanItem[]): void {
  const db = openDb();
  const now = new Date().toISOString();
  const ensure = db.prepare(`insert into files(key, course_id, source, ref, url, filename, section, status, first_seen_at)
    values(?, ?, ?, ?, ?, ?, ?, 'pending', ?) on conflict(key) do nothing`);
  // 받을 예정: HEAD 정보 기록 (비교 기준 dl_*는 다운로드 성공 때만 바뀐다)
  const pending = db.prepare(`update files set url=?, filename=?, section=?, etag=?, last_modified=?, length=?, checked_at=?,
    status=case when local_path is not null then status else 'pending' end where key=?`);
  // 받을 수 없음: 로컬 사본이 없을 때만 상태를 바꾸고, 같은 신호로 다시 확인하지 않게 updates_sig 기록
  const unavailable = db.prepare(`update files set url=?, note=?, updates_sig=?, checked_at=?,
    status=case when ? then status else ? end where key=?`);
  // 확인했더니 같음: 로컬 사본이 있으니 정상, 변경 신호만 갱신
  const same = db.prepare(`update files set status='ok', note=null, updates_sig=?, checked_at=? where key=?`);
  for (const p of plan) {
    if (!p.head) continue;
    const c = p.cand;
    ensure.run(c.key, c.courseId, c.source, c.ref, c.url, c.filename, c.section, now);
    if (p.action === 'unavailable') unavailable.run(c.url, p.reason, c.updatesSig, now, p.localPath ? 1 : 0, p.head.status, c.key);
    else if (p.action === 'skip') same.run(c.updatesSig, now, c.key);
    else pending.run(c.url, c.filename, c.section, p.head.etag, p.head.lastModified, p.head.length, now, c.key);
  }
}

export interface DownloadOutcome { key: string; target: string; action: 'download' | 'update'; ok: boolean; bytes?: number; error?: string }

/** 이전 버전 보관 경로 (같은 날 두 번째면 시각을 덧붙임) */
function archivePath(file: string): string {
  const day = new Date().toISOString().slice(0, 10);
  let p = previousVersionPath(file, day);
  if (fs.existsSync(p)) p = previousVersionPath(file, `${day} ${Date.now()}`);
  return p;
}

/** 계획 중 download/update 항목을 실제로 받는다 */
export async function executeDownloads(session: KlmsSession, plan: FilePlanItem[], runId: number, onStatus?: (m: string) => void): Promise<DownloadOutcome[]> {
  const db = openDb();
  const todo = plan.filter(p => p.action === 'download' || p.action === 'update');
  const out: DownloadOutcome[] = [];
  let i = 0;
  for (const p of todo) {
    i++;
    if (i % 10 === 1) onStatus?.(`파일 받는 중 ${i}/${todo.length}...`);
    const target = p.cand.target;
    const staged = path.join(stagingDir, `${process.pid}-${i}.part`);
    const tmp = target + '.kaist-part';
    try {
      const r = await session.http.request(p.cand.url, 'file');
      if (r.status !== 200 || !r.body) throw new KaistError('HTTP_ERROR', `HTTP ${r.status}`);
      // 드라이브 가상 디스크(G:)에 바로 스트림으로 쓰면 직후 크기가 늦게 반영된다(S3 확인).
      // 로컬 staging에 받아 스트림에서 센 바이트로 검증한 뒤 드라이브로 복사한다.
      ensureDir(stagingDir);
      let bytes = 0;
      const counter = new Transform({ transform(chunk: Buffer, _enc, cb) { bytes += chunk.length; cb(null, chunk); } });
      await pipeline(Readable.fromWeb(r.body as unknown as WebReadableStream), counter, fs.createWriteStream(staged));
      const expect = r.headers.get('content-length');
      if (expect && Number(expect) !== bytes) throw new KaistError('DOWNLOAD_INCOMPLETE', `받은 크기 ${bytes} ≠ ${expect}`);
      ensureDir(path.dirname(target));
      fs.copyFileSync(staged, tmp);
      // 이전 버전은 지우지 않는다: 기존 사본(경로가 바뀌었으면 옛 경로)과 대상 자리에 있던 파일을 _이전버전으로
      for (const old of new Set([p.localPath, target].filter((x): x is string => !!x && fs.existsSync(x)))) {
        const arch = archivePath(old);
        ensureDir(path.dirname(arch));
        fs.renameSync(old, arch);
      }
      fs.renameSync(tmp, target);
      const etag = r.headers.get('etag') ?? p.head?.etag ?? null;
      const lm = r.headers.get('last-modified') ?? p.head?.lastModified ?? null;
      db.prepare(`update files set status='ok', local_path=?, etag=?, last_modified=?, length=?, dl_etag=?, dl_last_modified=?, dl_length=?,
          updates_sig=?, downloaded_at=?, downloaded_run=?, note=null where key=?`)
        .run(target, etag, lm, bytes, etag, lm, bytes, p.cand.updatesSig, new Date().toISOString(), runId, p.cand.key);
      out.push({ key: p.cand.key, target, action: p.action as 'download' | 'update', ok: true, bytes });
    } catch (e) {
      if (e instanceof SessionExpiredError || e instanceof BlockedError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      // 로컬 사본이 있으면 상태는 그대로 두고 오류 메모만 남긴다 (사본은 계속 보이게)
      db.prepare(`update files set status=case when local_path is not null then status else 'error' end, note=? where key=?`).run(msg, p.cand.key);
      out.push({ key: p.cand.key, target, action: p.action as 'download' | 'update', ok: false, error: msg });
    } finally {
      fs.rmSync(staged, { force: true });
      fs.rmSync(tmp, { force: true });
    }
  }
  return out;
}
