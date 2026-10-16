# Electron 이식 조사: kaist CLI → 트레이 데스크톱 앱 (Windows)

조사일 2026-10-16. 저장소는 읽기만 했다. 학교 사이트에는 접속하지 않았다.

표기 규칙
- **[실측]**: 이 PC에서 Electron 44.8.0을 scratchpad에 받아 직접 돌려 본 결과. 외부 사이트 없이 127.0.0.1 로컬 서버만 썼다. 스크립트와 결과는 `C:\Users\ljh04\AppData\Local\Temp\claude\C--Users-ljh04-OneDrive-Desktop-KAISTBOT\73403ffa-d718-46d0-9563-0c61203e7435\scratchpad\etest\scripts\`(main.cjs, pdf.cjs, native.cjs, popup.cjs, *-out.json)에 있다.
- **[문서]**: 공식 문서·릴리스 노트·npm 레지스트리에서 확인한 내용
- **[추정]**: 근거는 있지만 직접 확인하지 못한 내용
- **[미확인]**: 확인하지 못한 내용. 실제로 만들 때 검증해야 한다

---

## 0. 결론 요약

1. **목표 버전은 Electron 44.x**(현재 stable 44.8.0, Node 24.22.0, Chromium 152)로 시작한다. 45.0.0은 2026-10-20 정식 예정이다. 44 지원 종료는 2027-03-02라서 8주 주기로 따라 올려야 한다.
2. **`node:sqlite`는 Electron 44 메인 프로세스와 utilityProcess에서 플래그 없이 그대로 동작한다 [실측].** 경고도 없었다. `src/store/db.ts`는 고칠 필요가 없다. better-sqlite3로 바꿀 이유는 없다.
3. **node-llama-cpp 3.22.1의 미리 빌드된 바이너리는 재빌드 없이 Electron 44에서 로드된다 [실측, CPU 바이너리만].** N-API 기반이라 electron-rebuild와 VS 빌드 도구가 필요 없다. LLM과 sync는 utilityProcess에 두기를 권장한다.
4. **앱 안 로그인 창(BrowserWindow와 메모리 전용 partition)으로 Playwright를 대체할 수 있다.** 여러 호스트의 쿠키를 HttpOnly·SameSite까지 `session.cookies.get({})`로 읽을 수 있고, `clearData()` 뒤에는 0개가 된다. 팝업은 부모 세션을 물려받는다 [실측].
5. **PDF는 `webContents.printToPDF`로 대체할 수 있다.** 숨긴 창에서 A4, 맑은 고딕 임베드, 텍스트 추출, 상대 링크 보존을 확인했고 1건에 약 0.25초 걸렸다 [실측]. 현재 `page.pdf`와 같은 Chromium 엔진이다.
6. **트레이 앱의 함정**: 창이 0개가 되면 앱이 종료되고(`window-all-closed`), Tray 변수는 GC될 수 있으며, Windows 종료 이벤트는 창이 있어야 받는다. 알림에는 AUMID와 시작 메뉴 바로가기가 필요하다.
7. **설치 파일은 모델 없이 약 125~150MB로 추정한다.** Electron 런타임만 압축(xz)해도 116MB였다 [실측]. 모델(수 GB)은 첫 실행 때 받아야 한다. NSIS 설치 파일은 2GB, GitHub Release 파일은 2GiB까지만 된다.
8. **코드 서명**: 한국 개인은 Azure Artifact Signing을 쓸 수 없다(개인은 미국·캐나다만). OV 인증서는 연 $150~300이고, 2024년부터는 EV도 SmartScreen 경고를 바로 없애 주지 않는다. 무서명이면 "Windows의 PC 보호" 경고가 뜨고, Win11 Smart App Control은 아예 막는다. Microsoft Store(MSIX)는 개인 등록이 무료이고 Store가 서명해 주지만, 파일 가상화 때문에 CLI와 데이터 폴더를 같이 쓰는 것이 깨질 수 있다.
9. **비밀번호 보관은 `safeStorage`(DPAPI)를 권장한다.** keytar는 2022년에 보관(archived)됐다. safeStorage의 키는 앱 userData의 `Local State`에 있어서 CLI(일반 Node)는 복호화할 수 없다 [실측].
10. **구조**: 지금의 `src/`를 코어로 두고 Playwright 의존을 "포트(인터페이스)" 뒤로 숨긴다. `app/`(main·preload·renderer·workers)는 그 포트의 Electron 구현을 넣는다. CLI는 그대로 빌드·사용한다. 두 쪽은 `%LOCALAPPDATA%\kaist-cli` 데이터와 `sync.lock`을 같이 쓴다.

---

## 1. Electron 버전, 내장 Node, `node:sqlite`

### 버전 [문서]
| 버전 | 정식 | Chromium | Node | 지원 종료 |
|---|---|---|---|---|
| 43.x | 2026-06-30 | M150 | 24.x | 2027-01-05 |
| **44.x (현재 latest: 44.8.0, 2026-10-16)** | 2026-08-25 | M152 | **24.22.0** (44.8.0) | 2027-03-02 |
| 45.0.0 (beta.5, 2026-10-16) | 2026-10-20 예정 | M156 | 24.22.0 (일정표) | 2027-04-27 |

- npm `electron` dist-tag: latest=44.8.0, beta=45.0.0-beta.5.
- Electron 44에서 Windows ia32(32비트) 빌드가 없어졌다(electron-builder 문서). x64(필요하면 arm64)만 대상으로 한다.
- 권장: 44.x로 개발을 시작하고, 45가 45.1 이상으로 안정되면 올린다. Electron은 최신 3개 메이저만 지원하니 8주마다 올리는 것을 운영 비용에 넣는다.
- [실측] Electron 44 npm 패키지에는 postinstall이 없다. 바이너리는 `electron`을 처음 실행할 때(또는 `npx install-electron`) 받는다. CI에서는 이 단계를 명시해야 한다.

### `node:sqlite` [실측 + 문서]
- 실측(Electron 44.8.0): 메인 프로세스에서 `require('node:sqlite')`, `DatabaseSync`, `prepare().run/get/all`, `exec`, `pragma journal_mode=wal`이 모두 동작했다. SQLite 3.53.4, `process.on('warning')`로 경고 0건. utilityProcess(ESM `.mjs`·CJS 모두)에서도 같은 결과였다.
- 이력[문서]: Electron 35.0.2(Node 22.14)부터 플래그 없이 쓸 수 있었다. 37.2.0에서 GN 빌드 설정이 빠져 "No such binding: sqlite" 회귀가 있었고, PR #47706(2025-07-15)으로 고쳐 36·37·38에 백포트했다. **이 회귀가 다시 생길 수 있으니 앱 시작 시 `node:sqlite` 로드 자체를 점검(실패하면 명확한 오류)하고, Electron을 올릴 때마다 스모크 테스트를 돌린다.**
- 안정성[문서]: Node 24.15.0부터 Stability 1.2(Release candidate)다. 이 PC의 Node 24.19(CLI)와 Electron의 Node 24.22 모두 경고가 없다.
- 앞으로[문서]: Node 26 문서에서는 `DatabaseSync`가 `Database`의 deprecated 별칭(DEP0210)이다. Electron이 Node 26으로 올라가면 import 한 줄을 바꾸면 된다. 런타임 경고가 뜨는지는 [미확인].
- CLI(시스템 Node 24.19, SQLite 3.53.3)와 앱(SQLite 3.53.4)이 같은 `kaist.db`를 WAL로 함께 열어도 파일 형식이 같다. 동시 sync는 기존 `src/store/lock.ts`의 `sync.lock`이 막는다.

### 대안 비교 (필요 없지만 기록)
| 선택지 | 판단 |
|---|---|
| **`node:sqlite` 유지** | **권장.** 이식 비용 0, 네이티브 모듈 없음 |
| better-sqlite3 13.0.3 | 13.0.0(2026-07-21)에서 N-API로 바뀌어 Electron에서도 재빌드 없이 로드된다 [실측: Electron 44 메인에서 로드·쿼리 성공]. API(prepare/run/get/all/exec)가 거의 같아서 바꾸는 비용은 `db.ts` 한 파일이다(`DatabaseSync`는 db.ts에서만 쓰고 16개 파일은 `openDb()`만 부른다). node:sqlite가 다시 깨질 때 쓸 예비책 |
| sql.js (WASM) | 메모리 DB를 통째로 파일에 쓰는 방식이라 WAL과 동시 접근(CLI와 앱 동시 사용)이 안 된다. 부적합 |
| 별도 Node 사이드카 | 필요 없다. utilityProcess가 그 역할을 한다 |

---

## 2. 네이티브 모듈 (node-llama-cpp, better-sqlite3)

### 재빌드 필요 여부
- [문서] Electron은 BoringSSL을 쓰는 등 ABI가 Node와 달라서, V8 API를 직접 쓰는 모듈은 `@electron/rebuild`(4.2.1)로 다시 빌드해야 한다. Windows에서 직접 빌드하면 `win_delay_load_hook`이 필요하다.
- **N-API(node-addon-api) 모듈은 ABI가 안정적이라 미리 빌드된 바이너리를 그대로 쓴다.**
  - node-llama-cpp 3.22.1: 의존성에 node-addon-api가 있다. [실측] `@node-llama-cpp/win-x64`(CPU) 바이너리로 Electron 44 메인과 utilityProcess 모두에서 `getLlama({gpu:false, build:'never'})`가 성공했다(buildType `prebuilt`, 메인에서 약 0.4초). GPU 바이너리(Vulkan/CUDA)와 실제 추론은 [미확인].
  - better-sqlite3 13.x: N-API, prebuilds가 패키지 안에 들어 있다 [실측 로드 성공].
- 결론: **이 조합이면 VS Build Tools, Python, CMake 같은 Windows 빌드 도구가 필요 없다.** 소스에서 빌드해야 하는 경우(커스텀 CMake 옵션, 바이너리가 없는 플랫폼)에만 VS 2022 C++ 도구와 CMake가 필요하고, node-llama-cpp CUDA 소스 빌드에는 CUDA Toolkit도 필요하다[문서]. 이 경우의 세부 절차는 [미확인].

### node-llama-cpp Windows 바이너리 크기 [문서: npm unpackedSize]
| 패키지 | 압축 해제 크기 | 비고 |
|---|---|---|
| @node-llama-cpp/win-x64 (CPU) | 30.7MB | xz 압축 4.2MB [실측] |
| @node-llama-cpp/win-x64-vulkan | 74.3MB | NVIDIA, AMD, Intel GPU 공통 |
| @node-llama-cpp/win-x64-cuda | 176.1MB | CUDA 12.4/13.1 기준 빌드 |
| @node-llama-cpp/win-x64-cuda-ext | 368.0MB | CUDA 런타임 라이브러리로 추정 [추정] |

- 권장: 설치 파일에는 **CPU와 Vulkan만** 넣고, CUDA는 빼거나 나중에 받는다. 나중에 받는 방식은 node-llama-cpp가 기본 지원하지 않아서 직접 구현해야 한다 [미확인].
- [문서] node-llama-cpp Electron 가이드
  - 렌더러에서 쓰면 앱이 죽는다. 메인 프로세스에서 쓴다(utilityProcess는 문서에 언급이 없지만 [실측] 동작했다).
  - 번들러에서 external로 두고, 바이너리는 asar 밖으로 꺼낸다. 공식 템플릿 설정은 `asarUnpack: ["node_modules/node-llama-cpp/bins", "node_modules/node-llama-cpp/llama/localBuilds", "node_modules/@node-llama-cpp/*"]`다.
  - Electron 패키지 안에서는 소스 빌드를 하지 않는다(asar는 읽기 전용).
  - 다른 플랫폼용 패키지를 교차로 만들 수는 없다(Windows 빌드는 Windows에서).
- 대안 사이드카: llama.cpp 공식 릴리스의 `llama-server.exe`(b11681 기준 win-vulkan-x64 zip 32MB, cpu-x64 20MB)를 child_process로 띄우고 localhost HTTP(OpenAI 호환)로 쓴다. 네이티브 모듈이 앱 프로세스에 없어 격리가 확실하고 모델 런타임을 바꾸기 쉽다. 대신 포트 관리와 프로세스 관리가 늘어난다. Ollama는 Windows zip이 1.47GB, 설치 파일이 1.58GB(v0.40.5)라서 앱에 넣기에는 너무 크다.

### 어느 프로세스에 둘까 (권장)
| 프로세스 | 둘 것 | 이유 |
|---|---|---|
| main | 트레이, 창, 로그인 창, printToPDF, safeStorage, 알림, 스케줄러, 업데이트 | BrowserWindow와 safeStorage는 main에서만 쓸 수 있다 |
| utilityProcess "core" | sync 전체(HTTP, 파서, DB, 드라이브 복사, pdfjs 텍스트 추출) | `node:sqlite`는 동기라서 main에서 돌리면 UI와 트레이가 멈춘다. [실측] utilityProcess 안에서는 `require('electron').BrowserWindow`가 undefined라서, 로그인과 PDF는 main에 메시지로 요청한다 |
| utilityProcess "llm" | node-llama-cpp | 메모리 수 GB, 크래시 격리. [문서] Electron은 "CPU 집약·크래시 위험 컴포넌트"를 utility process에 두라고 하고, `child_process.fork`보다 utilityProcess를 우선하라고 한다. 렌더러와 MessagePort로 바로 이을 수 있어 토큰 스트리밍에 좋다 |

- `utilityProcess.fork`는 app `ready` 뒤에만 부를 수 있다[문서]. stdin은 지원하지 않는다.
- Electron 44.8.0에서 "utilityProcess가 종료 직전 postMessage를 잃는" 버그가 고쳐졌다[문서: 릴리스 노트]. 44.8.0 이상을 쓴다.

---

## 3. 앱 안 로그인 창 (Playwright `chainLogin` 대체)

### 확인한 동작 [실측, 로컬 서버]
- `session.fromPartition('login-' + Date.now())`(`persist:` 접두어 없음)는 메모리 전용 세션이다(`isPersistent()=false`). 매번 새 이름을 쓰면 지금의 "매번 새 브라우저 컨텍스트" 규칙을 지킨다. 기본 세션의 쿠키는 0개였다(격리).
- `127.0.0.1/a`(쿠키 2개 설정 후 302) → `localhost/b`(쿠키 1개)로 호스트를 넘는 리다이렉트를 한 뒤 `ses.cookies.get({})` 한 번에 **두 호스트의 쿠키 3개가 모두** 나왔다.
  - HttpOnly 쿠키도 나온다(`httpOnly: true`). 페이지의 `document.cookie`에는 안 보였다.
  - `sameSite`: `strict`/`lax`/`unspecified`, `hostOnly`, `session`, `expirationDate`(세션 쿠키는 없음) 필드가 있다.
- 이벤트: 302는 `will-redirect`, 도착은 `did-navigate`로 잡혔다.
- `ses.clearData()` 뒤 `cookies.get({})`는 0개였다.
- 입력 채우기: `executeJavaScript`로 `value`를 넣고 `input` 이벤트를 보내는 방식, `focus()` 뒤 `webContents.insertText()`(타이핑 흉내) 방식 둘 다 페이지의 `input` 리스너가 받았다.
- 팝업: `setWindowOpenHandler`에서 `allow`만 돌려도 자식 창은 **부모와 같은 session**을 썼다(`child.webContents.session === ses`). 자식이 받은 HttpOnly 쿠키도 부모 partition에 들어갔다.

### 기존 코드와의 대응
| Playwright (지금) | Electron |
|---|---|
| `chromium.launch` + `browser.newContext()` | `new BrowserWindow({ webPreferences: { partition: 'login-<고유값>', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } })` |
| `page.goto(url)` | `win.loadURL(url)` |
| `page.evaluate(fn, arg)` (BROWSER_CHECKS, browserLoggedInCheck) | `win.webContents.executeJavaScript(\`(${fn.toString()})(${JSON.stringify(arg)})\`)`. 이 함수들은 이미 "자기 완결적"으로 작성돼 있어 그대로 옮길 수 있다. 다만 지금 시그니처는 `(page: Page) => Promise<boolean>`이므로 "페이지 안에서 돌 함수 + 인자" 형태로 바꿔야 한다 |
| `page.on('close')` | `win.on('closed')` → `LoginCancelledError('closed')` |
| `context.cookies()` | `win.webContents.session.cookies.get({})` |
| `Cookie.expires` (-1 = 세션) | `expirationDate` (세션이면 undefined) → `expires: c.expirationDate ?? -1` |
| `Cookie.domain` (앞 점 가능) | 같다(호스트 쿠키가 아니면 앞에 점). 기존 `replace(/^\./,'')`, `cookiesFor`를 그대로 쓴다 |
| `sameSite: 'Strict'/'Lax'/'None'` | `'strict'/'lax'/'no_restriction'/'unspecified'` (현재 저장 형식은 sameSite를 저장하지 않아 영향 없음) |
| `browser.close()` | `win.destroy()` + `await ses.clearData()` |

### 주의점
1. **User-Agent**: Electron 기본 UA는 `... Chrome/152.0.7977.167 Electron/44.8.0 Safari/537.36`이다 [실측]. 학교 SSO가 낯선 UA를 다르게 처리할 수 있으니 로그인 partition에 `ses.setUserAgent()`로 `Electron/...`을 뺀 Chrome UA를 넣는다. `src/klms/site.ts`의 `USER_AGENT`(Chrome/130 고정)도 같은 Chrome 메이저로 맞추기를 권장한다. 세션이 UA에 묶이는지는 [미확인].
2. **폰 승인 대기와 백그라운드 스로틀링**: 사용자가 창을 최소화하면 Chromium이 페이지 타이머를 늦춘다. 승인 상태를 폴링하는 SSO 페이지가 느려질 수 있어 `backgroundThrottling: false`를 둔다(위 표). 완료 판별은 지금처럼 1초 폴링을 하되, `executeJavaScript`는 "페이지 로딩이 끝날 때까지 실행이 미뤄진다"[문서]. 그래서 호출마다 타임아웃을 두고, 실패는 지금처럼 "아직 아님"으로 처리한다.
3. **이동 제한**: `will-navigate`와 `will-redirect`(서버 리다이렉트는 will-navigate가 아니라 will-redirect로 온다 [실측])에서 `https://*.kaist.ac.kr`만 허용하고 URL은 `new URL()`로 파싱한다[문서: 보안 체크리스트 13]. 팝업은 `setWindowOpenHandler`에서 같은 허용 목록만 `allow`하고 나머지는 `deny`한다. 팝업도 부모 세션을 쓰므로 그 쿠키도 수집 대상이다.
4. **권한·다운로드**: `ses.setPermissionRequestHandler`와 `setPermissionCheckHandler`로 모두 거부한다(Electron 기본값은 허용 [문서]). `ses.on('will-download', e => e.preventDefault())`를 둔다. 인증서 오류(`certificate-error`)는 덮어쓰지 않는다.
5. **SameSite**: SSO(sso.kaist.ac.kr) → 포털·KLMS·ERP·kds는 모두 같은 사이트(kaist.ac.kr)다. 그래서 최상위 이동에서 Lax/Strict 쿠키가 막힐 일은 없다 [추정, 로컬 실측은 다른 호스트로 확인]. 실제 학교 흐름은 [미확인].
6. **비밀번호 채우기**: 실제 로그인 페이지에 채우고 페이지 스스로 제출하게 하면, 페이지 JS의 암호화·토큰 처리가 그대로 동작한다. 로그인 폼 셀렉터는 아직 저장소에 없다(지금은 사용자가 직접 입력). 샘플로 확인해 `src/sites/sites.ts` 한 곳에 둔다. `insertText`를 쓰면 비밀번호가 JS 소스 문자열에 들어가지 않는다. 다만 IPC 메시지와 렌더러 메모리에는 거친다.
7. **맞춤법 사전 다운로드**: [실측] Electron이 userData에 `ko-3-0.bdic`를 받았다. 기본 맞춤법 검사가 구글 CDN에서 사전을 받기 때문이다. 로그인 창과 앱 창 모두 `spellcheck: false`로 꺼서 불필요한 외부 요청을 없앤다.
8. **구글 OAuth는 이 창에서 하면 안 된다.** 구글은 임베디드 브라우저의 OAuth 요청을 `disallowed_useragent`로 막는다(2021 정책). 지금의 시스템 브라우저 + loopback 방식(`src/google/oauth.ts`)을 유지한다. `cmd /c start` 대신 `shell.openExternal(url)`을 쓰면 된다.
9. 메모리 전용 세션이 앱 종료 전에 메모리에서 풀리는지는 [미확인]. 로그인은 드물어서 문제는 작을 것으로 본다.
10. 캡차·차단 문구 감지(`SUSPICIOUS`)는 같은 방식으로 `executeJavaScript('document.body?.innerText')`로 옮긴다.

---

## 4. Markdown → PDF (`page.pdf` 대체)

[실측] 숨긴 `BrowserWindow({show:false})`에서 `printToPDF({ pageSize:'A4', printBackground:true, preferCSSPageSize:true })`로 120줄 한글 문서를 출력했다.
- MediaBox `[0 0 594.96 841.92]`(A4), 4쪽, 약 27KB, 1건 약 0.25초
- 글꼴 `MalgunGothic`과 `MalgunGothicBold`가 서브셋으로 임베드됐고 `/ToUnicode`가 있다. pdfjs로 뽑은 텍스트가 원문 한글과 같았다.
- `<a href="상대경로">` 링크 1개가 유지됐다. 지금의 `<base href=file:///...>` 방식이 그대로 동작한다.
- `loadFile`(JS 켬·끔), `data:` URL 세 방식 모두 결과가 같았다. 권장은 staging에 임시 HTML을 쓰고 `loadFile` + `javascript: false`다. `data:` URL 페이지에서 `file://` 이미지를 불러올 수 있는지는 [미확인].
- **함정 [실측]**: 창을 `destroy()`해서 창이 0개가 되면 기본 동작으로 앱이 종료돼, 다음 `loadFile`이 `ERR_FAILED (-2)`로 실패했다. 트레이 앱은 `app.on('window-all-closed', () => {})`가 필수다.

옵션 대응 [문서]: Playwright `format:'A4'` → `pageSize:'A4'`. `margin`(문자열 mm) → `margins`(인치 객체). `printBackground`와 `preferCSSPageSize`는 같다. 지금 CSS가 `@page { size: A4; margin: 16mm 14mm }`로 여백을 정하므로 `preferCSSPageSize: true`면 같은 결과로 본다 [추정]. 기본 `pageSize`는 Letter라서 꼭 지정한다. `generateDocumentOutline`(실험적)으로 제목 기반 책갈피를 넣을 수 있다.

한글 글꼴: 맑은 고딕은 이 PC에 있다. 다른 사용자 PC에도 기본으로 있는지는 [미확인]이다. Windows 10/11 기본 글꼴로 알려져 있지만 확인하지 않았다. 안전하게 하려면 OFL 한글 글꼴(Noto Sans KR 등)을 앱 리소스에 넣고 `@font-face`로 지정한다. 글꼴은 서브셋으로 임베드되므로 PDF 크기에는 영향이 작다.

---

## 5. 트레이 앱 수명주기

| 항목 | 방법 | 근거 |
|---|---|---|
| 단일 인스턴스 | `if (!app.requestSingleInstanceLock()) app.quit()`, 기존 인스턴스는 `second-instance`에서 창을 보이거나 명령(예: `--sync-now`)을 처리한다. argv는 그대로 오지 않을 수 있으니 `additionalData`를 쓴다 | [문서], 잠금 반환값 [실측] |
| 창 0개여도 유지 | `app.on('window-all-closed', () => {})` | [실측] 없으면 종료됨 |
| Tray GC | `Tray` 객체를 모듈 최상위 변수로 잡아 둔다(아니면 몇 분 뒤 아이콘이 사라짐) | [문서: FAQ] |
| 로그인 시 시작 | `app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })` (HKCU Run 키). `enabled`로 작업 관리자 "시작 앱" 토글과 맞춘다. Windows에는 `wasOpenedAtLogin`이 없어서 `process.argv.includes('--hidden')`로 판별한다. `getLoginItemSettings`에도 같은 path와 args를 넘겨야 정확하다 | [문서] |
| 예약 sync | 앱 안 스케줄러: 1분마다 벽시계 시각과 "오늘 07:00 이후 성공 sync가 있었나"(DB `sync_runs`)를 비교하는 방식. 긴 `setTimeout`은 쓰지 않는다(절전·시계 변경에 약하고 최대 약 24.8일). 렌더러가 아니라 main 또는 core worker에서 돌린다(숨은 렌더러는 타이머가 스로틀됨) | [추정] |
| 절전·복귀 | `powerMonitor.on('resume')` → 1~2분 뒤 `net.isOnline()`을 확인하고, 놓친 sync를 실행한다(작업 스케줄러의 "놓치면 실행"과 같은 효과). `on-battery`(Win)에서는 LLM 작업을 미룰 수 있다. `getSystemIdleTime()`으로 유휴 시에만 무거운 작업을 할 수 있다 | [문서] |
| Windows 종료 | Windows에서는 종료·로그오프 때 `before-quit`, `will-quit`, `quit`이 오지 않는다[문서]. `session-end`는 BrowserWindow 이벤트라서 **트레이 전용 앱은 숨은 창 하나를 유지해야** 받는다(electron-updater 문서도 트레이 전용 앱은 이 보호를 못 받는다고 적음). DB는 WAL과 트랜잭션이라 갑작스러운 종료에도 일관성이 유지된다 | [문서] |
| 알림 | `new Notification({title, body}).show()`, 지원 여부 true [실측]. **시작 메뉴 바로가기에 AUMID가 있어야** Windows 토스트가 뜬다. NSIS 설치 프로그램이 바로가기를 만들고, main 첫 줄에서 `app.setAppUserModelId(appId)`를 부른다. 개발 중에는 `app.setAppUserModelId(process.execPath)`를 쓴다. 클릭 활성화에는 `app.setToastActivatorCLSID`를 쓴다. 앱이 꺼져 있을 때 알림을 눌러 앱을 다시 띄우는 동작과 집중 지원(방해 금지)에서의 동작은 [미확인]. 알림은 놓칠 수 있으니 트레이 툴팁·배지에도 표시한다 | [문서] |
| 작업 스케줄러와의 관계 | 앱이 켜져 있어야만 앱 안 스케줄러가 돈다. 개발자(사용자 본인)는 기존 `KAIST daily sync`(CLI)를 그대로 둘 수 있다. 둘이 겹쳐도 `sync.lock`이 막는다. 일반 사용자에게는 앱 스케줄러만 쓰고, 필요하면 작업이 `KAIST.exe --sync-now`를 부르게 해서 단일 인스턴스로 넘긴다 | [추정] |

---

## 6. 패키징, 자동 업데이트, 코드 서명

### 도구 버전 [문서: npm, 2026-10-16]
- electron-builder: latest 26.15.3, v26 계열 26.17.0(2026-09-26), next 27.0.0-alpha.10. **운영에는 v26을 쓴다.** 공식 사이트 문서 일부는 v27(master) 기준이라 설정 키가 다를 수 있다(예: v27의 `win.sign` 통합 키).
- electron-updater 6.8.9, @electron/rebuild 4.2.1, Electron Forge 8.0.1, electron-vite 6.0.0(2026-10-14 출시, 너무 새것이라 5.x나 6.0.x 안정화 후 권장).

### NSIS 설치 프로그램 [문서]
- 기본값 `oneClick: true`, `perMachine: false` → **사용자별 설치**(`%LOCALAPPDATA%\Programs\<앱>`), UAC 없음. 자동 업데이트도 관리자 권한 없이 된다.
- `appId`는 한 번 정하면 바꾸지 않는다. 설치 GUID와 AUMID가 여기서 나온다.
- `deleteAppDataOnUninstall` 기본 false(일반 데이터 보존). `build/installer.nsh`의 `include` 매크로로 맞춤 동작을 넣는다.
- `electronLanguages: ['ko','en-US']`로 locales(49MB [실측])를 줄일 수 있다.

### 예상 크기 [실측 + 추정]
- Electron 44 런타임 폴더 369MB(electron.exe 236MB, locales 49MB, dxcompiler.dll 25MB 등), xz -6 압축 116MB [실측]. NSIS LZMA도 비슷할 것으로 본다 [추정].
- 앱 코드와 JS 의존성은 수 MB~20MB [추정]. node-llama-cpp CPU +4MB, Vulkan 74MB(압축 후 크기 [미확인]).
- **설치 파일은 모델 없이 약 125~150MB, 설치 후 약 450~550MB [추정].** CUDA 바이너리까지 넣으면 압축 해제 기준 +540MB다.

### 모델(수 GB): 첫 실행 때 받는다 (권장)
- 넣을 수 없는 이유: NSIS는 설치 파일 2GB가 이론상 한계다[문서: NSIS wiki]. GitHub Release는 파일 1개당 2GiB다(실제로는 정확히 2GiB 파일이 실패한 보고도 있다)[문서]. 업데이트마다 재다운로드 위험이 있고, SmartScreen 평판은 파일 해시별로 쌓인다.
- 방법: 설정 마법사에서 디스크 여유 확인 → Hugging Face에서 받는다(node-llama-cpp `resolveModelFile`/`createModelDownloader`, `hf:<user>/<repo>:<quant>` 형식, 분할 GGUF 자동)[문서]. SHA-256을 검증하고 `%LOCALAPPDATA%\kaist-cli\models\`(Roaming 아님)에 둔다. "이미 받은 GGUF 파일 선택"도 넣는다. 이어받기 지원 여부는 [미확인].
- electron-builder `nsis-web`(웹 설치 프로그램)은 앱 패키지가 클 때를 위한 것이고, 모델처럼 사용자가 고르는 데이터에는 맞지 않는다.

### 자동 업데이트 (electron-updater + GitHub Releases) [문서]
- Windows에서 자동 업데이트를 지원하는 타깃은 NSIS다(Squirrel.Windows는 지원 안 함). `latest.yml`과 blockmap 차등 다운로드를 쓴다. `setFeedURL`은 부르지 않는다(`app-update.yml`이 자동 생성됨).
- **GitHub Releases는 공개 저장소가 전제다.** 비공개 저장소는 사용자 PC에 `GH_TOKEN`이 있어야 해서 일반 배포에 맞지 않는다고 문서에 적혀 있다. 소스는 비공개로 두고 **릴리스 전용 공개 저장소**에 publish하는 방식이 가능하다 [추정: 일반적 패턴].
- **무서명 앱의 업데이트**: 지금(v26/v27)은 `publisherName`이 없으면 서명 검증을 건너뛰고 경고만 남긴다(fail-open). 소스 주석은 **"electron-builder v28에서는 publisherName 없음을 검증 실패로 처리(fail-closed)"**한다고 예고한다[문서: NsisUpdater.ts master]. 무서명 + 자동 업데이트에는 기한이 있다.
- 다운로드 파일의 sha512는 항상 `latest.yml`과 대조한다. v27(alpha)은 `latest.yml` 자체를 Ed25519로 서명하는 "signed update manifests"를 넣었고, 인증서 없이도 업데이트 위변조를 막는다. SmartScreen 문제는 그대로 남는다.

### 코드 서명 (2026) [문서: Microsoft Learn 2026-08 갱신]
| 선택지 | 비용 | 한국 개인 | SmartScreen |
|---|---|---|---|
| Azure Artifact Signing (구 Trusted Signing) | 약 $9.99/월 | **불가.** 개인은 미국·캐나다만, 조직은 미국·캐나다·EU·영국만 | 평판이 쌓일 때까지 경고 |
| OV 인증서 (DigiCert, Sectigo, Certum 등) | 연 $150~300 | 가능(CA마다 개인 발급 조건 다름 [미확인]) | 평판이 쌓일 때까지 경고, 게시자 이름 표시 |
| EV 인증서 | 연 $400 이상 | 가능 | **2024년부터 OV와 같다**(즉시 통과 없음) |
| Microsoft Store (MSIX) | 무료(개인 등록 무료, 2025-06부터) | 가능 | 경고 없음(Store가 재서명) |
| SignPath Foundation | 무료 | 공개 오픈소스 프로젝트만 | OV 수준 |
| 무서명 | 무료 | - | 강한 경고, 기업 정책이면 실행 불가 |

- 2023-06부터 OV 개인 키는 HSM·하드웨어 토큰에 둬야 한다. 클라우드 서명 상품(예: Certum SimplySign, 공식 몰 "클라우드 표준 코드 서명 €49부터", 기간 조건 [미확인])을 쓰면 USB 토큰 없이 CI 서명이 된다. Certum은 2026-03부터 코드 서명 인증서 유효기간이 짧아진다고 공지했다.
- electron-builder v26은 signtool(.pfx·인증서 저장소)과 Azure를 지원한다. v27은 hsm/pkcs11(베타)을 추가했다.
- **무서명 앱이 사용자에게 보이는 모습**[문서]: 다운로드 후 실행하면 "Windows의 PC 보호(Windows protected your PC)" 창이 뜬다. "추가 정보"를 눌러야 "실행" 버튼이 나오고 게시자는 "알 수 없음"으로 표시된다. 새 버전마다 해시 평판이 0부터 다시 시작한다. **Windows 11 Smart App Control이 켜진 PC에서는 평판 없는 무서명 실행 파일이 아예 차단된다**(인터넷 다운로드 여부와 관계없이 모든 실행 파일). Smart App Control이 node-llama-cpp의 무서명 DLL·.node까지 막는지는 [미확인]. 브라우저 다운로드 경고나 백신 오탐 가능성도 [미확인].
- 서명해도 첫 배포에서는 "인식할 수 없는 앱" 경고가 남는다(게시자 이름은 표시됨). MS 문서는 경고가 사라지려면 "수 주, 수백 건의 정상 설치"가 걸릴 수 있다고 쓴다. 지인 배포 규모라면 서명해도 경고가 계속 보일 가능성이 높다 [추정].
- Microsoft Store(MSIX)의 제약 [추정, 확인 필요]: 앱 자체 업데이트 대신 Store 업데이트를 쓴다. MSIX는 `%LOCALAPPDATA%` 쓰기를 패키지별로 가상화해서 **CLI와 `%LOCALAPPDATA%\kaist-cli`를 같이 쓰는 구조가 깨질 수 있다.** 시작 시 실행은 매니페스트의 StartupTask로 바뀐다. 학교 계정 로그인을 자동화하고 자격 증명을 다루는 앱이 Store 심사를 통과할지는 [미확인]. EXE/MSI로 Store에 올리면 직접 CA 서명이 필요하다.

---

## 7. 비밀번호 보관 (사용자가 켰을 때만)

### Electron `safeStorage` [실측 + 문서]
- [실측] `isEncryptionAvailable()`=true(ready 뒤). `encryptString`/`decryptString`과 `encryptStringAsync`/`decryptStringAsync`(`shouldReEncrypt: false`) 왕복이 성공했다.
- [실측] 12바이트 평문의 암호문은 43바이트였다. `v10` 접두어 3 + nonce 12 + 암호문 12 + 태그 16으로, Chromium os_crypt(AES-256-GCM) 형식과 맞다. 실제 키는 **userData의 `Local State` 파일의 `os_crypt.encrypted_key`에 DPAPI로 감싸져**(`RFBBUEkB` = "DPAPI" 접두어) 있다.
- 결과
  - 같은 Windows 사용자의 다른 프로그램은 복호화할 수 있다. 다른 사용자는 못 한다[문서: Electron, CryptProtectData]. 로밍 프로필이면 다른 PC에서도 풀린다.
  - **userData(`Local State`)가 지워지면 저장한 비밀번호를 못 푼다.** "다시 입력해 주세요"로 자연스럽게 처리한다.
  - **CLI(일반 Node)는 이 값을 못 푼다.** CLI는 지금처럼 비밀번호 없이 사용자가 입력하는 방식으로 둔다(원래 규칙과 일치).
  - userData 기본 위치는 `%APPDATA%`(Roaming)다. 큰 캐시가 로밍·백업되지 않도록 `app.setPath('userData', %LOCALAPPDATA%\<앱>)`을 ready 전에 둔다(문서도 userData에 큰 파일을 두지 말라고 권함).
- 문서는 동기 API가 나중에 deprecated될 수 있다며 **async API를 권장**한다.

### keytar / Windows 자격 증명 관리자
- keytar 7.9.0(2022-02)는 GitHub 저장소가 **2022-12에 보관(archived)**됐다 [문서: GitHub API]. 쓰지 않는다. 대안 `@napi-rs/keyring` 2.1.1(2026-10-10, N-API)이 유지되고 있다.
- 자격 증명 관리자(CRED_TYPE_GENERIC)[문서]: 비밀 크기는 2560바이트 이하다. `CRED_PERSIST_LOCAL_MACHINE`은 이 PC의 같은 사용자만, `CRED_PERSIST_ENTERPRISE`는 로밍 프로필을 따라간다. 같은 사용자의 다른 프로세스가 읽을 수 있다는 점은 DPAPI와 같다. 사용자가 제어판 "자격 증명 관리자"에서 항목을 보고 지울 수 있다(앱 밖에서 끄기 쉬움). 앱 데이터를 지워도 남는다. **CLI와 앱이 같이 읽을 수 있다**(둘 다 `@napi-rs/keyring` 사용 시).

### 권장
- 기본(저장 안 함): 비밀번호는 main 프로세스 클로저 안에만, 그 로그인 1회 동안만 둔다. 렌더러 → main은 1회 전달, main → 로그인 창은 `insertText`로 넣는다. 로그·오류 메시지·크래시 덤프 업로드(crashReporter)에 들어가지 않게 한다. JS 문자열은 지울 수 없으니 수명을 최소로 하고 참조를 끊는다. 로그인 페이지 렌더러 메모리에는 어차피 남는다.
- 저장을 켰을 때: **앱 전용이면 `safeStorage`(async)**를 쓴다. 네이티브 모듈이 늘지 않는다. 암호문은 `%LOCALAPPDATA%\kaist-cli\` 아래 파일(예: `credentials.bin`)에 두고, 끄면 파일을 지운다. CLI도 저장된 비밀번호를 써야 한다는 요구가 생기면 그때 `@napi-rs/keyring`(자격 증명 관리자)을 검토한다. 이것은 확정 결정 2("Windows 사용자 계정에 묶인 저장소")의 범위 안이다.
- 자동 재로그인은 1회 이하로 한다(설계 문서의 위험 항목). 실패하면 저장한 비밀번호를 쓰지 않고 사용자에게 묻는다.

---

## 8. 권장 프로젝트 구조 (CLI를 유지하며 이행)

### 지금 Playwright가 코어에 새는 곳 (저장소 확인)
- 실행 의존: `src/sso/browser-login.ts`(chromium), `src/files/pdf.ts`(chromium)
- 타입만: `src/klms/session.ts`, `src/sites/session.ts`(`Cookie`), `src/sites/sites.ts`(`Page`: BROWSER_CHECKS)
- playwright는 지금 devDependencies에 있다(npm link 개발 환경이라 동작함). 앱 패키지에 Playwright를 넣으면 Chromium이 두 벌이 되므로 **앱 런타임은 Playwright에 의존하지 않아야 한다.**

### 구조안
```
src/                       코어 + CLI (지금 그대로, tsc → dist/, npm link)
  platform/                새로 만들 포트(인터페이스)만. 구현 없음
    browser.ts             LoginBrowser { open(url), evaluate(fn,arg), cookies(): BrowserCookie[], onClosed, close() }, BrowserCookie 타입(Playwright Cookie 대체)
    pdf.ts                 PdfRenderer { render(html, outPath) }
    notify.ts, secrets.ts, progress.ts
  sso/browser-login.ts     chainLogin(steps, browser: LoginBrowser)로 바꿈 (폴링·차단 문구·연쇄 로직은 공용)
  sites/sites.ts           BROWSER_CHECKS를 "페이지 안 함수 + 인자"로 (셀렉터·로그인 폼도 여기)
  files/pdf.ts             renderPdfs(md[], renderer: PdfRenderer)
  cli/adapters/            playwright-browser.ts, playwright-pdf.ts (await import('playwright')로 동적 로드)
  cli.ts                   CLI 조립 지점(Playwright 어댑터 주입)
app/                       Electron (별도 tsconfig, 번들러: electron-vite 또는 esbuild)
  main/                    index.ts(단일 인스턴스, 트레이, 스케줄러, 업데이트), login-window.ts(ElectronLoginBrowser),
                           pdf.ts(printToPDF), secrets.ts(safeStorage), ipc.ts(ipcMain.handle + 보낸 쪽 검증)
  workers/core.ts          utilityProcess: sync·DB·HTTP. 로그인·PDF는 main에 parentPort로 요청
  workers/llm.ts           utilityProcess: node-llama-cpp (렌더러와 MessagePort 직결 가능)
  preload/index.ts         contextBridge로 좁은 API만 노출 (샌드박스 preload는 CJS 번들이어야 함 [문서])
  renderer/                설정 마법사, 대화창, 설정 (CSP, 원격 콘텐츠 없음)
  shared/ipc.ts            채널 이름과 메시지 타입 (main·preload·worker 공용)
electron-builder.yml       appId, nsis(per-user), asarUnpack(node-llama-cpp), electronLanguages, publish(github)
```
- 실행 위치 [실측]: utilityProcess에서 `.mjs` ESM이 동작했다. 메인도 ESM(`"type":"module"`)을 지원한다(Electron 28+). 단 ready 전에 필요한 비동기 작업은 모두 await해야 하고, 최상위 동적 import는 ready에 늦을 수 있다[문서].
- 데이터 위치는 CLI와 앱 모두 `paths.home`(`%LOCALAPPDATA%\kaist-cli`)을 쓴다. sync 동시 실행은 기존 `sync.lock`이 막는다. 앱 userData(Chromium 캐시, safeStorage 키)는 별도 폴더로 둔다.
- 보안 기본값[문서: 보안 체크리스트]: 모든 렌더러 `sandbox`, `contextIsolation`, `nodeIntegration: false`. 앱 화면은 `file://` 대신 커스텀 프로토콜. IPC는 보낸 프레임 origin을 검증한다. `@electron/fuses`로 `runAsNode`를 끈다(끄면 `ELECTRON_RUN_AS_NODE` 기반 fork가 안 되니 utilityProcess만 쓴다).
- 빌드 산출물은 OneDrive 밖에 두기를 권장한다. 저장소가 `OneDrive\Desktop` 아래에 있어 동기화가 node_modules와 release 폴더를 잠그거나 느리게 할 수 있다 [추정]. 지금 CLAUDE.md의 "G:에는 staging 후 복사" 교훈과 같은 종류의 위험이다.

### 이행 순서 (각 단계에서 CLI가 계속 동작)
1. 포트 도입: `BrowserCookie` 자체 타입, `LoginBrowser`, `PdfRenderer`. Playwright 어댑터는 동적 import로 바꾼다. CLI 동작은 바뀌지 않고 기존 테스트로 확인한다.
2. 앱 골격: 트레이, 단일 인스턴스, `window-all-closed`, 스케줄러 → core worker에서 `sync --no-login`과 같은 흐름. 세션이 만료되면 알림만 보낸다.
3. Electron 로그인 창과 printToPDF 어댑터, 설정 마법사(계정, 구글, 드라이브 폴더).
4. 패키징(NSIS per-user, 내부 테스트는 무서명), 업데이트(공개 릴리스 저장소).
5. LLM worker와 모델 다운로드(별도 조사 결과에 따라).

---

## 확인하지 못한 것 (실제 구현 때 검증)
- 학교 SSO 실제 흐름: Electron UA·임베디드 창에서 차단·캡차가 없는지, 팝업·리다이렉트 구조, 로그인 폼 셀렉터, SameSite 영향(로컬 서버로만 확인)
- 패키징된 앱(asar, asarUnpack) 안에서의 node-llama-cpp와 node:sqlite 동작. 실측은 모두 개발 모드였다
- node-llama-cpp GPU(Vulkan/CUDA) 바이너리 동작과 실제 추론, CUDA를 나중에 받는 방식, 모델 다운로드 이어받기
- 다른 사용자 PC의 맑은 고딕 기본 설치 여부
- 앱이 꺼져 있을 때 알림 클릭으로 앱 활성화, 집중 지원에서의 동작
- 절전 중 Node 타이머 동작(벽시계 비교 방식으로 피해 가도록 설계함)
- Smart App Control이 무서명 DLL·.node까지 막는지, 백신 오탐
- 한국 개인이 받을 수 있는 OV 클라우드 서명 상품의 실제 가격과 조건, Microsoft Store 심사 가능성과 MSIX 파일 가상화의 정확한 범위
- 설치 파일 크기(LZMA 대신 xz로 측정한 추정치)
- Node 26 기반 Electron에서 `DatabaseSync` 별칭의 런타임 경고 여부

---

## 출처
- Electron 일정표: https://releases.electronjs.org/schedule
- Electron stable 릴리스 목록: https://releases.electronjs.org/releases/stable
- Electron 44.8.0 릴리스(자산 크기, 노트): https://github.com/electron/electron/releases/tag/v44.8.0
- Electron 타임라인·Node 업그레이드 정책: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- node:sqlite 회귀 수정 PR: https://github.com/electron/electron/pull/47706 , 이슈 https://github.com/electron/electron/issues/47671 , https://github.com/electron/electron/issues/45532
- Node sqlite 문서(v24): https://nodejs.org/docs/latest-v24.x/api/sqlite.html , 최신: https://nodejs.org/api/sqlite.html
- 네이티브 모듈: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- 프로세스 모델·utilityProcess: https://www.electronjs.org/docs/latest/tutorial/process-model , https://www.electronjs.org/docs/latest/api/utility-process
- ESM: https://www.electronjs.org/docs/latest/tutorial/esm
- 쿠키·세션: https://www.electronjs.org/docs/latest/api/cookies , https://www.electronjs.org/docs/latest/api/structures/cookie , https://www.electronjs.org/docs/latest/api/session
- webContents(printToPDF, setWindowOpenHandler, executeJavaScript): https://www.electronjs.org/docs/latest/api/web-contents
- window.open: https://www.electronjs.org/docs/latest/api/window-open
- 보안 체크리스트: https://www.electronjs.org/docs/latest/tutorial/security
- app(단일 인스턴스, 로그인 항목, AUMID, userData): https://www.electronjs.org/docs/latest/api/app
- powerMonitor: https://www.electronjs.org/docs/latest/api/power-monitor
- 알림: https://www.electronjs.org/docs/latest/tutorial/notifications
- FAQ(Tray GC): https://www.electronjs.org/docs/latest/faq
- safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- node-llama-cpp Electron: https://node-llama-cpp.withcat.ai/guide/electron , CUDA: https://node-llama-cpp.withcat.ai/guide/CUDA , 모델 다운로드: https://node-llama-cpp.withcat.ai/guide/downloading-models , 템플릿 설정: https://github.com/withcatai/node-llama-cpp/blob/master/templates/electron-typescript-react/electron-builder.ts
- npm 레지스트리(버전·크기): https://registry.npmjs.org/node-llama-cpp/latest , https://registry.npmjs.org/electron , https://registry.npmjs.org/electron-builder , https://registry.npmjs.org/better-sqlite3/13.0.3 , https://registry.npmjs.org/@napi-rs/keyring
- better-sqlite3 v13(N-API) 릴리스: https://github.com/WiseLibs/better-sqlite3/releases , 문제 해결: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md
- keytar(보관됨): https://github.com/atom/node-keytar
- llama.cpp 릴리스: https://github.com/ggml-org/llama.cpp/releases , Ollama 릴리스: https://github.com/ollama/ollama/releases
- electron-builder 문서(원문 md): NSIS https://github.com/electron-userland/electron-builder/blob/master/website/docs/nsis.md , 자동 업데이트 https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md , Windows 서명 https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-win.md , 서명된 매니페스트 https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/signed-update-manifests.md , NsisUpdater 소스 https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts , NSIS 옵션 소스 https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts
- 코드 서명 비교(2026-08): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- SmartScreen 평판·Smart App Control: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- EV 즉시 통과 폐지(2024): https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status
- Artifact Signing 가격: https://azure.microsoft.com/pricing/details/artifact-signing/
- Microsoft Store 개인 등록 무료: https://www.neowin.net/news/microsoft-store-now-lets-individual-developers-join-for-free/ , https://blogs.windows.com/windowsdeveloper/2026/05/07/publish-to-microsoft-store-as-a-company-now-with-free-registration-and-faster-onboarding/
- Certum 코드 서명 상품: https://shop.certum.eu/code-signing.html
- NSIS 2GB 한계: https://nsis.sourceforge.io/I_get_an_error_when_compiling_large_installers
- GitHub Release 파일 한계: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- 구글 OAuth 임베디드 브라우저 차단: https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html
- 자격 증명 관리자 구조체: https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw , DPAPI: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
