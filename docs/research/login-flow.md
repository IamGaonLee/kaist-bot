# 로그인 자동 입력 구조 분석 (읽기 전용 조사, 2026-10-16)

표기
- **[관찰-샘플]**: `%LOCALAPPDATA%\kaist-cli\samples\portal\rec\`의 기록(2026-10-14~15 포털 로그인 1회 기록)에서 직접 확인
- **[관찰-캐시]**: 0단계 V1 때 남은 브라우저 프로필 캐시(`%LOCALAPPDATA%\kaist-cli\profile\Default\Cache\Cache_Data`, 2026-10-13, KLMS 경유 로그인)에 저장된 SSO 페이지 HTML·JS를 읽어서 확인. 로그인 전 공개 페이지와 공개 JS다
- **[관찰-코드/문서]**: 저장소 코드·문서
- **[추정]**: 위 근거로 추론. 실제로 확인하지 않음

개인정보 처리: 폼 값, 쿠키, 토큰, 아이디, 인증 번호 값은 출력하거나 이 문서에 옮기지 않았다. 필드 이름, 경로, 상태 코드, 값의 모양(길이 구간·문자 종류), 프로토콜 결과 코드만 적었다. 네트워크 요청은 하지 않았다.

---

## 0. 핵심 발견 (먼저 읽을 것)

1. **SSO 로그인 화면에는 탭이 2개 있고, 기본 탭은 "간편 로그인"(아이디만 + 폰 푸시)이다.** [관찰-캐시] `li#mfa.on`(간편 로그인, 기본 표시)과 `li#auth`(ID/PW 로그인).
2. **기록된 포털 로그인은 간편 로그인 경로였다. 비밀번호를 보낸 요청이 없다.** [관찰-샘플+캐시 대조] 기록 순서 `login/init` → `twofactor/mfa/init` → `mfa/login2Factor`가 `loginProcMfa()` 코드 경로와 정확히 같다. ID/PW 경로의 `/auth/user/login/auth` 요청은 기록에 없다. V1 이동 기록(`v1-log.txt`)에도 ID/PW 경로의 2차 인증 화면(`login/second/view`)이 없다. [추정] 사용자는 평소 간편 로그인을 쓰고 있다. 설계 문서(`docs/kaist-agent-design.md:122` "아이디·비밀번호를 직접 입력")와 다르다.
3. **비밀번호는 브라우저에서 암호화된다** (ID/PW 탭). [관찰-캐시] `login.js`가 서버에서 받은 키·IV로 `{login_id, login_pwd, agt_id, linkUrl, device_cd}` JSON을 SEED-CBC(AnsiX923 패딩)로 암호화하고, hex로 바꿔 `user_data=` 하나로 보낸다. Playwright로 실제 페이지에 입력하면 페이지 JS가 암호화하므로 재구현할 필요가 없다.
4. **학교 규정과 확정 결정이 충돌한다.** 정보보안지침 **제75조①7호 "응용프로그램 등을 이용한 자동 비밀번호 입력기능을 사용하지 말 것"**(`docs/phase0-report.md:222`). 이 조항이 "비밀번호 자동 입력 금지" 결정의 근거로 문서 4곳과 CLAUDE.md에 적혀 있다(5.1절). **간편 로그인 탭에 아이디만 넣으면 비밀번호를 전혀 다루지 않고도 같은 사용 경험(프로그램이 입력, 사용자는 폰 승인)을 얻는다.**
5. **실패 상태 대부분은 `alert()`로 뜨는데, 지금 코드는 이것을 보지 못한다.** Playwright는 dialog 리스너가 없으면 alert를 자동으로 닫는다. `SUSPICIOUS` 정규식(`src/sso/browser-login.ts:42`)은 `body.innerText`만 보고, SSO 잠금 문구("접속이 차단되었습니다", "임시 차단되었습니다", "정상적인 접근 경로가 아닙니다")와도 맞지 않는다.

---

## 1. 포털 로그인 화면

### 1.1 기록된 전체 순서 [관찰-샘플] (`recording.jsonl`, 초는 기록 시작 기준)

| 시각 | 종류 | 요청 | 상태 | 본문 필드 (이름만) |
|---|---|---|---|---|
| 1.2 | document | GET `portal.kaist.ac.kr/` | 302 | |
| 1.3 | document | GET `/home` | 302 | |
| 1.5 | document | GET `/common/login/login.do` | 200 html | |
| 7.6~7.8 | xhr | POST `/wz/api/widget/kaistNews`, `researchNews` | 200 json | (로그인 전 위젯) |
| 52.6 | document | POST `sso.kaist.ac.kr/auth/user/login/link` | 302 | `user_id`(빈 값), `agt_id`, `agt_url`, `lang`, `form_type`, `add_param` (`6-req.txt`) |
| 52.6 | document | GET `/auth/kaist/user/login/view?agt_id&agt_url&user_id` | 200 html | |
| 57.7 | xhr | POST `/auth/user/login/init` | 200 json | 본문 없음. 응답 `flag`(true), `result_code`, `result_data`(hex, 128~255자) = 암호화 키+IV (`8-res.json`) |
| 57.8 | xhr | POST `/auth/twofactor/mfa/init` | 200 json | `user_data`(hex 128~255자, 암호화된 `{login_id, agt_id}`) (`9-req.txt`) |
| 57.9 | document | POST `/auth/twofactor/mfa/login2Factor` | 200 html | `linkUrl` (`10-req.txt`) |
| 58.0~70.3 | xhr | POST `/auth/twofactor/mfa/auth` ×5 (3초 간격) | 200 json | 본문 없음. 응답 `result`, `error_code` |
| 70.4 | xhr | POST `/auth/kaist/user/login/check/policy` | 200 json | (본문 기록 없음. 코드상 `device` 배열) |
| 70.4 | document | POST `/auth/kaist/user/device/view` | 200 html | 기기 등록 화면 |
| 279.1 | xhr | POST `/auth/kaist/user/device/ajaxRegist` | 200 json | (사용자가 "등록"을 누름) |
| 279.3 | document | GET `/auth/kaist/user/device/login` | 302 | |
| 279.3 | document | GET `/auth/user/login/link` | 200 html | 자동 제출 폼 |
| 279.4 | document | POST `portal.kaist.ac.kr/passni5/login_proc.jsp` | 200 html | `sso_code`(hex 32~63자), `user_id`(빈 값), `add_param`, `form_type`, `lang`, `locale` (`21-req.txt`) |
| 279.6 | document | GET `/common/login/login.do?returnUrl` | 303 | |
| 279.8 | document | GET `portal.kaist.ac.kr/` | 200 html | |
| 280.6 | xhr | GET `/wz/api/widget/identity` | 200 json | (포털 페이지가 스스로 호출) |

- 연쇄(같은 기록): ERP는 `portal /kaist/main/cais` 302 → `erp /passni5/main.jsp` → POST `sso /auth/user/login/link` **200**(로그인 화면 없이) → `erp /passni5/login_proc.jsp` → `/com/lgin/SsoCtr/j_login_sso.do` → `initPageWork.do`. kds는 `/login/ssoLogin.do` → POST `sso /auth/user/login/link` 200 → `/login/ssoLoginAuthEx.do` 302. SSO 세션으로 승인 없이 넘어간다.
- 52.6초에 포털 화면에서 SSO로 넘어갔다. 포털 화면을 연 지 51초 뒤였고 그 사이에 위젯 요청이 있었다. [추정] `login.do`는 자동으로 넘어가지 않고, 사용자가 로그인 버튼을 눌렀다. **`login.do`의 HTML은 저장되어 있지 않다**(기록 스크립트가 document 본문을 저장하지 않음, `scripts/phase0/portal-recorder.ts:41`). 그래서 이 버튼의 선택자는 확인하지 못했다.

### 1.2 SSO 로그인 화면 구조 [관찰-캐시] (`/auth/kaist/user/login/view`, KLMS 경유 판)

| 요소 | 선택자 | 비고 |
|---|---|---|
| 탭: 간편 로그인 (기본) | `li#mfa.on > a[href="#loginTab01"]` | 화면 문구 "간편 로그인" |
| 탭: ID/PW 로그인 | `li#auth > a[href="#loginTab02"]` | 화면 문구 "ID/PW 로그인". 탭 전환은 `new/js/common.js`의 `.login_tab ul li a` 클릭 처리 |
| 간편 로그인 영역 | `div#loginTab01.login_cont` (표시됨) | |
| 아이디 (간편) | `input#login_id_mfa[name=login_id_mfa][type=text]` | 페이지가 열리면 여기에 포커스 |
| 간편 로그인 버튼 | `#loginTab01 a.btn_login` (`href="javascript:loginProcMfa();"`) | |
| 간편 오류 문구 | `label#mfaResultMsg` | |
| ID/PW 영역 | `div#loginTab02.login_cont` (숨김) | |
| 아이디 / 비밀번호 | `input#login_id`, `input#login_pwd[type=password]` | 둘 다 `autocomplete="off"` |
| ID/PW 로그인 버튼 | `#loginTab02 a.btn_login` (`href="javascript:loginProc();"`) | |
| ID/PW 오류 문구 | `label#resultMsg` | |
| 아이디 저장 | `input#check_id[type=checkbox]` | localStorage `saveId` |
| 숨은 값 | `input#agt_id[type=hidden]`(에이전트 ID, 사이트별 상수), 페이지 JS 변수 `linkUrl = "/user/login/link"` | CSRF 토큰 같은 숨은 필드는 없다 |
| 엔터 키 | 텍스트·비밀번호 입력에서 Enter → `li.on`의 id가 `mfa`면 `loginProcMfa()`, 아니면 `loginProc()` | |
| 불러오는 스크립트 | jquery-3.6.3, jquery-ui, js-cookie, `crypto/seed.js`, `crypto/pad-ansix923-min.js`, `util/common.js`, `client/passninx-client-5.0.js`, `js/login/login.js`, `new/js/common.js`, `util/kaist-countdown.js` | 캡차나 봇 탐지 스크립트는 없다 |

- 포털 경유 화면은 `agt_id` 값만 다를 것으로 [추정]한다. 기록에서 같은 경로와 같은 후속 요청이 나왔다.
- Pass-Ni NX 클라이언트(로컬 `127.0.0.1:49443`) 자동 로그인 분기는 꺼져 있다(`if ("N" == "Y" ...)`). [관찰-캐시]

### 1.3 비밀번호 클라이언트 변환 [관찰-캐시] (`login.js`)

- `keyModule.init("/auth/user/login/init")`: 로그인 버튼을 누를 때 동기 ajax POST(본문 없음)로 키를 받는다. `result_data`의 앞 64 hex는 키, 다음 32 hex는 IV다(`login.js` 10~31행).
- `fn_encrypt_data`: `CryptoJS.SEED.encrypt(json, key, {iv, mode: CBC, padding: AnsiX923})`를 hex로 바꾼다(44~55행).
- `loginModule.auth(url)`: `#login_id`·`#login_pwd`·`#agt_id`와 localStorage `sso.cookie.device.*` 값(`device_cd`)을 JSON으로 묶어 암호화한다. **보내기 전에 `#login_pwd`를 비운다**(91~124행).
- `loginModule.mfa(url)`: `#login_id_mfa`와 `#agt_id`만 암호화한다(127~155행).
- 결론: 평문 비밀번호는 전송되지 않는다. 다만 키를 같은 연결로 받으므로 TLS 외 보호는 사실상 난독화 수준이다. [추정] 프로그램이 HTTP로 직접 재현하면 SEED 구현과 키 처리를 해야 한다. **실제 페이지에 Playwright로 입력하는 편이 단순하고, 서버가 보는 흐름도 사람이 입력할 때와 같다.**

### 1.4 제출 요청 [관찰-캐시 코드, 샘플은 간편 경로만]

| 경로 | 방식 | 요청 | 본문 (이름만) |
|---|---|---|---|
| 간편 | `loginProcMfa()` | ① POST `/auth/user/login/init`(본문 없음) ② POST `/auth/twofactor/mfa/init`, `application/x-www-form-urlencoded`(jQuery 기본) ③ 폼 POST `/auth/twofactor/mfa/login2Factor` | ② `user_data` ③ `linkUrl` |
| ID/PW | `loginProc()` | ① POST `/auth/user/login/init` ② POST `/auth/user/login/auth` (urlencoded, 동기 ajax, 응답 JSON `code`/`data`) | ② `user_data` |

- ID/PW 응답 `code` 분기 (login/view 인라인 스크립트):
  - `SS0001` → `/auth/user/login/link`(성공)
  - `SS0098` → 폼 POST `/auth/kaist/user/login/second/view`(`user_gubun`, `linkUrl`, 2차 인증 화면, **미관찰**)
  - `SS0099` → `/auth/kaist/user/device/view`
  - `SS0007` → `/auth/kaist/user/duplicate/view`
  - `SS0005`/`SS0006` → `/auth/kaist/user/login/pwd/view`(비밀번호 변경)
  - `dormancy` → `/auth/kaist/user/dormancy/view`
  - `EAU016~018` → alert "정상적인 요청이 아닙니다." 후 `/auth/user/login/view`
  - `EAU005~007` → `/auth/kaist/user/login/pwd/view`
  - `EAU001` → `#resultMsg`에 "아이디 또는 비밀번호가 올바르지 않습니다."
  - 그 밖 → alert "시스템 오류…[code]"
- 간편 응답 `code` 분기:
  - `""` → `login2Factor` 폼 제출
  - `ESY008` → `#mfaResultMsg`에 "인증앱에 등록된 사용자가 아닙니다. 로그인 앱 등록을 이용해 주세요."
  - `E002`·`E003`·`ESY100` → alert(서버 통신·파싱·내부 오류)

### 1.5 성공 시 리다이렉트 [관찰-샘플]
`login2Factor` → (폴링 성공) → `check/policy` → `device/view` → `device/login` 302 → `login/link` 200(숨은 폼 `#loginForm`: `sso_code`, `add_param_url`, `locale`, 자동 submit) → 포털 `/passni5/login_proc.jsp` 200 → `/common/login/login.do?returnUrl` 303 → `/` 200. 쿠키는 포털 `JSESSIONID`만 필요하다(`docs/portal-design.md` S8a 결과).

---

## 2. 2단계 인증 (폰 승인 대기)

### 2.1 화면 [관찰-캐시] (`/auth/twofactor/mfa/login2Factor`)
- 표지
  - `div.auth_contents_wrap`
  - `div.auth_number > div.nember_wrap > div.sr-only`: 2글자, 숫자 포함. [추정] 폰에서 맞출 검증 번호. 설계 문서의 "숫자 매칭"과 같고, 오류 `ESY024` "검증 번호가 일치 하지 않습니다"가 있다
  - `div.auth_time_wrap`, `div.loader-box`, `strong#countdown`(남은 시간)
  - 문구 "인증 대기 중입니다."와 "스마트 기기의 푸시 메시지를 클릭하여 생체인증을 진행하여 주십시오."
  - "시간 연장" 링크(`a[href="javascript:fnReSend();"]`, POST `/auth/twofactor/mfa/send`)
- 제한 시간: `Countdown.start(3, …)`, 3분. 지나면 alert "인증 시간이 초과되어…" 후 `/auth/user/login/view`로 간다.
- `_type = "push"`면 페이지가 바로 `fnAuthProc()` 폴링을 시작한다.

### 2.2 폴링 [관찰-샘플+캐시]
- POST `/auth/twofactor/mfa/auth`(본문 없음, 동기 ajax)를 3초마다 보낸다. 응답은 `{result: bool, error_code: string}`이다.
- 기록: 11~14번은 `result=false, error_code=ESY020`(대기), 15번은 `result=true, error_code=""`(승인)이었다.
- 승인되면 `fnCheckPolicy()`가 POST `/auth/kaist/user/login/check/policy`(`device`: localStorage `sso.cookie.device.*` 값 배열)를 보낸다. 응답 `code`에 따라 이동한다:
  - `SS0001` → `login/link`
  - `SS0099` → `device/view`
  - `SS0007` → `duplicate/view`
  - `SS0004~6` → `pwd/view`
  - `ES0017`/`EAU016~018` → alert 후 `login/view`
- 네트워크 오류가 나면 3초 뒤 다시 보낸다.

### 2.3 대기 시간
| 기록 | 2단계 인증 화면 → 승인 | 근거 |
|---|---|---|
| 포털 기록 (rec) | **약 12.4초** (57.9 → 70.3, 폴링 5회) | [관찰-샘플] |
| V1 (KLMS 경유) | 약 9.4초 (`login2Factor` +20.5s → `device/view` +29.9s) | [관찰] `v1-log.txt` |
| S8a | 13.7초 | [관찰-문서] `docs/portal-design.md:122` |
| 기기 등록 화면 체류 (rec) | 약 209초 (70.4 → 279.1, 사용자가 "등록" 클릭) | [관찰-샘플]. V1은 약 4초 |

### 2.4 성공 판별 비교 (`BROWSER_CHECKS.portal`, `src/sites/sites.ts:82-86`)
- 조건: host가 `portal.kaist.ac.kr`이고, 경로에 `/login`이 없고, `fetch('/wz/api/widget/identity')`가 ok이며 JSON이다.
- 기록에서 성공 마지막 단계는 `portal /` 200이고, 그 직후 페이지가 `identity`를 200 JSON으로 받았다(28번). 지금 판별과 맞는다.
- SSO 화면(host `sso.kaist.ac.kr`)과 `login.do`·`login_proc.jsp` 단계에서는 false를 돌려주고 fetch도 하지 않는다(`login_proc.jsp`는 경로에 `login`이 있다). 대기 중 추가 요청이 생기지 않는다.
- 빈틈: 지금 판별은 성공만 본다. 대기, 실패, 기기 등록 대기를 구별하지 못해, 실패하면 5분 타임아웃(`timeoutMs`, `browser-login.ts:66`)까지 기다린다.

### 2.5 기기 등록 화면 [관찰-캐시] (`/auth/kaist/user/device/view`)
- 버튼
  - "등록": `a[href="javascript:setDevice();"]` → POST `device/ajaxRegist` → localStorage에 `sso.cookie.device.<cd>`를 저장하고 `device/login`으로 간다
  - "등록 안함": `a[href="javascript:nextProc();"]` → `location.replace("/auth/kaist/user/device/login")`
- 매번 새 컨텍스트를 쓰므로 localStorage가 비어 있다. 그래서 `check/policy`가 `SS0099`를 돌려주고, **로그인할 때마다 이 화면이 뜬다** [관찰: V1과 rec 모두 나옴].
- 지금 흐름에서는 사용자가 직접 누른다.

---

## 3. 실패 상태: 증거, 판별, 대응

샘플(rec)에는 **실패 사례가 하나도 없다**(성공 1회 기록). 아래 증거는 모두 캐시된 SSO 페이지 코드에서 읽은 것이다. 실제로 그 화면을 본 적은 없다.

| 상태 | 증거 (출처) | 표시 방식 | 판별 방법 (제안) | 대응 |
|---|---|---|---|---|
| 아이디/비밀번호 틀림 | `EAU001` → `#resultMsg` "아이디 또는 비밀번호가 올바르지 않습니다." (login/view 인라인) | DOM 문구 | `#resultMsg` 텍스트가 비어 있지 않음 | 즉시 중단, 재시도 없음, "자격 증명 확인 필요" |
| 간편 로그인 미등록 | `ESY008` → `#mfaResultMsg` "인증앱에 등록된 사용자가 아닙니다" | DOM 문구 | `#mfaResultMsg` 텍스트 | 중단, 앱 등록 안내 |
| 비밀번호 오류 횟수 초과 (잠금) | `EAU005`("…초과하여 접속이 불가합니다.[N회]"), `EAU006`("…N분 동안 접속이 불가"), `EAU007`("…접속이 차단되었습니다") (`login.js` 195~203행). 페이지는 `/auth/kaist/user/login/pwd/view`로 이동 | 이동 (메시지는 `loginModule.message`) | URL 경로 `/login/pwd/view` | **즉시 중단, 이후 자동 입력 잠금**(5.3절) |
| 비밀번호 변경 요구 | `SS0004`(최초), `SS0005`(초기화), `SS0006`(오래됨) → `pwd/view` | 이동 | 같은 URL (잠금과 구별 안 됨) | 중단, 사용자가 직접 처리 |
| 2단계 인증 실패 누적 (임시 차단/차단) | `ESY021` "인증 실패 허용 횟수가 초과되어 임시 차단", `ESY022` "…차단" (login2Factor 인라인) | **alert** 후 `login/link` | dialog 문구에 "차단" | 즉시 중단, 자동 입력 잠금 |
| 폰에서 거절 | `ESY023` "인증 요청이 취소 되어…" | alert | dialog 문구 "취소" | `LoginCancelledError`로 종료 (종료 코드 3) |
| 번호 불일치 | `ESY024` "검증 번호가 일치 하지 않습니다" | alert | dialog 문구 "검증 번호" | 중단 (재시도 없음) |
| 승인 시간 초과 | `E004`, 그리고 3분 카운트다운 콜백 | alert | dialog 문구 "시간이 초과" | `LoginCancelledError('timeout')` |
| 다른 곳에서 접속 중 | `SS0007` → `/auth/kaist/user/duplicate/view`. 메시지에 **접속 중인 IP**가 들어간다 | 이동 | URL `duplicate/view` | 중단하고 사용자에게 보여 준다. 자동으로 "이전 접속 종료"를 누르지 않는다 |
| 비정상 접근 | `EAU016`/`EAU017` "정상적인 접근 경로가 아닙니다", `EAU018` 세션 만료, `ES0017` | alert 후 `login/view` | dialog 문구 "정상적인" | 중단. **CLAUDE.md "평소와 다른 오류" 정지 조건** |
| 휴면 계정 | `dormancy` → `/auth/kaist/user/dormancy/view` | 이동 | URL | 중단 |
| ID/PW 2차 인증 화면 | `SS0098` → `/auth/kaist/user/login/second/view` | 이동 | URL | **미관찰.** 사용자에게 맡기고 대기 |
| 키 발급 실패 | alert "[key]" / "[connect]" | alert | dialog 문구 | 자격 증명을 보내기 전이므로 1회만 재시도 가능 |
| 캡차 | **증거 없음.** 로그인 화면 스크립트에 캡차·reCAPTCHA가 없고, 지금까지 로그인 3번(V1·rec·S8a)에서 차단 문구도 없었다 (`docs/phase0-report.md:31`) | - | 기존 `SUSPICIOUS` 유지 | 중단 |
| "다른 기기에서 승인" 화면 | 별도 화면의 증거는 없다. 가장 가까운 것은 `duplicate/view`(다른 IP 접속 중)와 기기 등록 화면 | - | - | - |

참고 [관찰-문서]: curl 기본 UA로 로그인 페이지를 요청하면 `400 Request Blocked`가 났다는 하위 조사 보고가 있다(`docs/phase0-report.md:88`, 직접 재현 안 함).

---

## 4. Playwright로 실제 페이지에 입력하는 설계

### 4.1 최소 변경안 (`chainLogin`, `src/sso/browser-login.ts:65-94`)

지금 첫 단계는 `goto(first.startUrl)`(78행) → 안내(79행) → `waitLoggedIn`(80행)이다. 가운데에 **"입력 1회 + 상태 감시"**를 넣고 나머지(연쇄 83~89행, 쿠키 분리·저장 `src/sites/session.ts:124-137`)는 그대로 둔다.

```ts
// 개념 스케치 (확정 코드 아님). 선택자·코드표는 src/sso/sso-site.ts 한 곳에 모은다.
export interface SsoFill { userId: string; password?: string } // password가 없으면 간편 로그인 탭
interface ChainLoginOptions { ...; fill?: SsoFill }

// chainLogin 안, page 생성 직후
const dialogs: string[] = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); }); // 원문은 메모리에만 (SS0007 문구에 IP 포함)

await page.goto(first.startUrl, { waitUntil: 'domcontentloaded' });
if (opts.fill) {
  await reachSsoLoginView(page);        // 포털 login.do → sso /auth/kaist/user/login/view (4.2 ① 참고)
  await assertLoginViewMarkers(page);   // 표지가 없으면 ParseError로 멈춤 (입력하지 않음)
  await fillOnce(page, opts.fill);      // 실행당 1회. 끝나면 fill 값 참조를 버린다
  const s = await watchUntil(page, dialogs, { deadlineMs: 4 * 60_000 }); // 'logged-in' | 'device' | 실패 상태
  if (s.kind === 'device') await page.click(SSO.device.skip);           // "등록 안함" (4.3 참고)
  else if (s.kind !== 'waiting') throw toKaistError(s);                  // 3절 표
  onStatus('폰에서 승인해 주세요 (3분 안).');
}
if (!(await waitLoggedIn(page, first, timeoutMs, isClosed))) throw new LoginCancelledError('timeout');
```

- `fillOnce` (간편 로그인):
  1. `#login_id_mfa`가 보이는지 확인한다
  2. `page.fill('#login_id_mfa', userId)`
  3. `page.click('#loginTab01 a.btn_login')`
- `fillOnce` (ID/PW):
  1. `li#auth > a` 클릭
  2. `#loginTab02`가 보일 때까지 기다린다
  3. `page.fill('#login_id', …)`, `page.fill('#login_pwd', …)`
  4. `page.click('#loginTab02 a.btn_login')`
  - `login.js`가 동기 ajax로 키 발급, 암호화, 전송을 처리한다.
- `watchUntil`은 1초 간격으로 다음을 본다. **프로그램이 `mfa/auth`를 따로 폴링하지 않는다.** 페이지가 이미 폴링한다.
  - URL 경로
  - `#resultMsg`/`#mfaResultMsg` 텍스트
  - 쌓인 dialog 문구
  - 기존 `SUSPICIOUS`
  - `login2Factor` 화면이면 `waiting`
- `waitLoggedIn`에도 같은 상태 판별을 넣는다. 그러면 2단계 대기 중 실패(alert `ESY021~024`, `E004`)를 5분 타임아웃 전에 잡는다.
- **입력 후 `login/view`가 다시 보이면 다시 입력하지 않고 실패로 끝낸다.** 실패 alert 뒤 페이지는 `login/link`나 `login/view`로 돌아간다.
- `browserLogin`(KLMS 단독, `src/sso/browser-login.ts:97-120`, `kaist login --only klms`)도 같은 함수를 쓰게 하거나, 자동 입력에서 빼고 수동으로 둔다.

### 4.2 필요한 선택자·표지 (한 파일, 예: `src/sso/sso-site.ts`)

| 용도 | 값 | 확인 수준 |
|---|---|---|
| ① 포털 → SSO 진입 | 포털 `login.do`의 로그인 버튼 | **미확인.** HTML이 없다. 선택지: (a) 실행 1회로 구조만 기록(요소 id·class, 값 제외), (b) 이 단계만 사용자가 클릭하고 `waitForURL(/sso\.kaist\.ac\.kr\/auth\/kaist\/user\/login\/view/)`로 기다림. [추정] 포털 폼에 `user_id` 필드가 있어 SSO 화면에 아이디를 미리 넣는 구조일 수 있다(빈 값으로 전송됨) |
| ② 로그인 화면 판별 | host `sso.kaist.ac.kr`, 경로 `/auth/kaist/user/login/view`, `#agt_id` 존재, `typeof loginProcMfa === 'function'` | 관찰-캐시 |
| ③ 입력·버튼 | 1.2절 표 | 관찰-캐시 |
| ④ 즉시 오류 | `#resultMsg`, `#mfaResultMsg` | 관찰-캐시 |
| ⑤ 승인 대기 | 경로 `/auth/twofactor/mfa/login2Factor`, `.auth_number`, `strong#countdown` | 관찰-캐시 + 경로는 샘플 |
| ⑥ 기기 등록 | 경로 `/auth/kaist/user/device/view`, `a[href="javascript:nextProc();"]`(등록 안함), `a[href="javascript:setDevice();"]`(등록) | 관찰-캐시 |
| ⑦ 실패 이동 | `/login/pwd/view`, `/duplicate/view`, `/dormancy/view`, `/login/second/view` | 관찰-캐시 (화면은 미관찰) |
| ⑧ alert 분류 | "차단", "횟수", "취소", "검증 번호", "시간이 초과", "정상적인", "[key]", "[connect]" | 관찰-캐시 (문구는 코드 그대로) |
| ⑨ 성공 | 기존 `BROWSER_CHECKS.portal` | 관찰-샘플 |

- 캐시는 2026-10-13 시점이다. SSO가 바뀌었을 수 있으므로 ②의 표지 검사가 실패하면 입력하지 않고 멈춰야 한다(CLAUDE.md "파싱 실패는 명확한 오류").
- 단위 테스트는 위 선택자를 흉내 낸 합성 HTML을 `page.setContent`로 띄워 확인할 수 있다. 실서버 요청과 개인정보가 없어 `tests/` 규칙에 맞는다.

### 4.3 실패 처리·재시도 규칙 (제안)
- **자동 입력은 실행 1회에 1번만 한다.** 자격 증명을 보낸 뒤의 실패(`EAU*`, `ESY0xx`, `E004`, 이동형 실패)는 재시도하지 않는다. 사용자가 다시 실행해야 한다.
- 자격 증명을 보내기 전에 생긴 일시 오류(키 발급 "[key]"/"[connect]" alert, 로그인 화면 로딩 실패)만 10초 이상 기다린 뒤 **최대 1회** 다시 한다.
- 잠금·차단(`EAU005~007`, `ESY021/022`, `pwd/view`)이나 `SUSPICIOUS`가 보이면 바로 멈춘다. 로컬 파일(예: `%LOCALAPPDATA%\kaist-cli\login-guard.json`, 시각·상태 코드만 기록)에 남겨 **다음 자동 입력을 막는다**. 사용자가 확인한 뒤 플래그로 풀게 한다. 실패가 30분 안에 2번이면 자동 입력을 끈다.
- 기기 등록 화면: **"등록 안함"을 누르거나 사용자에게 맡긴다. "등록"은 자동으로 누르지 않는다.** 이유는 5.4절.
- 승인 대기 중 "시간 연장"을 자동으로 누르지 않는다. 3분이 지나면 끝낸다.
- 로그인은 사용자가 시작한 명령(`kaist login`, 대화형 `sync`)에서만 한다. 자동 sync(`scripts/daily-sync.ps1:28`, `--no-login`)는 지금처럼 로그인하지 않는다. 자동 입력이 생겨도 사용자 모르게 폰 푸시가 가면 안 된다.

### 4.4 자격 증명을 받는 경로 (주의)
- CLI는 Claude Code가 도구로 실행하는 경우가 많다. 이때 stdin이 없어 숨김 프롬프트가 동작하지 않는다(PowerShell 도구는 stdin이 null 장치). 받는 방법은 사실상 셋이다:
  - (a) 사용자가 직접 연 터미널에서만 프롬프트
  - (b) 로컬 저장 (설정 파일 또는 Windows 자격 증명 관리자/DPAPI)
  - (c) 대화로 전달
- (c)는 비밀번호가 대화 기록에 남는다. 제75조①6호(비밀번호 공유 금지, `docs/phase0-report.md:221`)에 걸릴 소지가 있어 피해야 한다.
- **간편 로그인 경로라면 아이디만 있으면 된다.** 아이디는 비밀값이 아니지만 개인정보다. `%LOCALAPPDATA%\kaist-cli\config.json`(저장소 밖)에 두고 로그·출력에 내지 않으면 된다. 비밀번호의 저장, 입력, 전달 문제가 모두 없어진다.

---

## 5. 위험

### 5.1 규정·확정 결정 충돌 [관찰-문서]
- 정보보안지침 제75조①7호 "응용프로그램 등을 이용한 자동 비밀번호 입력기능을 사용하지 말 것" (`docs/phase0-report.md:222`). 0단계 보고서는 "문자 그대로 읽으면 브라우저 자동완성도 해당될 수 있다"고 적었다(`docs/phase0-report.md:438`).
- 이 조항을 근거로 확정된 결정과 규칙:
  - `CLAUDE.md:100` "비밀번호를 묻거나 저장하거나 자동 입력하지 않는다"
  - `docs/handoff-implementation.md:28, 117, 160` (만들지 않을 것: "비밀번호 자동 입력")
  - `docs/kaist-agent-design.md:30`(근거 칸에 제75조①7호), `:65`
  - `docs/portal-design.md:102` "로그인 창에서 CLI는 이동만 한다. 폼 조작이나 클릭은 하지 않는다"
  - 코드 주석 `src/sso/browser-login.ts:1-3`
- 그 밖의 관련 조항: 제80조③(허락받은 목적·용도로만 사용), 제81조①(정상 운용 방해 시 제재), 학칙 제59조 6호 (`docs/phase0-report.md` V6). 자동 입력을 직접 금지하는 KLMS·SSO 약관은 찾지 못했다. 로그인 화면에는 `/auth/kaist/user/terms/service`(서비스 이용약관) 링크가 있지만 **내용은 확인하지 않았다**.
- CLAUDE.md 작업 규칙은 "확정된 결정을 바꿔야 할 이유가 생기면 근거와 선택지를 설명하고 사용자의 결정을 받는다"고 한다. 사용자 결정은 이미 있지만, 문서 갱신 전에 다음을 함께 보여 줄 필요가 있다:
  - (A) 간편 로그인 탭에 아이디만 자동 입력: 비밀번호를 다루지 않는다. 제75조①7호 문언과 충돌하지 않는다고 [추정]
  - (B) ID/PW 자동 입력: 조항과 정면으로 충돌하고, 저장 금지 규칙도 함께 바꿔야 한다

### 5.2 시도 빈도
- 정상 흐름에서는 세션이 살아 있으면 로그인하지 않는다(`src/cli.ts:74-79`, 프로브 후 재사용). 유휴 만료는 약 3시간 [추정, `docs/phase0-report.md:77`]이다. 하루 1~2회 로그인이면 사람이 직접 할 때와 빈도가 같다.
- 위험은 버그로 루프가 도는 경우다(예: 실패 후 `login/view`로 돌아가 다시 입력). 4.3절의 "실행당 1회 + 로컬 잠금 파일"이 필요하다.
- 반복 로그인 시 차단 여부는 시험하지 않았다(`docs/phase0-report.md:54, 422`).

### 5.3 잠금 정책 [관찰-캐시, 수치 미상]
- 비밀번호 오류 횟수를 넘으면 접속 불가(`EAU005`, 횟수 N은 응답 `data`), N분 차단(`EAU006`), 영구 차단(`EAU007`)이 있다.
- 2단계 인증 실패도 누적된다: 임시 차단(`ESY021`), 차단(`ESY022`). 거절·번호 불일치·시간 초과가 "인증 실패"로 세어지는지는 [추정]으로 남는다.
- 정확한 횟수와 시간은 응답에만 나오고 샘플에 없다. 잘못된 비밀번호로 자동 재시도하면 계정 잠금까지 갈 수 있다. 그래서 재시도를 0회로 권한다.

### 5.4 기기 등록과 2단계 인증 우회 소지 [추정]
- ID/PW 경로는 로그인 요청에 `device_cd`(localStorage `sso.cookie.device.*`)를 함께 보낸다. 응답은 `SS0001`(바로 성공), `SS0098`(2차 인증), `SS0099`(기기 등록)로 나뉜다. 등록된 기기라면 ID/PW만으로 2차 인증 없이 `SS0001`이 될 가능성이 있다.
- 기기 값을 저장해 재사용하면 **2단계 인증을 우회하는 구조**가 될 수 있다. "2단계 인증을 우회하지 않는다"(`CLAUDE.md:100`)와 충돌하므로 `device_cd`를 저장·주입하지 않아야 한다.
- 매번 "등록"을 자동으로 누르면 서버에 기기 등록이 쌓일 수 있다 [추정]. 기록에서는 사용자가 "등록"을 눌렀다(279.1초 `ajaxRegist`).

### 5.5 비밀값 노출 경로 [추정]
- Playwright 디버그 로그(`DEBUG=pw:api`), trace, 실패 스크린샷, 오류 메시지에 입력값이나 화면이 남을 수 있다. 다음이 필요하다:
  - 자동 입력 코드에서 trace와 스크린샷을 끈다
  - Playwright 오류를 감싸 선택자 이름만 남긴다
  - `onStatus`나 로그에 값을 넣지 않는다
- 주의: `SS0007` 문구에 IP가 들어가므로 dialog 원문을 로그로 남기지 않는다.
- `login.js`는 보내기 전에 `#login_pwd`를 비운다. 하지만 `page.fill`에 넘긴 문자열은 Node 메모리에 남는다. 쓰고 나면 참조를 버린다.

### 5.6 자동화 탐지
- 지금까지 Playwright 번들 Chromium(`navigator.webdriver = true`)으로 로그인 3번을 했고, 캡차나 차단은 없었다(`docs/phase0-report.md:31`).
- 로그인 화면에 봇 탐지 스크립트가 없다 [관찰-캐시]. 입력 속도(`fill`은 즉시 입력)를 검사하는지는 알 수 없다. 필요하면 `pressSequentially`(타이핑 지연)를 쓸 수 있다.

### 5.7 로컬 파일 정리 (부수 발견) [관찰]
- `samples\portal\rec\9-req.txt`: 암호화된 로그인 아이디(`user_data`)가 들어 있다. `8-res.json`의 키로 풀 수 있다. **내용은 표시하지 않았다.** 기록은 간편 경로라 비밀번호는 없다.
- `samples\portal\rec\21-req.txt`, `6-req.txt`: SSO 일회성 코드와 에이전트 값이 들어 있다(만료됐을 것).
- `%LOCALAPPDATA%\kaist-cli\profile\` (0단계 V1 persistent profile): 지금 코드는 쓰지 않는데 남아 있다. 2단계 인증 화면 HTML(검증 번호 포함 [추정])과 `login/link` HTML(일회성 `sso_code` 포함)이 캐시에 있다.
- 같은 폴더에 `cookies.json`(V1 쿠키)과 `wstoken.txt`가 남아 있다. 0단계 보고서는 `wstoken.txt` 삭제를 권고했다(`docs/phase0-report.md` 3.2).
- 이 파일들의 정리 여부는 사용자가 정할 일이다.

---

## 6. 확인하지 못한 것
- 포털 `login.do` 화면 구조(로그인 버튼 선택자, `user_id` 입력 존재 여부). 저장된 HTML이 없다.
- ID/PW 경로의 실제 요청과 응답(`/auth/user/login/auth`)과 2차 인증 화면 `/auth/kaist/user/login/second/view`. 샘플은 간편 경로뿐이다.
- 실패 화면 전부(잠금, 거절, 시간 초과, 중복 접속). 근거는 코드뿐이다.
- 포털 경유 로그인 화면이 KLMS 경유 화면(캐시)과 `agt_id` 말고도 같은지.
- 잠금 횟수·시간, 서비스 이용약관 내용.
- 2단계 인증 화면의 2글자 값이 검증 번호인지(길이·숫자 포함만 확인).

## 7. 사용한 자료
- 코드: `src/sso/browser-login.ts`, `src/sites/sites.ts`, `src/sites/session.ts`, `src/klms/session.ts`, `src/klms/site.ts`, `src/cli.ts:70-87`, `src/errors.ts`, `scripts/phase0/portal-recorder.ts`, `scripts/phase0/v1-login.ts`, `scripts/phase0/s8a-verify.ts`, `scripts/daily-sync.ps1`
- 문서: `docs/phase0-report.md`(V1, V2, V6, 3.3~3.5, 5절 질문 2), `docs/portal-design.md`(1절, 7절, S8a), `docs/kaist-agent-design.md`(5절), `docs/handoff-implementation.md`, `CLAUDE.md`
- 샘플: `samples\portal\rec\recording.jsonl`(메타데이터), `6-req.txt`, `8-res.json`, `9-req.txt`, `10-req.txt`, `11~15-res.json`, `21-req.txt`(필드 이름·모양만), `v1-log.txt`(이동 경로만)
- 캐시: `profile\Default\Cache\Cache_Data`의 `sso.kaist.ac.kr` 항목. 공개 JS 7개를 `scratchpad\cache-js\`로 꺼냈다(`login.js`, `passninx-client-5.0.js`, `kaist-countdown.js`, `seed.js` 등). HTML 3개(`login/view`, `mfa/login2Factor`, `device/view`)와 `login/link`는 메모리에서만 구조를 읽었고 파일로 꺼내지 않았다.
- 도구: `scratchpad\tools\shape.js`(값 대신 모양만 출력), `cache.js`(Chromium blockfile 캐시 읽기), `htmlshape.js`(구조만, 위험 문자열 가림)
