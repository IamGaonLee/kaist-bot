# 구글 OAuth를 다른 학생에게 배포할 때: 범위 분류, 검증, 대안

조사일: 2026-10-16. 구글 공식 문서를 먼저 봤고, 공식 문서에 없는 내용은 출처 종류(블로그, 포럼)를 따로 적었다.
표시: **[확인]** 공식 문서 원문으로 확인 / **[일화]** 포럼·블로그 사례 / **[추론]** 문서들을 엮은 내 해석 / **[미확인]** 찾지 못함

대상 구성(현재 코드 `src/google/oauth.ts`): 데스크톱 앱 클라이언트, loopback + PKCE. `calendar.app.created`와 `gmail.readonly`를 **한 번에 같이** 요청한다(`SCOPES = [SCOPE, GMAIL_SCOPE]`). 클라이언트 JSON은 저장소가 아니라 `%LOCALAPPDATA%\kaist-cli\google-client.json`에서 읽는다.

---

## 요약

1. `gmail.readonly`는 **제한(restricted)** 범위다 [확인]. `gmail.metadata`도 제한 범위다 [확인]. 제한되지 않은 Gmail 범위는 메일 본문을 읽을 수 없다.
2. `calendar.app.created`의 분류는 공식 공개 문서에서 **찾지 못했다** [미확인]. Calendar 범위 표에는 분류 열이 없다. 콘솔의 Google Auth Platform > 데이터 액세스 화면에서 1분이면 확인된다. 이 값이 이후 계획을 가른다.
3. 지금 앱을 그대로 나눠 주면, 다른 학생은 "확인되지 않은 앱" 경고를 보고 넘어가야 한다. 이 프로젝트를 쓸 수 있는 사용자는 **평생 100명**이고, 이 상한은 초기화할 수 없다 [확인]. 2026-10 포럼에는 같은 구성(데스크톱, gmail.readonly, 미검증 프로덕션)에서 넘기기 버튼 없이 "This app is blocked"로 막힌 사례가 있다 [일화].
4. 구글 정책은 "개인 용도"를 **100명 미만이면서 모두 개발자가 개인적으로 아는 사람**으로 정의한다 [확인]. 모르는 학생에게 나눠 주면 이 예외를 벗어난다. 검증 없이 쓰면 정책 위반이고, 소유자 본인이 쓰는 프로젝트까지 위험해진다 [추론].
5. 제한 범위 검증은 약 6주가 걸리고, 매년 CASA 보안 평가를 받아야 할 수 있다. 구글 수수료는 없지만 평가 기관 비용은 개발자가 낸다. 블로그 기준으로 연 $540~$4,500다 [확인 + 일화]. 메일을 Claude(외부 서버)로 보내는 구조라 "로컬 전용이라 평가 면제"라는 주장은 약하다 [추론]. 혼자 유지하는 무료 도구에는 맞지 않는다.
6. 권고: 배포용 **새 프로젝트**를 만들어 **`calendar.app.created` 하나만** 요청한다. Gmail은 배포 클라이언트에서 빼고, 원하는 사용자만 자기 구글 클라우드 프로젝트(자기 클라이언트)로 켜는 고급 옵션으로 둔다. 현재 프로젝트는 소유자 개인용으로 남긴다.
7. `calendar.app.created`가 민감하지 않은 범위라면 경고 화면도, 100명 상한도, 범위 검증도 없다. 브랜드 검증(몇 분~2-3영업일)만 하면 약 1주 안에 배포할 수 있다 [확인 + 추론]. 민감한 범위라면 민감 범위 검증(무료, CASA 없음, 공식 3~10영업일, 실제 수 주 대기 사례)이 필요하다.
8. 드라이브 데스크톱 동기화 폴더에 파일을 쓰는 데는 OAuth가 필요 없다(일반 파일 쓰기다) [추론, 사실상 확실]. 사용자마다 드라이브 데스크톱 설치, 로그인, 경로 설정만 필요하다.

---

## 1. 범위 분류

| 범위 | 분류 | 근거 | 상태 |
|---|---|---|---|
| `gmail.readonly` | **제한** | Gmail 범위 표에 Restricted로 표시 | [확인] |
| `gmail.metadata` (헤더·라벨, 본문 제외) | **제한** | 같은 표 | [확인] |
| `gmail.labels` | 민감하지 않음 | 같은 표. 라벨만 다루고 메일을 읽을 수 없음 | [확인] |
| `gmail.send` | 민감 | 같은 표 | [확인] |
| `gmail.addons.current.message.readonly` / `.metadata` | 민감 | 같은 표. 단, Gmail 부가기능(add-on)이 열린 메일에만 쓰는 범위라 CLI에서는 못 쓴다 | [확인] |
| `gmail.compose`, `gmail.modify`, `gmail.insert`, `gmail.settings.*`, `https://mail.google.com/` | 제한 | 같은 표 | [확인] |
| `calendar`, `calendar.events`, `calendar.readonly` 등 | 민감 | Nylas 가이드(2026-10-07 수정), 구글 포럼 사례 | [일화] 공식 표에는 분류 열 없음 |
| `calendar.app.created` | **찾지 못함** | 공식 Calendar 범위 페이지(영문·한글), 전체 OAuth 범위 목록 모두 "범위/의미" 두 열뿐. 2026-08 구글 포럼에 "데이터 액세스 범위 선택기에 calendar.app.created가 아예 안 보인다, 민감하지 않은 범위냐"는 질문이 있으나 답이 없다 | **[미확인]** |

- 공식 문서는 분류를 콘솔에서 보라고 한다. 콘솔의 데이터 액세스 화면은 범위를 "민감하지 않은 범위 / 민감한 범위 / 제한된 범위" 세 묶음으로 보여 준다 [확인].
- **확인 방법(소유자가 1분)**: Google Cloud 콘솔 > Google Auth Platform > 데이터 액세스. 현재 프로젝트에 등록된 `calendar.app.created`가 어느 묶음에 있는지 본다. 같은 화면의 인증 센터(Verification Center)도 무엇을 검증해야 하는지 알려 준다.
- 참고로 이 범위는 "이 앱이 만든 보조 캘린더와 그 일정만" 다룬다. 앱이 만든 파일만 다루는 `drive.file`이 민감하지 않은 범위라서 같은 성격일 가능성은 있다. 하지만 근거 없는 추측이므로 콘솔에서 확인해야 한다.

## 2. 지금 상태(미검증 프로덕션)로 다른 사용자가 쓰면

**경고 화면** [확인]
- 민감하거나 제한된 범위를 요청하면서 검증을 마치지 않은 앱은 동의 화면 앞에 "확인되지 않은 앱(Google hasn't verified this app)" 화면이 뜬다.
- 사용자는 "고급 > (도메인)(으)로 이동(안전하지 않음)"을 눌러야 넘어갈 수 있다. 이 문구는 구글 공식 페이지가 아니라 서드파티 안내에서 확인했다 [일화].
- 코드가 요청하는 범위와 콘솔에 등록한 범위가 다를 때도 이 화면이 뜬다 [확인].
- 넘기기 버튼조차 없이 막히는 경우도 있다.
  - 2026-10-05 구글 개발자 포럼 사례: 데스크톱 OAuth 앱, 외부·프로덕션, 브랜드는 검증됨, 범위는 미검증, `gmail.readonly` 포함, 사용자 2/100. "This app is blocked"만 뜨고 고급·계속 버튼이 없었다 [일화, 답변 없음].
  - 고급 보호 프로그램(Advanced Protection)에 가입한 계정은 미검증 앱의 Gmail 접근을 막는다는 보고가 있다 [일화].

**100명 상한** [확인]
- 민감하거나 제한된 범위를 쓰는 미검증 앱은 새 사용자가 100명까지만 허용된다.
- "user cap applies over the entire lifetime of the project, and it cannot be reset or changed." 즉 프로젝트 평생 100명이고, 초기화하거나 바꿀 수 없다. 소유자 본인도 1명으로 센다.
- 상한을 다 쓰면 새 사용자에게 "Sign in with Google temporarily disabled"가 뜬다.
- 승인된(검증된) 범위만 요청하는 앱에는 상한이 적용되지 않는다.

**시간 제한**
- 프로덕션 게시 상태에서는 7일 만료가 없다 [확인].
- 테스트(Testing) 상태에서는 테스트 사용자 100명까지만 쓸 수 있다. 기본 프로필 범위 외의 범위를 쓰면 승인과 refresh token이 7일 뒤 만료된다 [확인].
- 프로덕션에서도 다음 경우 refresh token이 끊긴다 [확인]:
  - 6개월 동안 쓰지 않음
  - Gmail 범위가 든 토큰은 사용자가 비밀번호를 바꿈
  - 같은 계정·같은 클라이언트의 refresh token이 100개를 넘으면 가장 오래된 것이 경고 없이 무효가 됨
- **6개월 동안 쓰지 않은 OAuth 클라이언트는 자동 삭제**된다. 30일 전에 메일이 오고, 삭제 뒤 30일 안에는 복구할 수 있다 [확인]. 방학 동안 아무도 안 쓰는 경우를 고려해야 한다.

**데스크톱(설치형) 클라이언트를 다르게 취급하는가**
- 검증·경고·상한 규칙이 데스크톱 앱에 따로 적용된다는 문서는 찾지 못했다. 공식 문서에는 차이가 없다 [확인: 차이에 대한 언급 없음].
- 데스크톱은 loopback + PKCE가 권장 방식이고, 복사·붙여넣기(OOB) 방식은 폐지됐다 [확인]. 현재 코드는 이미 이 방식을 쓴다.
- 클라이언트 시크릿:
  - 설치형 앱 문서는 "the client secret is obviously not treated as a secret"라고 한다 [확인].
  - OAuth 정책은 "You must never commit client credentials into publicly available code repositories"라고 한다 [확인].
  - 배포할 때 시크릿을 공개 저장소에 넣지 말아야 한다. 패키지 안에 들어가는 것 자체는 설치형 앱의 성격상 피하기 어려워 회색지대다 [추론].
- **AI 에이전트 표시(2026 신설)**:
  - Workspace MCP 서버를 부를 때만 "Use this client for an AI-powered agent" 표시가 필요하다.
  - 2026-11-11부터 표시 없는 클라이언트의 MCP 요청은 거부된다.
  - REST API만 부르는 앱은 영향을 받지 않는다 [확인]. 이 CLI는 REST만 쓰므로 해당하지 않는다.

**개인 용도 예외의 경계** [확인]
- OAuth 정책: "An app is considered to be for personal use if it's not shared with anyone else or will be used by fewer than 100 people (all of whom are known personally to you)."
- 제한 범위 검증 문서: "if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you."
- 그래서 친한 친구 몇 명은 예외 안이지만, 학과 커뮤니티에 공개 배포하면 예외 밖이다 [추론].

## 3. 검증 요건, 기간, 비용

| 종류 | 대상 | 요건 | 공식 예상 기간 |
|---|---|---|---|
| 브랜드 검증 | 외부·프로덕션 앱이 동의 화면에 앱 이름·로고를 보이려 할 때 | 공개 홈페이지(소유·검증한 도메인, 로그인 페이지만 있으면 안 됨), 같은 도메인의 개인정보처리방침(홈페이지·동의 화면 링크 일치), Search Console로 승인 도메인 소유 확인, 연락처 이메일 | 자동 심사 몇 분, 수동이면 2~3영업일 |
| 민감 범위 검증 | 민감 범위 | 브랜드 검증 + 데모 영상(YouTube 일부 공개, 영어 동의 화면, 주소창의 client ID, 범위별 사용 장면) + 범위별 정당화(더 좁은 범위로 안 되는 이유) + 제한적 사용(Limited Use) 준수 | 개발자 문서 3~5영업일, FAQ 10영업일 |
| 제한 범위 검증 | 제한 범위 | 위 전부 + 허용된 앱 유형 + 보안 평가(CASA) | 약 6주, 매년 재검증 |

- 브랜드를 검증하지 않으면 동의 화면에 앱 이름 대신 **도메인만** 보인다 [확인].
- 실제 대기 사례: 2026-08-07에 낸 Calendar(민감) 범위 검증이 7주 넘게 "검토 중"이었다. 인증 센터에 표시된 예상 기간은 4~6주였다 [일화].

**CASA 보안 평가** [확인 + 일화]
- 공식 문서 기준 [확인]:
  - "If you store or transmit restricted scope data on servers, then you need to complete a security assessment."
  - "Every app that ... has the ability to access data from or through a third-party server must go through a security assessment."
  - 매년 받아야 하고, 승인일(LOA/LOV)로부터 12개월 안에 다시 받는다. 바뀐 것이 없어도 전체를 다시 평가한다.
  - 등급은 AL1/AL2(예전 Tier 2/3)이고, 사용자 수·범위·위험 신호로 **구글이** 정한다.
  - 비용: "Google does not charge the developer any fees for security assessment." 평가 기관 비용은 개발자와 기관이 정하고 개발자가 낸다.
- 비용 [일화, 블로그·벤더 자료]:
  - TAC Security Tier 2(AL1)는 $540~$1,800, Tier 3(AL2)는 약 $4,500.
  - 다른 기관은 Tier 2에 $900~$3,000+.
  - 2026-09 블로그는 예전의 자가 스캔 방식이 폐지됐다고 쓴다 [일화].
- 로컬 전용 앱의 면제 여부:
  - 2019 구글 블로그는 "user data is only ever stored client-side"로 설계하라고 권했다 [확인, 오래된 자료].
  - 현행 정책(Workspace API 사용자 데이터 정책, 2026-09-03 수정)에는 로컬 앱 면제 문구가 **없다** [확인].
  - 이 CLI는 Claude Code가 메일 내용을 Anthropic API로 보내고, 요약을 드라이브에도 올린다. 그래서 "외부 서버를 거친다"에 해당할 가능성이 높다. 2026-09 블로그도 같은 해석을 한다 [추론 + 일화].
- 허용 앱 유형 [확인]: Gmail 제한 범위의 허용 유형에 "생산성 향상(생성형 AI 요약 포함)"과 "메일 정보를 써서 사용자에게 보고·모니터링을 제공하는 앱"이 있다. 학사 일정 추출은 이 유형에 들 가능성이 있다 [추론].
- 2026-09 정책에 추가된 보안 요건 [확인]: 프롬프트 인젝션 방어(Model Armor 등), 에이전트 동작(도구·MCP·스킬 호출)을 사용자가 세밀하게 확인하는 장치. 제한·민감 범위 심사 때 이 요건을 볼 수 있다 [추론].

**개인도 통과할 수 있는가**
- 회사여야 한다는 요건은 공식 문서에서 찾지 못했다. 반대로 개인이 된다는 명시도 없다 [미확인].
- 요건 자체(소유 도메인, 홈페이지, 개인정보처리방침, 지원 이메일, 데모 영상)는 개인도 갖출 수 있다 [추론].
- 도메인 [추론]:
  - 구글은 공개 접미사(public suffix) 기준 "top private domain"의 소유를 확인한다.
  - `github.io`는 공개 접미사 목록에 있어서 `<아이디>.github.io` 자체가 확인 대상이 되고, Search Console로 확인할 수 있을 것이다.
  - 확실하게 하려면 연 1~2만 원대 도메인을 사는 편이 안전하다.
  - `sites.google.com`은 자기 소유로 확인할 수 없어 쓸 수 없다고 본다.

## 4. 제한 범위를 피하는 대안

**(a) 다른 사용자에게서 Gmail 읽기를 빼고 사용자별 옵션으로 둔다 — 권장**
- 배포 클라이언트는 캘린더 범위만 요청한다.
- 지금 코드는 두 범위를 한 번에 요청하므로, 기본은 캘린더만 요청하고 Gmail은 켤 때만 따로 승인받도록 바꿔야 한다.
- 정책도 "Where possible, you must ask for scopes in context with incremental authorization"을 요구한다 [확인].
- Gmail은 (c)의 "자기 클라이언트" 방식으로만 켜게 하면 배포 프로젝트에 제한 범위가 아예 없다.

**(b) `gmail.metadata` 등 더 좁은 Gmail 범위**
- `gmail.metadata`도 **제한** 범위라 피할 수 없다 [확인].
- `gmail.labels`는 민감하지 않지만 메일을 못 읽는다. `gmail.addons.*`는 Gmail 부가기능 안에서만 동작한다.
- IMAP을 OAuth(XOAUTH2)로 쓰려면 `https://mail.google.com/`(제한)이 필요하다. 이 부분은 IMAP OAuth 문서로 직접 확인하지 않았다 [추론].
- 결론: 메일 본문을 읽는 Gmail API 범위 중 제한 범위가 아닌 것은 없다.

**(c) 사용자마다 자기 구글 클라우드 프로젝트·OAuth 클라이언트를 만든다**
- 정책 측면 [추론]:
  - 사용자 본인이 유일한 사용자이므로 개인 용도 예외에 해당한다.
  - 배포자는 OAuth 앱의 개발자가 아니다. 상한도 프로젝트마다 따로 계산된다.
  - 금지 문구는 찾지 못했다.
- 대형 사례 [확인]: rclone은 2026년 안에 공용 client_id를 없애고 모든 사용자에게 자기 클라이언트를 만들게 하고 있다(문서 2026-10-09 수정). 이유는 검증이 아니라 구글 API 할당량 과금 예정 때문이다 [일화: rclone 포럼].
- 학생이 해야 할 일(rclone 안내 기준 11단계):
  1. 프로젝트 생성
  2. Calendar/Gmail API 사용 설정
  3. Auth Platform 브랜딩, 대상 External, 자기 계정을 테스트 사용자로 추가
  4. 데이터 액세스에 범위 추가
  5. 데스크톱 앱 클라이언트 생성, JSON 저장
  6. **프로덕션 게시**(안 하면 7일마다 재로그인)
  7. 로그인할 때 경고 화면 넘기기
- 비기술 학생에게는 스크린샷 안내가 있어도 15~30분이 걸리고, 중간에 막힐 곳이 많다 [추론].
- rclone 문서는 "게시 버튼이 회색이면 브랜딩에 홈페이지·개인정보처리방침 URL과 승인 도메인이 필요하다"고 쓴다. 이를 구글 공식 문서로 확인하지는 못했다 [일화].
- 그 밖의 주의:
  - 쓰지 않으면 6개월 뒤 클라이언트가 자동 삭제된다 [확인].
  - 2026-05-01 이후 만든 프로젝트는 새 표준 할당량을 받는다. 2026년 말부터는 할당량 증가 요청에 결제 계정이 필요하다. 개인 사용량은 표준 할당량 안일 가능성이 높다 [확인 + 추론].
- 현재 코드는 이미 `google-client.json`을 사용자 폴더에서 읽으므로 이 방식을 바로 지원할 수 있다.

**(d) Gmail IMAP + 앱 비밀번호**
- 개인 계정에서는 2026년에도 가능하다 [확인].
  - 앱 비밀번호는 2단계 인증이 켜진 계정에서 만들 수 있다.
  - 보안 키만 쓰는 2단계 인증, 학교·회사 계정, 고급 보호 계정에서는 메뉴가 없다.
  - Gmail IMAP은 2025-01부터 항상 켜져 있다.
- 구글은 "App passwords aren't recommended and are unnecessary in most cases"라고 쓴다 [확인].
- 사용자 계정 전체(메일 전부)에 접근하는 16자리 비밀번호를 CLI가 저장해야 한다. 이 프로젝트는 "비밀번호를 묻거나 저장하지 않는다"는 규칙이 있다. 이 규칙은 KAIST SSO에 대한 것이지만 취지와 충돌한다. 채택하려면 사용자 결정이 필요하다 [추론].
- 구글 OAuth 검증은 필요 없다.

**(e) 학교 메일 시스템(Dooray)을 직접 읽기 — 메모만**
- 두레이 IMAP 지원 여부나 KAIST의 허용 여부는 찾지 못했다 [미확인].
- 포털 SSO 연쇄 로그인(S8a) 위에 메일 사이트를 붙이는 방법도 생각할 수 있다. 다만 새 사이트 허용 목록과 읽기 전용 확인이 필요하다.
- 구글 범위 문제는 사라진다.

**(f) 드라이브 데스크톱만 쓴다(API 없음)**
- 로컬 동기화 폴더(예: `G:\내 드라이브`)에 쓰는 것은 일반 파일 쓰기라서 OAuth가 필요 없다 [추론, 사실상 확실].
- 업로드는 사용자가 로그인한 드라이브 데스크톱 앱이 한다. 구글 도움말은 "Any edits you make to files sync automatically to your computer and to Google Drive"라고 설명한다 [확인].
- 사용자마다 드라이브 데스크톱 설치·로그인이 필요하다. 드라이브 문자와 "내 드라이브" 이름은 언어·설정마다 다르므로 `config.json`의 `driveRoot`를 반드시 설정하게 해야 한다.

**(g) 덧붙임: Apps Script 사본 방식**
- 각 학생이 Gmail에서 학교 메일을 골라 드라이브 파일로 내보내는 Apps Script를 "사본 만들기"로 자기 계정에 둔다. CLI는 그 파일을 드라이브 데스크톱 폴더에서 읽는다.
- 사본마다 사용자가 소유하므로 개인 용도에 가깝다 [추론].
- 공식 문서는 Gmail 계정 소유자 본인도 미검증 경고를 본다고 한다 [확인]. 사본이 사용자 본인 앱으로 취급되는지는 문서에 없다 [미확인].
- (c)보다 설정은 쉽지만 구현과 유지 부담이 하나 더 생긴다.

## 5. 권고 (한 사람이 유지하는 무료 학생 도구)

**유지할 것**
- 캘린더 `calendar.app.created` 하나만 쓰는 배포용 클라이언트
- 드라이브 데스크톱 폴더 쓰기(OAuth 없음)

**뺄 것**
- 배포 클라이언트의 `gmail.readonly`. 제한 범위 검증 6주, 매년 CASA, 연 수십만~수백만 원이 든다.

**선택 기능**
- Gmail 읽기는 "고급: 자기 구글 클라우드 프로젝트로 켜기"(c)로 둔다. 원하면 (d)·(e)는 나중에 결정한다.

**구체적 단계와 일정** (100명 넘게 캘린더 승인받기)

1. **1일차: 분류 확인.** 현재 프로젝트의 데이터 액세스 화면에서 `calendar.app.created`의 분류를 확인한다.
2. **1~2일차: 배포용 새 프로젝트.**
   - 현재 프로젝트는 소유자 개인용(Gmail 포함)으로 남긴다. 이미 쓴 상한 수, 개인 용도 예외, 정지 위험을 배포와 분리하기 위해서다.
   - 새 프로젝트에서는 Calendar API만 켜고 데이터 액세스에 `calendar.app.created`만 등록한다.
   - 데스크톱 클라이언트를 만든다. "AI 에이전트" 표시는 REST 전용이라 필요 없다.
3. **2~4일차: 브랜딩.**
   - 홈페이지와 개인정보처리방침을 같은 도메인에 올린다. GitHub Pages `<아이디>.github.io`나 산 도메인을 쓴다.
   - 개인정보처리방침에는 수집 데이터(만든 캘린더·일정만), 저장 위치(사용자 PC), 공유 없음, 삭제 방법을 쓴다.
   - Search Console로 도메인 소유를 확인한다.
   - 브랜딩(앱 이름, 지원 이메일, 로고는 선택)을 입력하고, 대상 External·프로덕션으로 게시한다. 브랜드 검증은 몇 분~2~3영업일 걸린다.
4. **분기**
   - 민감하지 않은 범위로 나오면: 브랜드 검증만으로 끝난다. 경고 화면과 상한이 없다. 약 1주 안에 배포할 수 있다.
   - 민감한 범위로 나오면: 데모 영상(영어 동의 화면)과 범위 정당화를 내 민감 범위 검증을 받는다. 무료이고 CASA는 없다. 공식 3~10영업일이지만 실제로는 2~8주를 잡는다. 기다리는 동안은 100명 상한 안에서 소수로 베타를 하되, 상한은 평생 소진되므로 아껴 쓴다.
5. **코드 변경(배포 전)**
   - 범위를 나눈다: 캘린더 기본, Gmail은 켤 때만 승인(점진적 승인).
   - 배포용 client JSON은 공개 저장소에 커밋하지 않는다. 릴리스 패키지나 설치 스크립트로 넣는다.
   - 클라이언트 6개월 비활성 삭제에 대비해, 삭제 안내 메일을 받는 연락처를 관리한다.

**구글 외 문제(범위 밖, 메모)**: 다른 학생에게 KLMS·포털 수집 도구를 배포하는 일 자체의 학교 정책·이용약관은 이번에 조사하지 않았다.

## 6. 확인하지 못한 것

- `calendar.app.created`의 공식 분류(가장 중요, 콘솔에서 확인)
- 개인 개발자가 검증을 통과할 수 있다는 구글의 명시적 문구
- `github.io` 하위 도메인이 브랜드 검증 도메인으로 받아들여지는지(공개 접미사 규칙으로 추론만 함)
- 로컬 전용 데스크톱 앱이 CASA에서 면제되는지(현행 정책에 문구 없음)
- CASA 평가 기관의 현재 가격(벤더·블로그 자료만 봄)
- 미검증 앱에서 "고급 > 이동" 버튼 없이 막히는 조건(포럼 일화)
- 프로덕션 게시에 홈페이지·개인정보처리방침 URL이 꼭 필요한지(rclone 문서만 봄)
- 두레이(KAIST 메일) IMAP 지원 여부
- Apps Script 사본이 사용자 본인 앱(개인 용도)으로 취급되는지

## 출처

공식(구글)
- Gmail API 범위와 분류: https://developers.google.com/workspace/gmail/api/auth/scopes
- Calendar API 범위(분류 열 없음): https://developers.google.com/workspace/calendar/api/auth
- 전체 OAuth 범위 목록: https://developers.google.com/identity/protocols/oauth2/scopes
- 동의 화면 구성, 범위 세 분류: https://developers.google.com/workspace/guides/configure-oauth-consent
- 확인되지 않은 앱, 100명 상한: https://support.google.com/cloud/answer/7454865
- 검증이 필요 없는 경우(개인 용도 등): https://support.google.com/cloud/answer/13464323
- 검증 요건: https://support.google.com/cloud/answer/13464321
- 검증 개요: https://support.google.com/cloud/answer/13463073
- 검증 FAQ(기간 표, 평생 상한, 비용): https://support.google.com/cloud/answer/13463817
- 보안 평가(CASA, AL1/AL2): https://support.google.com/cloud/answer/13465431
- 민감 범위 검증: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- 제한 범위 검증: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- 브랜드 검증: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- 브랜딩 관리(미검증 시 도메인만 표시): https://support.google.com/cloud/answer/15549049
- 대상·게시 상태(테스트 7일, 평생 상한): https://support.google.com/cloud/answer/15549945
- OAuth 클라이언트 관리(에이전트 표시, 6개월 비활성 삭제, 시크릿): https://support.google.com/cloud/answer/15549257
- 개인정보처리방침 요건: https://support.google.com/cloud/answer/13806988
- OAuth 2.0 정책(개인 용도 정의, 자격 증명 커밋 금지, 점진적 승인): https://developers.google.com/identity/protocols/oauth2/policies
- OAuth 2.0 개요(refresh token 만료): https://developers.google.com/identity/protocols/oauth2
- 설치형 앱 OAuth(loopback, PKCE, OOB 폐지): https://developers.google.com/identity/protocols/oauth2/native-app
- API 서비스 사용자 데이터 정책: https://developers.google.com/terms/api-services-user-data-policy
- Workspace API 사용자 데이터·개발자 정책(Gmail 허용 유형, 2026-09-03): https://developers.google.com/workspace/workspace-api-user-data-developer-policy
- Workspace 에이전트·API 단계 모델(할당량): https://developers.google.com/workspace/tools-safety
- Calendar API 릴리스 노트(2026-10-12 에이전트 클라이언트): https://developers.google.com/workspace/calendar/release-notes
- Apps Script 클라이언트 검증: https://developers.google.com/apps-script/guides/client-verification
- 앱 비밀번호: https://support.google.com/accounts/answer/185833
- Gmail을 다른 메일 앱에서 쓰기(IMAP 항상 켜짐): https://support.google.com/mail/answer/7126229
- 드라이브 데스크톱: https://support.google.com/drive/answer/10838124
- 구글 개발자 블로그(2019, 클라이언트 측 저장 권고): https://developers.googleblog.com/get-smart-about-preparing-your-app-for-oauth-verification/

포럼·블로그·벤더(일화)
- 데스크톱 + gmail.readonly "This app is blocked"(2026-10-05): https://discuss.google.dev/t/oauth-blocked-before-consent-unable-to-record-verification-demo/401867
- calendar.app.created 분류 질문(답 없음, 2026-08): https://discuss.google.dev/t/oauth-verification-pending-since-22-apr-2026-first-trust-safety-email-never-received/392005
- Calendar 범위 검증 7주+ 대기(2026-09): https://security.googlecloudcommunity.com/cloud-security-foundation-7/oauth-app-verification-stuck-under-review-7-weeks-blocking-calendar-scope-for-production-users-8286
- Nylas, Gmail 제한 범위·CASA 가이드(2026-10-07 수정): https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/
- CASA 비용·AL1/AL2(2026-09): https://deepstrike.io/blog/google-casa-security-assessment-2025
- CASA 비용 비교: https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option
- 구글 OAuth 검증과 CASA, AI 에이전트 관점(2026-09-21): https://www.agenticfabriq.com/blog/google-oauth-verification-casa
- rclone, 자기 client_id 만들기(2026-10-09): https://rclone.org/drive/#making-your-own-client-id
- rclone, 공용 client_id 종료 이유: https://forum.rclone.org/t/google-drive-and-google-photos-users-action-required/54005/
- Epoch, calendar.app.created 사용 예: https://help.epochapp.com/articles/calendar-api-scope-and-permissions
