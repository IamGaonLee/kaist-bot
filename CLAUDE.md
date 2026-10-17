# KAISTBOT — `kaist` CLI + 데스크톱 앱

KAIST KLMS(Moodle 3.9 커스텀)의 과제, 공지, 강의자료를 수집합니다. 수집한 것은 구글 드라이브 폴더와 전용 구글 캘린더 "KLMS"에 정리합니다. Windows용 TypeScript 프로그램이고, 두 가지 형태가 같은 코어(`src/`)를 씁니다: (1) `kaist` CLI — Claude Code가 도구로 써서 학교생활을 논의한다, (2) **Electron 데스크톱 앱(`app/`)** — 지인에게 배포하는 트레이 앱(설정 마법사·숨김 로그인·동기화·대화창·내장 AI). 저장소: https://github.com/IamGaonLee/kaist-bot

## 현재 단계

- S0 완료 (설계 문서 v0.2, CLAUDE.md, 2026-10-14 승인)
- S1 완료: 인증과 과목 목록
- S2 완료 (2026-10-14): `sync`(과목 구성·과제·공지), `assignments`, `notices`, `videos`, `doctor`. 사용자 대조 완료(과제 3개 일치)
- S3 완료 (2026-10-14): 파일 다운로드(105개), 드라이브 폴더, 요약 md/PDF, 과제 `설명.md`, `files`. 휴대폰 확인 완료
- S4 완료 (2026-10-14): 구글 "KLMS" 캘린더 마감 15개 + 시험 8건(수동). OAuth 앱은 2026-10-14에 게시(프로덕션)해 7일 만료가 없다. 휴대폰 확인 완료
- S5 완료 (2026-10-14): 에이전트용 출력 다듬기(`changes`, 과제 경로·남은 시간, 신선도), 수강 취소 과목 처리. 대화 시나리오 4개는 사용자가 생략하고 넘어감(실사용 중 확인)
- S6 완료 (2026-10-14): 학사 일정 추출 `kaist events` (후보·검사·A/B등급·undo), 기존 시험 8건 이전, 첫 처리로 휴강·퀴즈·발표·온라인 13건 추가(A 1건 자동, B 12건 확인), `kaist summary`
- S7 완료 (2026-10-14): 학교 메일 (Dooray→Gmail 자동 전달, `gmail.readonly`). 8/31 이후 368통 저장, 후보 규칙(인용 잘라내기·중복 합치기·옛 과목번호 별칭). `docs/mail-design.md`
- S8a 완료 (2026-10-15): `kaist login` 한 번(폰 승인 1회)으로 포털→KLMS·ERP·생활관 연쇄 로그인, `session.json` v2(사이트별 쿠키, SSO 쿠키 제외), `status --check` 사이트 4개, 허용 목록 HTTP 계층(`src/sites/`). 설계 `docs/portal-design.md`
- S8b 완료 (2026-10-15): sync가 포털 시간표·학사일정, 생활관 배정 정보를 받는다. 학사 주요 일정 15건 캘린더 자동 등록(색 10, `[학사]`), 휴강·온라인 시각은 시간표 기준(그날 수업 1개일 때만)
- S8c 완료 (2026-10-15): 포털 학사 공지(수강/학적·장학/복지·생활관 본문, 세미나 제목만) 증분 수집, `notices --source portal`, 드라이브 `_학교공지.md`(제목 목록). 연속 sync 중복 0
- S8d 완료 (2026-10-15): `kaist grades [--refresh]`. ERP는 `--refresh`일 때만 접속(sync는 접속 안 함), 로컬 DB에만 저장, 격리 테스트 통과. 누적 평점은 계산값(`computed: true`)
- **데스크톱 앱 A~F 완료 (2026-10-16, feature/app→main, v1.0.0 릴리스). 설계·결정·실측은 `docs/app-design.md`, 배포는 `docs/publish.md`:**
  - A: 코어에서 Playwright 분리 — 로그인·PDF를 포트(`src/sso/browser-login.ts`, `src/files/pdf.ts`)로 두고 어댑터로. CLI는 `src/platform.ts`(Playwright), 앱은 `app/platform-electron.ts`(Electron).
  - B: **간편 로그인(아이디만)** — SSO 간편 로그인 탭에 아이디만 채우고 폰 승인(비밀번호는 안 받음·안 저장, KAIST 정보보안지침 제75조①7호 준수). 프로그램이 화면(포털·SSO·기기 등록 '등록 안함'·KLMS 로그인)을 자동으로 넘기고, 창을 숨겨(headless) 2단계 인증 번호만 보여준다. 실패는 alert로 분류(`src/sso/login-dialog.ts`). 아이디 저장은 선택(`src/sso/account.ts`, `--save-id`/`--forget-id`, 기본 꺼짐). `--show-browser`로 창 표시.
  - C: Electron 트레이 앱(`app/`) — 숨긴 BrowserWindow 로그인(세 화면), 동기화→드라이브 저장, `printToPDF`, 트레이, Windows 알림. preload는 CJS(`.cjs`).
  - D: 첫 실행 설정 마법사 — 계정·드라이브 폴더·구글(범위 분리: 캘린더 기본/Gmail 선택)·AI 모델.
  - E: 내장 AI(`src/ai/`) — 로컬 node-llama-cpp(Vulkan, 기본 Qwen2.5-3B Q4), `kaist ask`·앱 대화창(드라이브 자료 근거), 자기 API 키로 GPT·Claude·Gemini(OpenAI 호환). 일정 추출은 verifyEvent로 채점하되 로컬 제안은 자동 A 금지(전부 사용자 확인) → 잘못 자동 등록 0.
  - F: 홈페이지·설명서(`site/`, GitHub Pages), electron-builder NSIS(`npm run dist`, 로컬은 개발자 모드 필요), CI(`.github/workflows/` release·pages).
- **v1.1.0 (2026-10-16, feature/ai-events→main):** AI 일정 제안(`kaist suggest`, 앱 "일정" 건별 승인·거절·취소), 앱 UI 개편(사이드바 레이아웃 1100×720, 홈 대시보드 `home:state`, 로그인 오버레이), 새 버전 감지(`app/update-check.ts`, GitHub 릴리스 latest, 자동 설치 없음), 질문 화면 모델·노력 선택(`aiUseExternal`·`aiEffort`), 외부 AI 호환층 400 자동 보정(`src/ai/openai.ts`, 프리셋 gpt-6-luna·claude-haiku-5-5·gemini-2.5-flash-lite), 설명서 외부 AI·팁 절, 모바일 검토 `docs/mobile-feasibility.md`(권고: 지금은 안 만듦)
- **v1.2.0 (2026-10-16, feature/chatgpt-login→main):** Continue with ChatGPT — OpenAI 공식 "Sign in with ChatGPT"(오픈소스·로컬 앱용 플랜 사용)로 API 키 없이 Plus/Pro 플랜으로 내장 AI 사용. `src/ai/chatgpt-auth.ts`(PKCE+127.0.0.1 루프백 `/auth/callback`, 동적 client 등록, 회전 refresh), `src/ai/chatgpt.ts`(Responses API 스트리밍, store:false, 한도 오류 매핑), 설정 `aiSource`(local|key|chatgpt)·`aiChatgptModel`, CLI `kaist chatgpt login|status|logout`, 앱 설정 카드·질문 드롭다운. **Claude는 약관(code.claude.com legal-and-compliance)이 제3자 앱 계정 로그인을 금지해 API 키만**. MIT LICENSE 추가(오픈소스 조건). 설정 화면은 마법사(이전/다음) 대신 전부 펼침. 구글 드라이브 데스크톱 없이도 동작(설정 "PC 폴더 쓰기", `summary` DRIVE_MISSING). 버그 수정: `loadSettings`가 driveRoot만 돌려줘 v1.0.0~1.1.0에서 AI 키·모델·노력 설정이 무시되던 문제. 실측: 사용자 ChatGPT 계정으로 로그인·호출 성공(모델 gpt-6.1-sol 등 7개), host id는 `urn:uuid:` 형식이어야 함.
- **v1.2.1 (2026-10-17, fix/google-client→main):** 다른 PC에서 "구글 승인"이 안 되던 문제 수정. 설치 파일에 구글 OAuth 클라이언트가 없었다(개발 PC의 `%LOCALAPPDATA%\kaist-cli\google-client.json`만 읽음). 공유 클라이언트는 GitHub 저장소 시크릿 `GOOGLE_OAUTH_CLIENT_JSON`(저장소 커밋은 푸시 보호가 거부) → release CI가 `app/google-client.json`(.gitignore)으로 쓰고 build:app이 `dist-electron/google-client.json`으로 복사(개발 PC는 `%LOCALAPPDATA%` 파일로 대체), `app/main.ts`가 번들 경로 등록(`setBundledGoogleClientFile`). 탐색 순서 사용자 파일 → `KAIST_GOOGLE_CLIENT` → 번들. 클라이언트 없는 빌드는 설정 화면이 버튼을 막고 안내, release CI가 시크릿 없으면 중단·app.asar 포함 여부 검사. 상세 `docs/publish.md` 5절.
- 다음: 미정 (카카오톡 연결·웹 서버 방식·모바일 앱은 보류)

## 에이전트로 쓸 때 (학교생활 논의)

사용자가 과제, 마감, 공지, 강의자료를 물으면 `kaist` CLI를 도구로 쓴다. 항상 `--json`을 붙여 결과를 읽는다.

- **조회는 로컬 데이터로 먼저 답한다.** 모든 조회 JSON에 `lastSyncKst`와 `lastSyncMinutesAgo`가 있다. 데이터가 얼마나 오래됐는지 함께 알린다.
  - "새로 올라온 거": 먼저 `kaist changes --json`(마지막 sync의 변경, `--runs 3`으로 여러 회)을 본다. 오래됐으면 sync를 제안한다.
  - 마감·제출 상태: `kaist assignments --json` (`--due 7d`, `--all`, `--course <코드|이름>`). 각 과제에 `hoursLeft`, `submission`(submitted/noattempt 등), `descriptionFile`(설명.md), `attachments[].localPath`가 있다.
  - 시험·휴강·온라인·보강: `kaist events list --json` (기본 오늘 이후). "(계획서 기준)"은 학기 초 강의계획서라 바뀌었을 수 있다.
- **sync 뒤 학사 일정 후보 처리** (`docs/school-events-design.md`, sync 결과의 `candidates.newCandidates > 0`일 때):
  1. `kaist events candidates --json`을 읽고 후보마다 판단한다. 이미 등록된 일정과 같거나, 지났거나, 일정이 아니면 `kaist events dismiss <id...> --reason "..."`로 닫는다.
  2. 일정이면 `kaist events add --course <코드> --kind exam|no_class|online|makeup --date YYYY-MM-DD [--start HH:MM --end HH:MM --location ... --title 중간고사] --from-candidate <id> --quote "<snippet에서 그대로 복사>" --dry-run`으로 등급을 본다. 연도는 학기 범위로, 상대 표현("다음 주")은 글 게시일 기준으로 푼다.
  3. **A등급은 묻지 않고 등록한다**(사용자 결정: 처음부터 자동). 등록한 뒤 "자동 등록 N건 (되돌리기: `kaist events undo --last`)"를 알린다.
  4. **B등급(종료 코드 4, NEEDS_CONFIRMATION)은 사용자에게 보여주고 확인받은 뒤** `--confirmed`를 붙여 등록한다. 변경·취소는 `kaist events update <id> ... --confirmed`(취소는 `--cancel`)를 쓴다.
  5. 인용(`--quote`)은 원문에 있는 문장만 쓴다. 검사가 원문 대조, 요일, 학기 범위를 확인한다. 실패하면 값을 고치거나 사용자에게 묻는다.
  - 규칙을 고친 뒤에는 `kaist events rescan`으로 처리하지 않은 후보만 다시 뽑는다(로컬). 드라이브 요약만 다시 만들 때는 `kaist summary`를 쓴다.
  - 공지: `kaist notices --since 3d --json` (본문이 필요하면 `--body`). 학교(포털) 공지는 `--source portal [--board 장학]`. 포털 공지는 과목 매핑이 없어 학사 일정 후보로 쓰지 않는다
  - 강의자료: `kaist files --json` (`--new`는 마지막 sync에서 받은 것), 영상 링크: `kaist videos --json`
  - 시간표: `kaist timetable --json` (포털, 정규 수업은 캘린더에 넣지 않음). 학사일정: `kaist school --json`(주요 일정, `--all` 전체). 생활관: `kaist dorm --json`(호실 포함, 드라이브·다른 곳에 옮기지 않는다)
  - 학사·생활관 자동 등록 되돌리기: `kaist school undo`(대상만) → `--yes`
  - 성적: `kaist grades --json`(로컬). **사용자가 물을 때만** 조회하고 먼저 꺼내지 않는다. 결과를 파일·캘린더·드라이브·메모리 어디에도 쓰지 않고, `fetchedAt`(받은 시각)을 함께 말한다. 최신이 필요하면 사용자에게 알리고 `kaist grades --refresh --json`(ERP 접속, 만료면 로그인 창). 누적 평점은 계산값이라 "공식값은 ERP"라고 덧붙인다
  - 캘린더: `kaist cal list --json`
  - 학교 메일: `kaist mail list --academic --json`(과목 매핑·나에게 직접 온 메일, 본문 제외), 본문은 `kaist mail show <id> --json`. 옛 과목 번호는 `kaist mail alias ME361 ME.30061`. 대화 중 즉석 조회에는 Gmail 커넥터를 써도 되지만, **학사 일정 등록 근거는 `kaist events candidates`의 메일 후보만** 쓴다(원문 검증 사슬 유지)
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
- 앱: `npm run build:app`(dist-electron/), `npm run app`(실행), `npm run dist`(설치 파일; 로컬 Windows는 개발자 모드 필요, 보통 CI로 빌드). 앱 코드는 `app/`(main.ts·preload.cjs·login-preload.cjs·electron-login.ts·electron-pdf.ts·platform-electron.ts·renderer/). 코어는 포트만 쓰고 플랫폼 어댑터에서만 Playwright/Electron을 연결한다(`src/platform.ts` vs `app/platform-electron.ts`).
- 코드 배치: `src/sso/`(로그인 포트 `browser-login.ts`+Playwright 어댑터, 실패 분류 `login-dialog.ts`, 아이디 저장 `account.ts`), `src/sites/`(포털·ERP·kds 허용 목록 `sites.ts`, HTTP, 프로브, 연쇄 로그인 `session.ts`), `src/klms/`(site.ts 상수·판별, http.ts, ajax.ts, session.ts, courses.ts), `src/ai/`(공급자·로컬 node-llama-cpp·외부 키·모델 카탈로그·대화 컨텍스트), `src/files/`(pdf 포트+어댑터), `src/store/`(로컬 데이터)
- 종료 코드: 0 성공, 1 오류, 2 세션 만료(`--no-login`), 3 로그인 취소, 4 사용자 확인 필요(B등급, 삭제·되돌리기 미리보기)
- 명령 (모두 `--json` 지원):
  - `kaist login [--force] [--only klms|portal|erp|kds] [--save-id] [--forget-id] [--show-browser]`: 간편 로그인(아이디만, 폰 승인). 저장된 아이디가 있으면 창을 숨기고 2단계 인증 번호만 보여준다. `--save-id`로 아이디 저장(기본 꺼짐). `kaist status [--check]`(사이트별 유효/만료), `kaist courses [--refresh] [--no-login]`
  - `kaist sync [--course X] [--no-login] [--no-portal]`: KLMS 접속. 이어서 포털·생활관(세션이 있을 때, 만료면 경고만). 과목 페이지, updates_since, 캘린더(사이트 전체 월별), 과제 페이지(새것·변경·마감 임박만), 게시판 새 글
  - `kaist timetable`, `kaist school [list|undo]`, `kaist dorm`: 로컬 DB만
  - `kaist grades [--refresh] [--no-login]`: 기본은 로컬, `--refresh`만 ERP 접속
  - `kaist assignments [--due 7d] [--all] [--course X]`, `kaist notices [--source klms|portal] [--board X] [--since 3d] [--kind notice|qna|board] [--body]`, `kaist videos`: 로컬 DB만
  - `kaist ask <질문> [--course X]`: 로컬 자료(드라이브 요약·과제·일정) 근거로 내장 AI가 답. `kaist ai <프롬프트>`: 자료 없이 그냥 AI. 공급자는 설정 `aiSource`(local 기본 / key=`aiApiKey` / chatgpt=`kaist chatgpt login`).
  - `kaist doctor [과목] [--offline]`: 불변식 검사 (DB 변경 없음)
  - `kaist sync`는 파일도 받는다 (`--no-files`로 생략). 첫 전체 다운로드는 `--confirm-download`로 한 번 승인(완료됨). `kaist files [--new]`
- 자동 sync: 작업 스케줄러 `KAIST daily sync`(매일 07:00, 놓치면 로그온 뒤 실행)가 `scripts/daily-sync.ps1`로 `sync --no-login`을 돌린다. 세션 만료·실패·새 변경은 Windows 알림, 요약 숫자만 `%LOCALAPPDATA%\kaist-cli\logs\daily-YYYYMM.log`. 등록·변경 `scripts/register-daily-sync.ps1 [-At HH:MM]`. ps1은 UTF-8 BOM으로 저장해야 한다(PS 5.1)
- 로컬 데이터: `%LOCALAPPDATA%\kaist-cli\kaist.db`(SQLite), `snapshots\`(최근 HTML 원문), `staging\`(다운로드 임시), `config.json`(선택: `driveRoot`)
- 드라이브: `G:\내 드라이브\KAIST\2026-가을\<코드> <과목명>\{강의자료\<주차>, 과제\<이름>, 게시판첨부\<날짜 제목>}`, 바뀐 파일의 이전 버전은 같은 폴더 `_이전버전\`. 요약은 `_요약.md`/`_과목정보.md`/`_학교메일.md`(Claude용)와 같은 이름의 `.pdf`(사람용, sync마다 재생성). 메일은 과목 메일→각 `_과목정보`, 나에게 온 메일(자동 알림 제외)→`_학교메일`, 학교 전체 메일은 제목만(사용자 결정)
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
- 2단계 인증을 우회하지 않는다(폰 승인은 사용자가 한다). **비밀번호는 묻거나 저장하거나 자동 입력하지 않는다** — 간편 로그인은 아이디만 채운다(KAIST 정보보안지침 제75조①7호). 로그인은 매번 새(메모리 전용) 브라우저 컨텍스트로 한다. 프로그램이 넘기는 화면은 로그인 진행용 버튼(포털 로그인·간편 로그인·기기 등록 '등록 안함'·KLMS 로그인)뿐이고, 비밀번호 입력란·2단계 인증은 건드리지 않는다.
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
