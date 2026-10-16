# 프로그램화 설계 (feature/app)

상태: 설계 중 (2026-10-16 시작). 완결 전까지 `feature/app` 브랜치에만 커밋한다. `main`의 CLAUDE.md는 완결 때 고친다.

## 목표 (사용자 요청, 2026-10-16)

- 학교 계정 ID·비밀번호를 입력받아 프로그램이 직접 로그인하고, 2단계 인증(폰 승인)이 필요하면 기다렸다가 이어서 진행한다.
- 이후 자동으로 최신화(sync)하고 드라이브에 저장한다.
- 사용자 본인뿐 아니라 다른 사람도 쉽게 쓸 수 있어야 한다.
- AI는 적당한 오픈소스 모델을 프로그램에 붙여, 프로그램 자체로 동작하게 한다(외부 에이전트 없이).

## 기존 확정 규칙과의 관계

| 규칙 (CLAUDE.md / handoff) | 이번 작업 |
|---|---|
| 비밀번호를 묻거나 저장하거나 자동 입력하지 않는다 | **유지** (결정 1). 간편 로그인은 아이디만 쓴다 |
| 개인 Windows PC에서만 쓴다 | **변경 예정** (대상·배포 결정 뒤) |
| 2단계 인증을 우회하지 않는다 | 유지. 폰 승인은 사용자가 한다 |
| 읽기만 한다 (제출·글쓰기·설정 변경 없음) | 유지 |
| 받은 자료는 개인 학습용, 공유 기능 없음 | 유지. 각 사용자는 자기 계정·자기 드라이브만 쓴다 |
| 요청 간격·동시 2개 이하, WS 토큰 금지 | 유지 |

## 결정 (2026-10-16)

1. **로그인: 간편 로그인(아이디만).** 프로그램이 SSO 간편 로그인 탭에 아이디만 채우고, 사용자가 폰으로 승인하면 KLMS·ERP·생활관으로 연쇄 로그인한다. 비밀번호는 받지도·저장하지도·입력하지도 않는다.
   - 근거: KAIST 정보보안지침 제75조①7호가 "자동 비밀번호 입력기능"을 금지한다. 처음 사용자가 고른 "비밀번호 직접 입력"은 조사로 이 조항을 확인한 뒤 철회했다(2026-10-16). 간편 로그인은 같은 목표(프로그램 주도 로그인 + OTP 대기)를 조항 충돌 없이 이룬다.
   - 간편 로그인 경로(옛 프로필 캐시 기준, 추정 포함): `sso.kaist.ac.kr` `#login_id_mfa` + `#loginTab01 a.btn_login` → `login/init` → `mfa/init` → `login2Factor`(검증 번호 `.auth_number`, 3분 카운트다운, 페이지가 3초마다 폴링) → `check/policy` → `device/view`(매번) → `login/link` → 포털. 승인까지 약 9~14초.
2. **아이디 저장:** 사용자 선택, 기본은 저장하지 않음. 켜면 다음부터 아이디 자동 채움 + 폰 승인만으로 로그인. 아이디는 비밀값이 아니므로 평문 설정에 둬도 되지만, 개인정보라 OS 자격 증명 저장소에 둘지는 구현 때 정한다.
3. **화면 자동 넘김 + 실패 감지.** 사용자는 폰 2단계 인증 승인만 한다. 프로그램이 나머지 화면을 넘긴다(실측 선택자):
   - 포털 첫 화면 `#btn-sso-login` 클릭 → SSO.
   - SSO 간편 로그인: `#login_id_mfa`에 아이디 입력 + `#loginTab01 a.btn_login` 클릭(아이디 있을 때만).
   - 기기 등록 `device/view`: **`등록 안함`** 클릭(결정 변경 2026-10-16: 이전엔 "등록을 자동으로 누르지 않음"이었으나 사용자 요청으로 자동 진행. 매번 새 컨텍스트라 등록은 저장되지 않아 2단계 인증은 유지되고, 임시 기기를 서버에 쌓지 않으려 '등록 안함'을 누른다).
   - KLMS `login/ssologin.php`: `로그인` 이미지가 든 `<a>`(href에 `agt_url=`) 클릭. ERP·생활관은 SSO로 자동 처리되어 클릭 불필요(실측).
   - 각 클릭은 `dataset.kaistClicked`로 중복 방지. 실패 감지: 정상 로그인엔 alert가 없다. `page.on('dialog')`로 alert를 잡아 분류(잠금 `EAU005~007`, 거절 `ESY023`, 차단 `ESY021/022`, 중복 `SS0007`, 불일치 `ESY024`, 시간 초과 `E004`, 아이디 오류 `EAU001`)해 멈춘다(자동 재시도 없음). 2단계 인증 시간 초과 alert를 실제로 잡아 멈춤을 실측 확인.

4. **내장 AI 역할:** 수집 보조(공지에서 일정 추출·분류, 요약 생성) + 질문 응답(로컬 파일을 근거로 "이번 주 할 일", "이 과제 뭔지" 같은 질문에 답하는 대화창). 수식·코드 풀이 같은 고난도 작업은 범위 밖.
5. **프로그램 형태:** Electron 기반 트레이 상주 데스크톱 앱(설치 프로그램). 첫 실행 설정 마법사(계정·구글·드라이브 폴더·AI 모델 다운로드), 로그인 창은 앱 안 창, 자동 sync는 앱이 돌림, 대화창 포함. Playwright는 Electron으로 대체한다.
6. **대상·배포:** KAIST 구성원 중 지인에게 설치 파일 직접 공유(소수). 구글 미인증 앱 100명 한도 안, 코드 서명 없이 안내로 넘어갈 수 있는 규모. 나중에 공개로 넓힐 여지는 둔다.
7. **구글 연동: 공유 앱 1개, 각자 동의.** 지금 프로덕션 앱 하나를 모두 쓴다. 캘린더·Gmail 둘 다 유지(기능 제외 없음). 각 사용자가 "확인되지 않은 앱" 경고를 넘겨 자기 계정으로 동의한다. 검증은 안 받는다.
   - 제약: 평생 100명 상한(초기화 불가). 지인 소수면 충분, 공개로 넓히면 그때 검증.
   - **확인 필요:** `gmail.readonly`는 제한 범위라, 데스크톱+미인증 조합에서 다른 계정이 "앱 차단"으로 막힌 일화가 있다(2026-10-05 포럼). 다른 구글 계정으로 Gmail이 되는지 시험해 확인한다. 막히면 그 사용자만 "자기 OAuth 클라이언트" 방식으로 전환(rclone식, 첫 설정 15~30분, 설정 마법사로 안내).
   - 코드: 캘린더를 기본으로 승인하고 Gmail은 켤 때만 따로 승인하도록 범위를 나눈다(지금 `src/google/oauth.ts`는 한 번에 요청). 배포용 client secret은 공개 저장소에 커밋하지 않는다.
   - `calendar.app.created` 등급은 미확인(2026-10-16 콘솔 데이터 액세스 화면의 세 구간이 모두 비어 있음 = 콘센트 화면에 범위를 추가하지 않은 상태. 데스크톱 앱은 실행 시 요청만으로 동작). 등급은 "범위 추가"로 검색하면 배지로 보이지만, Gmail 제한 범위가 더 센 제약이라 지금 확인은 보류. 핵심 확인은 둘째 계정으로 Gmail 미인증 동작 시험(구현 중).

8. **내장 AI: 로컬 기본 + 자기 키로 교체 가능.**
   - 기본은 완전 오프라인 로컬 모델. 대화 응답·요약, 그리고 일정 후보의 인용·종류·날짜 원문만 뽑는다. 날짜 계산·중복 판정·검사(원문 대조·요일·학기 범위)·A/B 등급은 코드가 한다. 로컬 추출 후보는 A등급(자동 등록) 조건을 좁혀, 애매하면 사용자 확인으로 돌린다.
   - 런타임 node-llama-cpp(JSON 스키마 강제). 모델 기본값은 하드웨어 감지로 자동 선택: CPU 16GB→Qwen3.5-4B Q4, 8GB→2B/Mi:dm Mini, GPU 8GB→9B, 12GB→Gemma 4 12B QAT. 배포 가능 라이선스(Apache/MIT)만. EXAONE·Kanana 제외.
   - CPU만이면 건당 수십 초라, 로컬 모델의 수집 보조는 07:00 배치에 붙이고 대화창은 응답이 느릴 수 있음을 알린다.
   - **AI 공급자 추상화:** 설정에서 사용자가 자기 API 키를 넣어 다른 모델(OpenAI 호환 엔드포인트, 자기 서버 등)을 붙일 수 있게 인터페이스를 둔다. 키를 넣으면 추출·대화에 그 모델을 쓴다(정확도↑, 대신 그 사용자의 선택으로 외부 전송). 기본은 로컬.
   - **ChatGPT 플랜 로그인(2026-10-16 결정, v1.2.0):** 사용자 요청 "Codex·Claude 데스크톱처럼 계정 로그인으로". 조사 결과 OpenAI는 공식 "Sign in with ChatGPT"(developers.openai.com/siwc, 오픈소스·로컬 앱은 동적 client 등록으로 사전 승인 없이 Plus/Pro 플랜 사용 가능)가 있어 채택. 규칙: 콜백 `http://127.0.0.1:<port>/auth/callback`(localhost 금지), Responses API만(`backend-api` 금지), `store:false`·`stream:true`, temperature·max_output_tokens 등 불가. 오픈소스 조건을 위해 MIT LICENSE 추가. **Anthropic은 제3자 앱의 Claude.ai 로그인·Pro/Max 자격 경유를 약관으로 명시 금지(2026-01 서버 차단, 2026-02 명문화)** → Claude는 API 키만(Max/Team의 월 API 크레딧 안내). Codex CLI·Claude Code의 client ID 재사용은 하지 않는다.
   - 모델 확정 전, S6 학사 일정 후보 47건과 처리 결과를 정답으로 두고 후보 모델을 비교 평가한다. 핵심 지표: 잘못 자동 등록된 A등급 0건.

9. **Electron 구조 (electron-port 조사, 실측 포함):**
   - 타깃 Electron 44.x(Node 24, `node:sqlite` 그대로). 8주마다 올려야 하므로 올릴 때 스모크 테스트.
   - `src/`는 코어로 유지, Playwright 의존(browser-login·pdf·Cookie/Page 타입)을 포트 인터페이스 뒤로 옮긴다. CLI는 Playwright 어댑터, 앱은 Electron 어댑터. 둘이 `%LOCALAPPDATA%\kaist-cli`와 `sync.lock`을 공유.
   - 프로세스: main(창·로그인·PDF·트레이) + utilityProcess로 sync/DB, LLM 분리.
   - 로그인: 메모리 전용 partition BrowserWindow, UA에서 `Electron/...` 제거, spellcheck 끄기, 끝나면 `clearData()`. 쿠키는 `session.cookies.get`으로 추출(HttpOnly 포함 실측). 구글 OAuth는 임베디드 창에서 막혀 loopback 유지.
   - PDF: 숨은 창 `printToPDF`(한글·A4 실측). `window-all-closed`로 종료 방지.
   - 트레이: 단일 인스턴스 잠금, `setLoginItemSettings(--hidden)`, 벽시계 스케줄러 + `powerMonitor` resume 보충, AUMID+바로가기로 알림.
   - 비밀번호 저장(아이디 저장도) 켜면 `safeStorage`(DPAPI). 끄면 메모리에만.
   - 설치: electron-builder NSIS 사용자별, 약 125~150MB(모델 제외), 모델은 첫 실행 다운로드. 코드 서명은 배포 때 결정(무서명+안내 / OV 연 $150~300).

## 구현 계획 (feature/app, 단계별)

각 단계 끝에서 완료 기준을 실행해 확인하고 사용자에게 보고한 뒤 멈춘다. 기존 CLI는 매 단계 그대로 동작해야 한다.

- **A. 코어 분리 (안전·오프라인):** `src/`의 Playwright 의존(로그인·PDF·쿠키/Page 타입)을 포트 인터페이스 뒤로 옮기고, 지금 동작을 그대로 하는 Playwright 어댑터를 둔다. 새 기능 없음. 완료 기준: 테스트 70개 통과, CLI 동작 동일.
- **B. 간편 로그인 + 실패 감지 — 완료 (2026-10-16):**
  - 라이브 확인: SSO 선택자(`#login_id_mfa`, `#loginTab01 a.btn_login`), 2FA(`.auth_number`, `strong#countdown`), 정상 로그인에 alert 없음을 실제 페이지로 확인(값은 읽지 않음).
  - `kaist login --save-id`로 1차에 사용자가 입력한 아이디를 캡처·저장(`account.json`, 평문, LOCALAPPDATA), 이후 `kaist login`에서 **폰 승인만으로** 4개 사이트 로그인(실측: 포털 버튼·아이디 입력·로그인·기기 등록·KLMS 버튼 모두 자동). `--forget-id`로 삭제.
  - 실패 감지: `page.on('dialog')`로 alert를 잡아 분류해 멈춘다. 2단계 인증 시간 초과 alert를 실제로 잡아 "시간이 초과되었습니다"로 멈춤을 실측. 다른 실패(잠금·거절 등)는 계정 잠금 위험 때문에 일부러 유발하진 않았다.
  - 구현: 포트에 `prepare`(매 대기 회 화면 넘김)/`captureId` 훅, 드라이버에 자동 입력·dialog 감시·`KAIST_LOGIN_DEBUG`, `sso/account.ts`(아이디 저장, 기본 꺼짐), `loginAll({fillId, saveId})`, 모든 단계에 `advanceLogin`.
  - 비고: portal-design §7 "로그인 창에서 CLI는 이동만, 폼 조작·클릭 안 함"을 완화(아이디·포털·기기 등록·KLMS 버튼까지 프로그램이 누름). 비밀번호·폰 승인은 그대로 사용자. 병합 때 CLAUDE.md·portal-design 반영.
  - **창 숨김 + 앱 화면 (2026-10-16 사용자 요청, 실측):** 자동 넘김이 되므로 브라우저를 숨기고(CLI headless, Electron은 `show:false`) 사용자에겐 ① 폰 승인 요청+인증 번호 ② 로그인 중 ③ 완료/실패만 보인다. 2단계 인증 번호는 `.auth_number`에서 뽑아 `describe`로 올린다(두 번 나오면 중복 제거→2자리). 실측: `kaist login`이 창 없이 폰 승인만으로 4개 사이트 로그인. `--show-browser`로 창 표시(아이디 미저장 시 자동).
- **C. Electron 껍데기 — 완료 (2026-10-16):**
  - C1 트레이 앱 껍데기(창·트레이·단일 인스턴스). preload는 CJS여야 함(ESM이면 "Cannot use import" → `.cjs`). main은 ESM 가능(Electron 44).
  - C2 앱 안 로그인: `app/electron-login.ts` 숨긴 BrowserWindow(메모리 partition)에서 로그인. `executeJavaScript`로 포트 evaluate 구현(함수 직렬화), `login-preload.cjs`가 alert 가로채 실패 감지, `session.cookies`로 쿠키. 렌더러 세 화면(폰 승인·번호/로그인 중/완료). 실측: 창 없이 폰 승인만으로 4개 사이트 로그인.
  - C3 앱 동기화: sync IPC(runSync), 드라이브 저장, PDF는 `electron-pdf.ts` printToPDF(실측 `_요약.pdf` 재생성). 트레이 "지금 동기화". CSS·md→HTML은 `src/files/pdf-html.ts`로 공유.
  - Windows 토스트 알림: 동작 확인(개발 상태에서도 `isSupported=true`, show 이벤트, 화면에 토스트 뜸 — 실측). 포장(F단계) 시 앱 아이콘·이름이 제대로 붙는다.
  - 구조: `tsconfig.electron.json`(src+app→dist-electron), `build:app`/`app` 스크립트. Playwright 미로드(앱은 Electron 어댑터만).
- **D. 설정 마법사 — 완료 (2026-10-16):**
  - 설정이 덜 됐으면(아이디 미저장 또는 구글 토큰 없음) 시작 시 마법사. 3단계: ① 학교 계정(로그인 창 보이고 아이디 저장) ② 드라이브 폴더(폴더 대화상자 → config.json) ③ 구글 승인(캘린더 기본, Gmail 체크박스). AI 모델은 E단계 자리만.
  - 구글 OAuth 범위 분리(결정 7): `googleLogin(onStatus, {gmail})`. CLI는 `{gmail:true}`. `config.saveSettings`, main에 `setup:state`/`drive:pick`/`google:login` IPC, `login({saveId,show})`.
  - 실측: 마법사 3단계·배지·드라이브 폴더 선택 동작(시작 화면 "설정" 버튼으로 열어 확인). **완전 초기 상태(계정·구글 둘 다 없음)에서 처음부터 하는 흐름은 기존 인증을 깨지 않으려 미실측** — 자동 표시 로직·show:true 로그인·범위 분리는 코드에 있음.
- **E. 로컬 LLM — 완료 (2026-10-16):**
  - E1 공급자 추상화: `src/ai/`(provider·local·openai·context). 로컬은 node-llama-cpp(동적 import, **Vulkan**이 Intel GPU로 자동 선택돼 추론 0.7~3.7s), JSON은 `createGrammarForJsonSchema`로 강제. 자기 API 키 넣으면 OpenAI 호환(결정 8). 모델 `%LOCALAPPDATA%\kaist-cli\models`, 기본 Qwen2.5-3B Q4.
  - E2 대화: `kaist ask <질문>` + 앱 대화창. 드라이브 `_요약.md`를 컨텍스트로(6500자 제한, 창 8192). 실측: "이번 주 과제" 등에 로컬 자료 근거로 답. node-llama-cpp가 Electron 안에서도 로드됨. 소형 모델 한계로 복잡한 추론은 가끔 틀림(자기 키로 상위 모델).
  - E3 추출 평가: 후보 81건(실제 12/아님 68)을 로컬 모델로 추출→verifyEvent 채점. 원시 2건이 잘못 A → **결정 8 게이트(로컬 제안은 자동 A 금지, 전부 B=사용자 확인) 적용 시 잘못 자동 등록 A = 0**(실측). 실제 일정 8~9/12 제안. `scripts/phase0/e3-extract-eval.ts`.
  - 미결: 로컬 모델 추출을 sync에 자동 연결하는 것은 아직(현재는 평가로 규칙만 확인). 하드웨어별 모델 자동 선택은 기본 3B 고정으로 대체(설정 aiModelUri로 변경).
- **F. 패키징·배포:** NSIS 설치 파일, 첫 실행 모델 다운로드, 둘째 계정 Gmail 미인증 시험, 서명 결정, 지인 1명 설치. 완료 기준: 지인이 설치해 사용.

## 조사 (Opus, 2026-10-16 완료) — `docs/research/`

- `login-flow.md`: 간편 로그인 경로, 실패 코드, 비밀번호 자동 입력 금지 조항
- `local-llm.md`: node-llama-cpp, Qwen3.5/Gemma4, 하드웨어 티어, 정확도 위험
- `google-oauth-distribution.md`: gmail.readonly 제한 범위, 100명 상한, 검증 비용
- `electron-port.md`: Electron 44 실측, 앱 안 로그인 창·PDF·트레이·서명

## 위험 (지금까지 파악한 것)

- 다른 사람의 학교 계정 자격 증명을 다루는 책임. 저장은 기본 꺼짐, 켜도 OS 자격 증명 저장소만 쓴다.
- 로그인 시도 빈도와 계정 잠금. 자동 재시도는 1회 이하, 캡차·잠금 화면이면 멈추고 사용자에게 알린다.
- 학교의 자동화 접근 정책. 사용자가 늘면 눈에 띌 수 있다.
- 소형 로컬 모델은 한국어 날짜 추출·요약 품질이 Claude보다 많이 낮다. 기존 검증 규칙(원문 대조·요일·학기 범위, A/B 등급)으로 보완한다.
