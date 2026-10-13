// 드라이브 폴더 규칙 (설계 7절): <루트>/<학기>/<과목코드> <과목명>/{강의자료,과제,게시판첨부}
import path from 'node:path';

/** Windows에서 쓸 수 없는 문자 → _, 끝의 점·공백 제거, 길이 제한 */
export function safeName(name: string, max = 100): string {
  let s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > max) {
    const ext = path.extname(s);
    s = s.slice(0, max - ext.length).trim() + ext;
  }
  return s || '_';
}

export interface CourseRef { code: string; name: string }

export const semesterDir = (root: string, semesterLabel: string) => path.join(root, safeName(semesterLabel));
export const courseDir = (root: string, semesterLabel: string, c: CourseRef) => path.join(semesterDir(root, semesterLabel), safeName(`${c.code} ${c.name}`));

export const DIRS = {
  materials: '강의자료',
  assignments: '과제',
  boardFiles: '게시판첨부',
  previous: '_이전버전',
} as const;

/** "강의자료/<주차명>/파일" */
export const materialPath = (cdir: string, sectionName: string, filename: string) =>
  path.join(cdir, DIRS.materials, safeName(sectionName, 60), safeName(filename, 120));

export const assignmentDir = (cdir: string, taskName: string) => path.join(cdir, DIRS.assignments, safeName(taskName, 80));

/** "게시판첨부/2026-10-11 글 제목/파일" */
export const boardFileDir = (cdir: string, dateKst: string | null, title: string) =>
  path.join(cdir, DIRS.boardFiles, safeName(`${dateKst ?? '날짜없음'} ${title}`, 80));

/** 이전 버전 보관 경로: 같은 폴더의 _이전버전/이름 (날짜).ext */
export function previousVersionPath(file: string, stamp: string): string {
  const ext = path.extname(file);
  return path.join(path.dirname(file), DIRS.previous, `${path.basename(file, ext)} (${stamp})${ext}`);
}
