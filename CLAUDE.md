# KAISTBOT — `kaist` CLI

KAIST KLMS(Moodle 3.9 커스텀)의 과제, 공지, 강의자료를 수집합니다. 수집한 것은 구글 드라이브 폴더와 전용 구글 캘린더 "KLMS"에 정리합니다. 개인 Windows PC에서만 쓰는 TypeScript CLI이고, Claude Code가 이 CLI를 도구로 써서 학교생활을 논의합니다.

## 현재 단계

- S0 완료 (설계 문서 v0.2, CLAUDE.md, 2026-10-14 승인)
- S1 완료: 인증과 과목 목록
- S2 완료 (2026-10-14): `sync`(과목 구성·과제·공지), `assignments`, `notices`, `videos`, `doctor`. 사용자 대조 완료(과제 3개 일치)
- S3 완료 (2026-10-14): 파일 다운로드(105개), 드라이브 폴더, 요약 md/PDF, 과제 `설명.md`, `files`. 휴대폰 확인 완료
- S4 완료 (2026-10-14): 구글 "KLMS" 캘린더 마감 15개 + 시험 8건(수동). OAuth는 테스트 상태라 7일마다 `kaist cal login` 필요. 휴대폰 확인 완료
- **S5 진행 중**: 에이전트 연결과 다듬기
- 다음: S6 학사 일정 추출(`docs/school-events-design.md`) → Dooray 메일 → Portal
- 사용자 할 일:
  - OneDrive 웹 휴지통에서 옛 `local/` 폴더를 영구 삭제 (쿠키·토큰 사본 포함)

## 에이전트로 쓸 때 (학교생활 논의)

사용자가 과제, 마감, 공지, 강의자료를 물으면 `kaist` CLI를 도구로 쓴다. 항상 `--json`을 붙여 결과를 읽는다.

- **조회는 로컬 데이터로 먼저 답한다.** 모든 조회 JSON에 `lastSyncKst`와 `lastSyncMinutesAgo`가 있다. 데이터가 얼마나 오래됐는지 함께 알린다.
  - "새로 올라온 거": 먼저 `kaist changes --json`(마지막 sync의 변경, `--runs 3`으로 여러 회)을 본다. 오래됐으면 sync를 제안한다.
  - 마감·제출 상태: `kaist assignments --json` (`--due 7d`, `--all`, `--course <코드|이름>`). 각 과제에 `hoursLeft`, `submission`(submitted/noattempt 등), `descriptionFile`(설명.md), `attachments[].localPath`가 있다.
  - 시험 일정: 지금은 `kaist cal list --json`의 `[과목] 중간고사/기말고사` 일정(직접 넣은 것, "(계획서 기준)"이면 바뀌었을 수 있음). S6 이후 `kaist events`
  - 공지: `kaist notices --since 3d --json` (본문이 필요하면 `--body`)
  - 강의자료: `kaist files --json` (`--new`는 마지막 sync에서 받은 것), 영상 링크: `kaist videos --json`
  - 캘린더: `kaist cal list --json`
- **최신화가 필요하면 `kaist sync`를 제안하고, 실행 전에 사용자에게 알린다.** 세션이 만료됐으면 로그인 창이 뜨고 사용자가 비밀번호 입력과 폰 승인을 해야 한다. 세션이 살아 있으면 승인 없이 끝난다. 확인하려면 `kaist status --check`.
  - 종료 코드 2(`SESSION_EXPIRED`): `--no-login`으로 돌렸는데 세션이 만료된 경우다. 사용자에게 로그인할지 묻는다.
  - sync 결과의 `changes`(새 과제, 마감 변경, 새 글, 새 자료)를 그대로 브리핑에 쓴다. `needs_review`가 있으면 꼭 알린다(마감 정보가 서로 달라 KLMS에서 직접 확인해야 함).
- **과제를 같이 풀 때 읽을 파일** (드라이브, `G:\내 드라이브\KAIST\2026-가을\<코드> <과목명>\`):
  - `과제\<과제명>\설명.md`(설명·마감·첨부 목록)와 같은 폴더의 첨부파일
  - `강의자료\<주차>\` 원본 파일, `_과목정보.md`(주차 구성, 공지 본문)
- **캘린더**: 마감은 sync가 자동으로 "KLMS" 캘린더에 넣는다. 작업 일정은 `kaist cal add --title ... --start "YYYY-MM-DD HH:MM" --minutes 90`으로 넣는다. **삭제는 실행 전에 사용자에게 확인**한다(`kaist cal delete <id>`는 `--yes` 없이 대상만 보여준다). CLI는 이 앱이 만든 KLMS 캘린더만 다룰 수 있다.
- 받은 자료는 사용자 개인 학습용이다. 다른 사람에게 보내거나 공유하는 일은 하지 않는다.

## 문서 (충돌 시 위가 우선)

1. `docs/handoff-implementation.md`: 확정 결정, 작업 순서 S0~S5, 작업 규칙
2. `docs/phase0-report.md`: 기술 검증 결과. 3절이 수집 방식과 위험 완화의 근거
3. `docs/kaist-agent-design.md` (v0.2): 요구사항, 구조, 명령, 저장 위치

## 폴더 구조

```
docs/              설계·검증·인수인계 문서
scripts/phase0/    0단계 검증 스크립트 (버리는 코드, 참고용)
src/               CLI 본체 (S1부터)
%LOCALAPPDATA%\kaist-cli\   세션 쿠키, OAuth 토큰, DB, HTML 샘플·원문 (저장소 밖)
```

## 개발

- 빌드 `npm run build` (dist/), 전역 명령 연결 `npm link` → `kaist`
- 개발 실행 `npm run dev -- <명령>`, 테스트 `npm test` (tests/, 합성 데이터만)
- 코드 배치: `src/sso/`(사이트 무관 로그인 창), `src/klms/`(site.ts 상수·판별, http.ts 공통 계층, ajax.ts, session.ts, courses.ts), `src/store/`(로컬 데이터)
- 종료 코드: 0 성공, 1 오류, 2 세션 만료(`--no-login`), 3 로그인 취소
- 명령 (모두 `--json` 지원):
  - `kaist login [--force]`, `kaist status [--check]`, `kaist courses [--refresh] [--no-login]`
  - `kaist sync [--course X] [--no-login]`: KLMS 접속. 과목 페이지, updates_since, 캘린더(사이트 전체 월별), 과제 페이지(새것·변경·마감 임박만), 게시판 새 글
  - `kaist assignments [--due 7d] [--all] [--course X]`, `kaist notices [--since 3d] [--kind notice|qna|board] [--body]`, `kaist videos`: 로컬 DB만
  - `kaist doctor [과목] [--offline]`: 불변식 검사 (DB 변경 없음)
  - `kaist sync`는 파일도 받는다 (`--no-files`로 생략). 첫 전체 다운로드는 `--confirm-download`로 한 번 승인(완료됨). `kaist files [--new]`
- 로컬 데이터: `%LOCALAPPDATA%\kaist-cli\kaist.db`(SQLite), `snapshots\`(최근 HTML 원문), `staging\`(다운로드 임시), `config.json`(선택: `driveRoot`)
- 드라이브: `G:\내 드라이브\KAIST\2026-가을\<코드> <과목명>\{강의자료\<주차>, 과제\<이름>, 게시판첨부\<날짜 제목>}`, 바뀐 파일의 이전 버전은 같은 폴더 `_이전버전\`. 요약은 `_요약.md`/`_과목정보.md`(Claude용)와 같은 이름의 `.pdf`(사람용, sync마다 재생성)
- 드라이브(G:)에는 스트림으로 바로 쓰지 않는다. 직후 크기가 늦게 반영돼 검증이 깨진다. staging에 받아 검증한 뒤 복사한다(`src/files/download.ts`)
- 파서 코드: `src/klms/adapters/`, 셀렉터는 `src/klms/selectors.ts` 한 곳

## 작업 규칙

**소통**
- 질문은 한 번에 하나씩, 이유를 설명하고 묻는다. 필요한 정보가 없으면 추측하지 말고 묻는다.
- 결과는 과장 없이 보고한다. 안 된 것과 확인하지 못한 것을 축소하지 않고, 관찰과 추정을 구분한다.
- 한 세션에 한 단계씩 진행한다. 완료 기준을 직접 실행해 확인하고 결과를 보여준 뒤 멈춘다. 사용자가 확인하면 커밋한다.
- 문서 산출물은 `.md` 파일로 만든다.

**KLMS 접근**
- 읽기만 한다. 제출, 글쓰기, 설정 변경 등 상태를 바꾸는 요청은 코드에 넣지 않는다.
- 이번 학기 수강 과목만 대상으로 한다. 사용자 검색이나 다른 과목 탐색은 하지 않는다.
- 요청은 간격을 두고 동시 2개 이하로 보낸다. 개발 중 반복 실행은 저장한 샘플로 하고, 실제 서버 요청은 최소로 한다.
- **WS 토큰을 쓰지 않는다.** `launch.php`, `webservice/rest`, `tool_mobile_*` 호출 코드를 넣지 않는다.
- 2단계 인증을 우회하지 않는다. 비밀번호를 묻거나 저장하거나 자동 입력하지 않는다. 로그인은 매번 새 브라우저 컨텍스트로 한다.
- 다운로드가 막힌 자료와 스트리밍 영상은 받지 않는다. 받은 자료는 개인 학습용이며 공유 기능을 만들지 않는다.

**코드**
- TypeScript, Node.js. SSO 모듈은 KLMS와 분리하고, 사이트별 코드는 어댑터로 둔다. 셀렉터는 어댑터 파일 한 곳에 모은다.
- 파싱에 실패하면 조용히 넘어가지 않고, 무엇이 어디서 깨졌는지 명확한 오류를 낸다.
- 비밀값과 개인정보(쿠키, 토큰, 이름, 학번, 성적, HTML 샘플)를 저장소, 로그, 문서에 넣지 않는다. 커밋 전에 확인한다.
- 파서 테스트는 `%LOCALAPPDATA%\kaist-cli\samples\`의 샘플을 읽는다(저장소에 넣지 않음). 개인정보 없는 단위 테스트만 저장소에 둔다.

**멈추고 사용자에게 알릴 상황**
- 로그인이 막히거나 캡차, 차단 문구가 뜬다
- 요청이 차단되거나 평소와 다른 오류가 반복된다
- 불변식 검사가 실패한다
- 확정된 결정을 바꿔야 할 이유가 생긴다. 이때는 임의로 바꾸지 않고 근거와 선택지를 설명한 뒤 사용자의 결정을 받는다

## KLMS 특이사항 (자주 틀리는 것)

- 과목 페이지는 `course/view.php?id=X&section=0`이어야 전체 주차가 나온다.
- 캘린더 이벤트의 `instance`는 과제 ID가 아니라 **cmid**다.
- 공지/게시판은 표준 forum이 아니라 `mod_courseboard`이고 API가 없다. 수정 시각도 없다.
- HTML의 `downloadFile(...)` 안 따옴표는 `&#039;`로 이스케이프되어 있다. HTML 파서로 읽는다.
- 날짜는 Asia/Seoul 고정이고, "오전 12:00"은 00:00이다.
- `core_course_get_updates_since`(since=0)는 courseboard를 돌려주지 않고, 종료된 간편설문(choice)도 빠질 수 있다. 불변식 1은 이를 반영했다(`src/sync/invariants.ts`).
- 과제 페이지에는 제출 파일 링크(학번·이름 포함)가 함께 있다. 과제 첨부는 `mod_assign/introattachment` 링크만 쓴다.
- 캘린더는 `courseid: 1`(사이트 전체) 월별 조회로 모든 과목 마감이 한 번에 온다.
- 과제 페이지나 게시글을 GET하면 KLMS에 조회 기록이 남는다. 그래서 사용자 결정에 따라 과제 페이지는 새 과제, 변경 알림이 온 과제, 마감 전 미제출 과제만 열고, 게시글은 새 글만 한 번 연다.
