// 수집 기록 DB (%LOCALAPPDATA%\kaist-cli\kaist.db, node:sqlite)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { paths, ensureDir } from '../config.js';

const SCHEMA = `
create table if not exists meta (key text primary key, value text);
create table if not exists courses (
  id integer primary key, code text not null, name text not null, shortname text not null,
  category text, startdate integer, enddate integer, url text, semester text not null,
  active integer not null default 1, last_synced_at text
);
create table if not exists sections (
  course_id integer not null, number integer not null, name text not null, date_range text, summary text,
  primary key (course_id, number)
);
create table if not exists modules (
  cmid integer primary key, course_id integer not null, section integer, modname text not null, name text not null,
  url text, file_url text, file_name text, end_dt_text text, status_text text, board_kind text, label_text text,
  updates_sig text, content_hash text not null,
  first_seen_at text not null, last_seen_at text not null, removed_at text
);
create table if not exists tasks (
  cmid integer primary key, course_id integer not null, modname text not null, name text not null,
  due integer, due_source text, html_end integer, page_due integer, open_at integer,
  needs_review integer not null default 0, review_reason text, calendar_event_id integer,
  submission_code text, submission_text text, grading_code text, grading_text text, last_modified_text text,
  intro_html text, intro_hash text, attachments_json text,
  page_fetched_at text, updated_at text not null
);
create table if not exists boards (
  cmid integer primary key, course_id integer not null, kind text not null, name text not null,
  last_checked_at text, post_count integer
);
create table if not exists notices (
  bwid integer primary key, board_cmid integer not null, course_id integer not null, board_kind text not null,
  title text not null, author text, list_date integer, posted_at integer, posted_text text,
  body_html text, body_hash text, has_attachment integer, attachments_json text,
  first_seen_at text not null, updated_at text not null
);
create table if not exists sync_runs (
  id integer primary key autoincrement, started_at text not null, finished_at text,
  status text not null, summary_json text
);
create table if not exists changes (
  run_id integer not null, course_id integer, kind text not null, ref integer not null,
  change text not null, title text, detail text
);
create table if not exists files (
  key text primary key, course_id integer not null, source text not null, ref integer not null,
  url text not null, filename text not null, section integer,
  etag text, last_modified text, length integer, updates_sig text,
  local_path text, status text not null, note text,
  first_seen_at text not null, downloaded_at text, downloaded_run integer, checked_at text
);
create index if not exists files_course on files(course_id);
create index if not exists changes_run on changes(run_id);
create index if not exists notices_course on notices(course_id, posted_at);
create index if not exists tasks_due on tasks(due);
`;

let db: DatabaseSync | null = null;

export function openDb(file = path.join(paths.home, 'kaist.db')): DatabaseSync {
  if (db) return db;
  ensureDir(path.dirname(file));
  db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** 기존 DB에 나중에 추가된 칸 */
function migrate(d: DatabaseSync): void {
  const add = (table: string, col: string, type: string) => {
    const cols = (d.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map(c => c.name);
    if (!cols.includes(col)) d.exec(`alter table ${table} add column ${col} ${type}`);
  };
  // 마지막으로 성공한 다운로드의 값 (실패·일시 오류가 비교 기준을 덮지 않도록)
  add('files', 'dl_etag', 'text');
  add('files', 'dl_last_modified', 'text');
  add('files', 'dl_length', 'integer');
  // 과제 페이지를 마지막으로 성공적으로 처리했을 때의 updates_since 서명
  add('tasks', 'page_sig', 'text');
  d.exec(`update files set dl_etag = etag, dl_last_modified = last_modified, dl_length = length where status = 'ok' and dl_length is null`);
  d.exec(`update tasks set page_sig = (select updates_sig from modules where modules.cmid = tasks.cmid) where page_sig is null and page_fetched_at is not null`);
}

export function getMeta(key: string): string | null {
  const row = openDb().prepare('select value from meta where key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  openDb().prepare('insert into meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value').run(key, value);
}

/** 여러 쓰기를 한 트랜잭션으로 */
export function tx<T>(fn: () => T): T {
  const d = openDb();
  d.exec('begin');
  try {
    const r = fn();
    d.exec('commit');
    return r;
  } catch (e) {
    d.exec('rollback');
    throw e;
  }
}
