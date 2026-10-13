# 0단계 기술 검증 보고서

작성일: 2026-10-13
대상: `docs/kaist-agent-design.md` v0.1의 가정 A1~A7
검증 스크립트: `scripts/phase0/` · 샘플/쿠키/토큰: `local/` (`.gitignore` 등록)

> 표기: **[관찰]** 직접 확인한 사실, **[추정]** 관찰에서 추론한 것.
> 주의: V1~V6 동안 `local/`(브라우저 프로필, 쿠키, 토큰, 샘플)은 OneDrive 안의 프로젝트 폴더에 있어서 동기화됐다(사용자 선택). V7을 시작하면서 `%LOCALAPPDATA%\kaist-cli\`로 옮겼다. 아래의 `local/`은 이 위치를 가리킨다.

---

## 1. 요약

| # | 가정 | 판정 | 한 줄 근거 |
|---|---|---|---|
| A1 | Moodle 기반, 로그인 후 일반 HTTP 요청으로 페이지를 읽을 수 있다 | **성립** | Moodle 3.9.1+. 저장한 쿠키로 Node fetch → `/my/` 200, sesskey 포함 |
| A2 | Playwright 브라우저에서 SSO 로그인이 막히지 않는다 | **성립** | 번들 Chromium으로 로그인 성공, 캡차·차단 문구 없음 (1회 시도) |
| A3 | 쿠키를 저장해 두면 일정 시간 재사용된다 | **부분 성립** | 쿠키 파일 재사용은 됨. 단 모든 쿠키가 세션 쿠키라 브라우저 재실행 시 사라짐. 유지 시간은 측정 중 |
| A4 | 수강 과목 목록과 학기 구분을 얻을 수 있다 | **성립** | API로 42과목, `shortname` 접미사 `_2026_3`, `startdate/enddate`, `coursecategory` |
| A5 | 강의자료는 직접 다운로드 가능한 링크로 제공된다 | **부분 성립** | 확인한 파일은 모두 직접 다운로드됨. 게시판 첨부 다운로드와 '다운로드 막힌 웹 뷰어' 자료는 미확인 |
| A6 | 개인용 수집이 이용 규정에 저촉되지 않는다 | **확인 불가** | 명시 조항 없음. 관련 일반 조항과 robots.txt `Disallow: /` 존재 |
| A7 | Moodle 웹서비스 API(모바일 토큰)는 막혀 있다 | **불성립 (열려 있음)** | 모바일 토큰 발급 성공, REST 함수 395개 사용 가능. 단 V7 결과 **토큰 없이 수집 가능**해서 사용하지 않기로 권고 |

---

## 2. 항목별 상세

### V1. 자동화 브라우저 로그인 (A2)

- [관찰] Playwright `launchPersistentContext('local/profile', headless:false)`, 번들 Chromium. 사용자가 SSO 로그인과 폰 승인을 마치는 데 약 35초.
- [관찰] 캡차, 자동화 차단, 경고 문구 없음. 그래서 `channel:'chrome'`/CDP 비교는 하지 않았다.
- [관찰] 거쳐 간 URL (쿼리 제외):
  1. `klms.kaist.ac.kr/login/ssologin.php`
  2. `sso.kaist.ac.kr/auth/kaist/user/login/view` (아이디/비밀번호)
  3. `sso.kaist.ac.kr/auth/twofactor/mfa/login2Factor` (2단계 인증)
  4. `sso.kaist.ac.kr/auth/kaist/user/device/view` (기기 확인 화면으로 추정)
  5. `sso.kaist.ac.kr/auth/user/login/link`
  6. `klms.kaist.ac.kr/` (`body#page-site-index`)
- [관찰] 로그인 완료 신호 (모두 확인됨):
  - `window.M.cfg.sesskey` 존재
  - `a[href*="login/logout.php"]` 존재
  - host가 `klms.kaist.ac.kr`이고 경로가 `/login`으로 시작하지 않음
  - (HTML 분석) body에 `notloggedin` 클래스 없음
- [관찰] 로그인 직후 쿠키 (값은 기록하지 않음):

| 도메인 | 이름 | 만료 | httpOnly | 비고 |
|---|---|---|---|---|
| klms.kaist.ac.kr | MoodleSession | 세션 | O | Moodle 세션 |
| klms.kaist.ac.kr | PHPSESSID | 세션 | X | |
| klms.kaist.ac.kr | 9-rr, 12-rr | 세션 | X | [추정] 로드밸런서 고정 쿠키 |
| sso.kaist.ac.kr | JSESSIONID, authTk | 세션 | O | SSO 세션 |
| sso.kaist.ac.kr | WHATAP, SCOUTER | 2027-11 | X | [추정] 성능 모니터링(APM) 쿠키 |

- 한계: 로그인을 1회만 시도했다. 반복 로그인이나 일정 간격 로그인에서 차단이 생기는지는 확인하지 않았다.

### V2. 세션 재사용과 유지 시간 (A3)

- [관찰] KLMS와 SSO 인증 쿠키는 **모두 세션 쿠키**(만료 시각 없음)다.
- [관찰] **같은 프로필로 브라우저를 다시 열면 로그인이 풀린다.** `/my/` → `login/ssologin.php`로 이동. KLMS 쿠키는 `9-rr`, `MoodleSession`(새로 발급된 것)만 남는다. SSO 쿠키도 사라져 SSO 로그인부터 다시 해야 한다.
  - → 설계 5절의 "persistent context로 쿠키가 남는 동안 재로그인 생략"은 **그대로는 동작하지 않는다**.
- [관찰] 반면 쿠키를 파일(`local/cookies.json`)로 저장해 두고 Node fetch로 보내면 유효하다. 로그인 후 2분과 13분에 확인했다.
- [관찰] 페이지의 `M.cfg.sessiontimeout` = `10800`. [추정] 서버 쪽 유휴 만료가 3시간이다. 요청이 있을 때마다 연장될 가능성이 높다.
- [관찰] 만료/무효 세션 응답 (무효 쿠키·토큰으로 재현):
  - 페이지 GET `/my/` → **303** `Location: /login/index.php`
  - AJAX `/lib/ajax/service.php` → **200** + `{"error":true,"exception":{"errorcode":"servicerequireslogin",...}}`
  - WS REST (무효 토큰) → **200** + `{"errorcode":"invalidtoken"}`
- 측정 진행 중: `npx tsx scripts/phase0/check-session.ts`로 확인하고, 결과는 `local/session-checks.log`에 쌓인다.
  - 주의: 확인 요청 자체가 유휴 타이머를 연장할 수 있다. 실제 유휴 만료를 재려면 확인 간격을 3시간보다 길게 둬야 한다.

| 시점 | 쿠키(HTTP) | WS 토큰 |
|---|---|---|
| 로그인 후 2분 | 유효 | 유효 |
| 로그인 후 13분 | 유효 | 유효 |
| 로그인 후 약 4.5시간 (V7, 15:31) | 유효 (V7 요청 전부 성공) | 사용 안 함 |
| 로그인 후 531분 (23:50, 마지막 요청 후 약 8시간 19분 무요청) | **만료** — 303 → `/login/index.php` | 확인 안 함 |

- [관찰] 15:11~15:31 사이에 요청이 계속 있었고, 세션은 로그인 후 약 4.5시간까지 유지됐다.
- [관찰] 요청 없이 약 8시간 19분이 지나자 만료돼 있었다. 실제 만료 시점은 이 사이 어딘가이고, 이 측정으로는 알 수 없다.
- [추정] `sessiontimeout` 3시간 유휴 만료와 모순되지 않는다. 정확한 유휴 한계를 재려면 마지막 요청 후 2.5시간, 3.5시간에 확인해야 한다. 설계는 "언제든 만료될 수 있다"를 전제로 하므로 구현을 막지 않는다.

### V3. 브라우저 없이 요청 (A1)

- [관찰] `local/cookies.json`의 KLMS 쿠키를 `Cookie` 헤더에 넣고 Node fetch로 요청했다.
  - `/my/` 200, 약 160KB
  - `sesskey`와 logout 링크 있음
  - 과목 페이지, 게시판, 과제, LTI 페이지 모두 200
- [관찰] 모든 요청에 브라우저 형태의 User-Agent를 붙였다. 하위 조사에서 curl 기본 UA로 로그인 페이지를 요청했을 때 `400 Request Blocked`가 났다는 보고가 있었다(직접 재현하지 않음).
  - [추정] UA 기반 차단 규칙이 있을 수 있다.
- **결론: 로그인 이후 수집은 브라우저 없이 HTTP 요청만으로 가능하다.** 브라우저는 로그인 단계에만 필요하다.

### V4. Moodle API (A7)

**V4-a 모바일 웹서비스**
- [관찰] 로그인 없이 `tool_mobile_get_public_config` 호출: `enablewebservices:1`, `enablemobilewebservice:1`, `typeoflogin:1`, `launchurl` = `/admin/tool/mobile/launch.php`
- [관찰] 로그인된 쿠키로 `launch.php?service=moodle_mobile_app&passport=<난수>&urlscheme=moodlemobile` 요청
  - → **302** `moodlemobile://token=<base64>`
  - 디코딩하면 `md5 서명:::토큰:::privatetoken` 세 부분이다.
  - **토큰 발급 성공.** 토큰은 `local/wstoken.txt`에만 저장했다.
- [관찰] 토큰으로 `core_webservice_get_site_info` 호출: release `3.9.1+ (Build: 20200827)`, version `2020061501.12`, 사용 가능 함수 **395개** (`local/samples/ws-functions.txt`)
  - 수집에 쓸 함수는 모두 있다:
    - 과목 구조: `core_course_get_contents`, `core_enrol_get_users_courses`, `core_course_get_updates_since`, `core_course_check_updates`
    - 과제·퀴즈: `mod_assign_get_assignments`, `mod_assign_get_submission_status`, `mod_quiz_get_quizzes_by_courses`
    - 자료·링크·LTI: `mod_resource/folder/url/page/label_get_*_by_courses`, `mod_lti_get_ltis_by_courses`
    - 포럼: `mod_forum_*`
    - 일정: `core_calendar_get_action_events_by_timesort`
  - KLMS 전용 함수: `format_kaistweeks_*`, `theme_oklass39_*`, `local_combine_*`, `local_notifications_*`, `local_lmsnotification_*`, `mod_panoptocourseembed_*`, `local_panopto_track`, `mod_zoom_*`
  - **`mod_courseboard`(공지/게시판) 함수는 없다.**
- [관찰] 사용자 설정의 "보안 키" 메뉴: 설정 페이지에 링크가 없고 `/user/managetoken.php`는 **404**다. 사용자가 화면에서 발급된 토큰을 확인하거나 폐기할 수 없다.
- [관찰] 토큰으로 파일 다운로드 가능: `webservice/pluginfile.php/...?token=` → 200 `application/pdf`
- 미확인: 토큰 유효기간 (V2 측정에 포함해 추적 중)

**V4-b 세션 기반 AJAX**
- [관찰] 페이지의 `"sesskey":"..."`로 `/lib/ajax/service.php?sesskey=` 호출 성공
  - `core_course_get_enrolled_courses_by_timeline_classification` → 과목 42개
    - 필드: `id, fullname, shortname, idnumber, summary, startdate, enddate, visible, viewurl, coursecategory, hidden, ...`
  - `core_calendar_get_action_events_by_timesort` → 4건
    - 필드: `id, name, modulename, instance, eventtype, timestart, timesort, timemodified, course, url, action, ...`
    - 시각은 유닉스 초

### V5. 페이지 구조 (A4, A5)

조사 과목: 바이오 공학개론 (2024 봄, id 155279, 사용자 지정). 지난 학기 과목도 접근할 수 있었다. 영상과 파일 형식은 이번 학기 7개 과목의 API 결과로 보충했다.

**과목 목록과 학기**
- [관찰] API/AJAX로 수강 과목 전체(지난 학기 포함 42개)를 받는다.
- [관찰] 학기 구분 방법은 세 가지다:
  - `shortname` 접미사 `_<연도>_<학기코드>` (가을 = `_3`, 봄 = `_1`)
  - `startdate/enddate`
  - `coursecategory` ("Fall"/"Spring")
- [관찰] 2026 가을 학기 과목은 7개다.

**주차/섹션**
- [관찰] KLMS 전용 코스 포맷 `format_kaistweeks`
  - HTML: `ul.kaistweeks > li.section#section-N`
  - 섹션 이름: `h3.sectionname`. HTML에는 "N주차" 뒤에 `<em>YYYY.MM.DD ~ YYYY.MM.DD</em>` 날짜가 붙는다.
- [관찰] API `core_course_get_contents`: 섹션 17개("과정공통", "1주차", ...)
  - 섹션 이름에 날짜는 없다.
  - 모듈 필드: `id(cmid), url, name, instance, modname, modicon, customdata, ...`

**활동 유형** (이번 학기 7과목 합계: lti 81, resource 68, courseboard 22, assign 15, url 18, label 4, choice 1)

| 유형 | 식별 | URL 형식 | 비고 |
|---|---|---|---|
| 파일 | `modname=resource`, HTML `li.modtype_resource` | API `webservice/pluginfile.php/<ctx>/mod_resource/content/<rev>/<파일명>?forcedownload=1`; HTML은 `M.course.format.downloadFile('…/pluginfile.php/…')` | `resource/view.php`는 303으로 pluginfile에 리다이렉트. 68개 모두 fileurl 있음 (pdf 60, pptx 8, doc 1) |
| 과제 | `assign` | `mod/assign/view.php?id=<cmid>` | 아래 참조 |
| 공지/게시판 | `courseboard` (**KLMS 전용**) | 목록 `mod/courseboard/view.php?id=<cmid>[&page=N]`, 글 `article.php?id=<cmid>&bwid=<글ID>` | **API 없음 → HTML 파싱만 가능** |
| 영상 | `lti` (Panopto LTI 1.3) | `mod/lti/view.php?id=<cmid>` | 아래 참조 |
| 외부 링크 | `url` | `contents[0].fileurl`에 외부 URL (예: youtu.be) | |
| 폴더, 퀴즈 | `folder`, `quiz` | — | 조사한 과목들에 없음. 미확인 |

**파일 다운로드 (A5)**
- [관찰] 작은 파일 1개(1.1MB pdf)를 쿠키 + `pluginfile.php`로 다운로드했다.
  - 200 `application/pdf`
  - 크기가 API `filesize`와 일치하고 PDF 헤더도 정상이었다.
- [관찰] 토큰 + `webservice/pluginfile.php`도 200이었다(본문은 받지 않음).
- [관찰] 이번 학기 파일 3개에 HEAD 요청: 토큰·쿠키 모두 200 `application/pdf`
- [관찰] 하위 조사에서 찾은 2021년 카이스트신문 기사: 교수 동의가 없으면 다운로드가 막힌 웹 뷰어로 제공된다는 정책.
  - 이번에 확인한 파일은 모두 직접 받을 수 있었다.
  - 뷰어 전용 자료가 실제로 있는지, 있다면 API에서 어떻게 보이는지는 미확인이다.

**과제**
- [관찰] HTML은 표준 Moodle과 같다.
  - 설명: `#intro`
  - 제출 상태 표: `.submissionstatustable` (제출 상태, 채점 상태, 마감 일시, 남은 시간, 마지막 수정)
  - 마감 표기 예: `2024년 3월 30일(토요일) 오전 12:00`
  - 과목 페이지에는 `strong.end-dt` `YYYY-MM-DD HH:MM ~ YYYY-MM-DD HH:MM`(KST)도 표시된다.
- [관찰] API `mod_assign_get_assignments`
  - 필드: `id, cmid, name, intro(HTML), introattachments[], duedate, allowsubmissionsfromdate, cutoffdate, gradingduedate, timemodified`
  - 시각은 유닉스 초. 예: `duedate` 1711724400 = KST 2024-03-30 00:00이고 HTML 표시와 일치한다.
  - 첨부 URL: `webservice/pluginfile.php/<ctx>/mod_assign/introattachment/0/<파일명>`
- [관찰] API `mod_assign_get_submission_status`: `lastattempt.submission.status`("new" 등), `gradingstatus`, `timemodified`

**공지/게시판 (courseboard)**
- [관찰] 과목당 게시판 3개(공지 / Q&A / 일반)
  - 종류는 `modicon` 파일명 `icon_notice` / `icon_qna` / `icon_default`로 구분할 수 있다.
- [관찰] 목록: `table.courseboard_table tbody tr`
  - 칸: 번호 / 제목 링크 / 작성자 / 작성일 / 조회수
  - 작성일은 `YYYY-MM-DD` 날짜만 있다.
  - 첨부가 있으면 제목 칸에 `img[alt=attach]`
  - 페이지네이션: `&page=N`, 기본 15개
- [관찰] 글
  - 제목: `.subject h3`
  - 본문: `.content .text_to_html`
  - 작성일시: `.info .date`, 예: `2024년 6월 6일(목요일) 오후 8:11`
  - 첨부: `pluginfile.php/<ctx>/mod_courseboard/attachment/<bwid>/<파일명>?forcedownload=1`
  - **수정 시각 없음.**
- 미확인: 게시판 첨부파일을 실제로 다운로드할 수 있는지. 상단 고정 공지, 비밀글, 답글 표시.

**영상**
- [관찰] 영상은 Panopto LTI 1.3(`kaist.ap.panopto.com`)으로 제공된다. 스트리밍이며 KLMS 쪽에 파일은 없다.
  - 개별 강의 영상이 각각 `lti` 활동으로 등록된 과목도 있다(예: `2026_lecture3_part1`).
  - 과목 전체용 "Panopto Course Tool" 하나만 있는 과목도 있다.
- [관찰] 제목은 API `name`, 링크는 `mod/lti/view.php?id=<cmid>`로 얻을 수 있다. 게시일과 수정 시각은 API에 없다.
- [관찰] 영상은 받지 않았다. Panopto 내부 영상 목록은 KLMS HTML에 없다.

**고유 ID와 수정 시각 (증분 수집용)**

| 항목 | 고유 ID | 수정 시각 |
|---|---|---|
| 활동 공통 | cmid (`modules[].id`, URL `?id=`) | 유형별로 다름 |
| 파일 | cmid + `contents[].fileurl`의 revision | `contents[].timemodified`, `contentsinfo.lastmodified` |
| 과제 | `assign.id` / cmid | `timemodified`, 첨부의 `timemodified` |
| 게시글 | `bwid` | **없음** (작성일만) → 본문 해시로 변경 감지 필요 |
| 영상(lti) | cmid | **없음** |

**KLMS 커스터마이징 (표준 Moodle과 다른 점)**
- 코스 포맷 `format_kaistweeks`, 테마 `oklass39`. [추정] Ubion사 제품군이다.
- 파일 활동에 `view.php` 링크가 없고 `M.course.format.downloadFile()`로 바로 다운로드된다.
- 공지/게시판이 표준 forum이 아닌 `mod_courseboard`이고 API가 없다.
- 활동 항목에 기간(`strong.end-dt`)과 상태(`strong.status`) 표시가 추가되어 있다.
- 사용자 설정의 "보안 키" 페이지가 제거되어 있다.
- CLASSUM, 출석(`local/lmsattendance`), Panopto 통계 메뉴, 모바일 "세션 연장" 버튼이 있다.

### V6. 이용 규정 (A6)

웹 검색과 공개 원규 원문(rule.kaist.ac.kr)으로 조사했다. 로그인 후 볼 수 있는 약관 페이지는 확인하지 않았다(아래 4절 참조).

- **자동 수집·크롤링을 직접 다룬 조항: 명시 조항 없음.** KLMS 이용약관도 따로 없다(로그인 페이지에 개인정보처리방침 링크만 있음).
- 관련 일반 조항 (정보보안지침, https://rule.kaist.ac.kr/lmxsrv/law/lawFullContent.do?SEQ_HISTORY=3486):
  - 제75조①6호: 비밀번호 공유 금지
  - **제75조①7호: "응용프로그램 등을 이용한 자동 비밀번호 입력기능을 사용하지 말 것"**
    - → 현재 설계(비밀번호는 사용자가 직접 입력)와 충돌하지 않는다. 비밀번호 자동 입력은 앞으로도 넣지 않아야 한다.
  - 제80조②⑥: 정보자원은 교육 등 목적으로만 사용, 개인 이익·상업용 금지
  - 제80조③: "개인에게 부여한 사용 권한 내에서 허락받은 사용 목적과 용도로만 사용"
  - 제81조①: 타인 계정 사용, 목적 외 사용, 정상 운용 방해 시 제재
- 전산망 운영지침 제10·11조: 과다 트래픽이면 사용 제한 가능, 허가받은 목적으로만 사용
- 학칙 제59조 6호: 정보시스템 정상가동 방해는 징계 사유
- [관찰] `klms.kaist.ac.kr/robots.txt`: `User-agent: * / Disallow: /`. 법적 구속력은 없지만 운영자의 의사 표시다.
- **강의자료 취급**
  - 온라인 교과목 운영지침 제9조: 강의 콘텐츠 저작권은 교수에게 있고 무단 복사·활용 불허. 온라인 교과목 콘텐츠에만 해당한다.
  - 정보보안지침 제81조①사목: 저작권 콘텐츠를 불법 유통하면 보안위규
  - 학생의 개인 저장이나 재배포를 직접 다룬 KLMS 조항: 명시 조항 없음
- 판단: 본인 계정, 본인 과목, 개인 학습용, 낮은 빈도로 수집하는 것을 금지하는 명시 조항은 찾지 못했다. 허용하는 조항도 없다. "허락받은 사용 목적"에 해당하는지는 학교 해석에 달려 있어 **확인 불가**로 판정한다.
  - 확실히 하려면 KLMS 헬프데스크(klms@kaist.ac.kr)나 정보보안팀에 문의해야 한다.
  - 드라이브에 저장한 자료를 공유하거나 재배포하면 저작권 문제가 될 수 있으므로 하지 않는다.

### V7. 세션 방식 API 범위 (추가 검증, 2026-10-13)

지시문: `docs/phase0-addendum-ajax.md`. 쿠키와 sesskey만으로 `/lib/ajax/service.php`를 호출해, 토큰 없이 수집할 수 있는지 확인했다.

- 준비: `local/`을 OneDrive 밖 `%LOCALAPPDATA%\kaist-cli\`로 옮기고 스크립트 경로를 고쳤다.
  - 옮길 때 OneDrive 쪽 사본은 삭제되어 OneDrive 휴지통으로 갔다.
- 대상 과목: 바이오 계측기초(2026 가을, id 186294, 사용자 지정)
  - 이 과목에 과제가 없어서, 과제 검증에는 사용자 승인을 받아 확률및통계(id 189782)를 추가로 썼다.
- **토큰 사용 내역: 없음.** `launch.php` 호출 없음. 필드 비교는 0단계에 디스크에 저장해 둔 토큰 방식 샘플 파일로만 했다.

**함수별 결과** (모두 HTTP 200. 실패는 응답 본문의 `errorcode`)

| 용도 | 함수 | 결과 | 비고 |
|---|---|---|---|
| 과목 목록 | `core_course_get_enrolled_courses_by_timeline_classification` | 성공 | `classification:'inprogress'` → 17개 |
| 다가오는 마감 | `core_calendar_get_action_events_by_timesort` | 성공 | 미완료 action 이벤트만 |
| 과목 구성 | `core_course_get_contents` | **실패** `servicenotavailable` | AJAX 비허용 함수 |
| 과제 목록·마감 | `mod_assign_get_assignments` | **실패** `servicenotavailable` | 〃 |
| 제출 상태 | `mod_assign_get_submission_status` | **실패** `servicenotavailable` | 〃 |
| 퀴즈 | `mod_quiz_get_quizzes_by_courses` | **실패** `servicenotavailable` | 〃 |
| 자료 메타 | `mod_resource/folder/url/page_get_*_by_courses` | **실패** `servicenotavailable` (4개 모두) | 〃 |
| LTI | `mod_lti_get_ltis_by_courses` | **실패** `servicenotavailable` | 〃 |
| 증분 | `core_course_get_updates_since` | 성공 | 모듈별 `updates[{name:"configuration", timeupdated}, {name:"contentfiles", itemids}]` |
| 증분 | `core_course_check_updates` | 성공 | |
| 과목별 일정 | `core_calendar_get_calendar_events` | **실패** `servicenotavailable` | |
| 과목별 일정 | `core_calendar_get_action_events_by_course` | 성공 | 이 과목은 0건 |
| (대체 후보) | `core_calendar_get_calendar_monthly_view` | 성공 | **과제 마감 대체 수단** (아래) |
| (대체 후보) | `core_calendar_get_calendar_upcoming_view` | 성공 | |
| (대체 후보) | `core_calendar_get_calendar_event_by_id` | 성공 | 설명(description) 포함 |
| (대체 후보) | `core_course_get_course_module(_by_instance)` | **실패** `servicenotavailable` | |
| (대체 후보) | `theme_oklass39_get_user_semesters`, `theme_oklass39_get_summary_activity`, `format_kaistweeks_activity_average` | `invalidparameter` | AJAX로는 열려 있으나 인자 형식을 몰라 더 탐색하지 않음 |

- 실패 원인은 모두 `servicenotavailable`("웹서비스를 사용할 수 없습니다")로 같다. 권한 오류(`accessexception`)나 인자 오류(`invalidparameter`)가 아니라, 세션 방식(AJAX)에서 허용되지 않는 함수라는 뜻이다. [추정] Moodle 함수 정의의 `ajax => true` 여부에 따른 것이다.
- 성공한 함수와 토큰 방식 샘플의 필드를 비교할 수 있는 경우가 없었다. 토큰 방식 샘플이 있는 함수들이 모두 실패했기 때문이다.

**실패한 함수의 대체 수단**

| 필요한 정보 | 대체 수단 | 검증 결과 |
|---|---|---|
| 과목 구성(주차, 활동, cmid) | `course/view.php?id=<과목>&section=0` HTML | [관찰] 기본 `view.php`는 현재 주차 근처 4개 섹션만 보여준다. `section=0`은 `format_kaistweeks`의 "모두" 보기다(`M.course.format.dayselect(0,…)`의 정체, 설정 변경 없이 URL 파라미터만 바뀜). 한 장에 17개 섹션이 다 나오고, 모듈 76개(lti 32, url 18, resource 19, courseboard 5, label 2)가 API와 **cmid까지 100% 일치** |
| 파일 URL·변경 감지 | 같은 HTML의 `onclick="M.course.format.downloadFile('…/pluginfile.php/<ctx>/mod_resource/content/0/<파일명>', …)"` | [관찰] 19개 전부 추출. **`pluginfile.php`(쿠키용) 형식**이다. 쿠키로 HEAD 1건 → 200 `application/pdf`, `Last-Modified`, `ETag`(40자리 hex, [추정] sha1 내용 해시), `Content-Length` 제공 → API `timemodified` 없이 변경 감지 가능. HTML 안 따옴표가 `&#039;`로 이스케이프되어 있으니 HTML 파서로 읽어야 한다 |
| 증분 | `core_course_get_updates_since` (AJAX 성공) | [관찰] 모듈별 설정·파일 변경 시각/ID 제공 |
| 과제 마감 | `core_calendar_get_calendar_monthly_view` (월별, 학기 4회) | [관찰] 확률및통계 과제 6개의 `due` 이벤트를 전부 얻음. 시각은 **유닉스 초**. 6개 모두 과목 페이지 `strong.end-dt`의 끝 시각, 과제 페이지의 "마감 일시"와 일치 (예: `1283626` → 캘린더 2026-09-15 00:00 KST = `2026-09-07 00:00 ~ 2026-09-15 00:00` = `2026년 9월 15일(화요일) 오전 12:00`) |
| 〃 (주의) | | [관찰] **캘린더 이벤트의 `instance`가 과제 ID가 아니라 cmid다.** 표준 Moodle과 다른 KLMS 특이사항이다. 과제 ID로 맞추면 하나도 매칭되지 않는다 |
| 과제 설명·첨부 | `mod/assign/view.php?id=<cmid>` HTML | [관찰] `#intro` 있음, `introattachment` pluginfile 링크 1개 확인 |
| 제출 상태 | 과제 페이지 `.submissionstatustable` HTML | [관찰] "제출 상태: 채점을 위해 제출되었습니다", "채점 상태", "마감 일시", "마지막 수정"(한국어 날짜) |
| 〃 (보조) | 과목 페이지 `strong.status` | [관찰] "종료 / 기한경과 / 진행중". [추정] 기간 상태일 뿐 제출 여부와 1:1이 아니므로 제출 상태로 쓰지 않는다 |
| 영상(LTI) | 과목 HTML의 `modtype_lti` 항목 | [관찰] 32개 제목과 cmid 전부 추출 |
| 퀴즈 | 캘린더 open/close 이벤트 + `mod/quiz/view.php` HTML | **미검증.** 조사한 과목들에 퀴즈가 없다 |
| 폴더 | `mod/folder/view.php` HTML | **미검증.** 조사한 과목들에 폴더가 없다 |

**결론: 토큰 불필요**

- 1차 수집 대상(과목, 주차 구성, 과제 마감·설명·첨부·제출 상태, 공지, 자료 파일, 영상 링크)을 모두 쿠키+sesskey AJAX와 HTML로 얻을 수 있다.
- 가장 중요한 과제 마감은 AJAX 캘린더에서 **유닉스 초**로 오고, HTML 두 곳(`end-dt`, 과제 페이지)과 교차 검증까지 된다.
- 과목 구성 HTML은 API와 cmid 단위로 완전히 일치했다.
- 토큰이 추가로 주는 것은 구조화된 제출 상태와 퀴즈 메타 정도다. 둘 다 HTML로 대체할 수 있고(퀴즈는 미검증), 폐기할 수 없는 장기 자격증명을 정당화할 만큼의 가치는 아니다.
- 단서: 퀴즈와 폴더는 미검증이다. 해당 활동이 있는 과목이 생기면 확인하고, 부족하더라도 토큰이 아니라 HTML 보강으로 해결한다.

---

## 3. 설계 변경 제안

> 이 절의 결정은 검증 결과를 바탕으로 한 권고안이다. 사용자가 5절 질문에 답한 뒤 설계 v0.2에 반영한다.

### 3.1 수집 방식: 쿠키 기반 (세션 AJAX + HTML 파싱), 토큰 사용 안 함 — V7 반영으로 수정

> 처음 권고는 "토큰 REST API 주력"이었다. V7에서 세션 방식만으로 필요한 정보를 모두 얻을 수 있음이 확인되어 바꿨다.

| 정보 | 소스 | 방식 | 위험 |
|---|---|---|---|
| 로그인 | Playwright (창 표시) | SSO 로그인 1회, 쿠키 추출 후 즉시 종료 | |
| 수강 과목·학기 | `core_course_get_enrolled_courses_by_timeline_classification` (AJAX) | `shortname` 접미사·`startdate`·`coursecategory`로 학기 필터 | 낮음. 필터 결과가 0건이면 실패로 처리 |
| 주차 구성·모듈 목록 | `course/view.php?id=X&section=0` HTML | 섹션/모듈 파싱, cmid가 키 | 중간. 테마가 개편되면 파서가 깨진다 → 3.2 불변식으로 감지 |
| 모듈 변경 감지 | `core_course_get_updates_since` (AJAX) | 마지막 sync 이후 모듈별 변경 시각 | 낮음. 재파싱 범위를 줄이는 보조 신호 |
| 강의자료 파일 | HTML `downloadFile(...)` → `pluginfile.php` (쿠키) | HEAD로 `ETag`/`Last-Modified`/`Content-Length`를 비교한 뒤 GET, 이전 버전 보관 | 낮음. 폴더 모듈은 미검증 |
| **과제 마감 (값)** | `core_calendar_get_calendar_monthly_view` (AJAX) | 학기 시작 월부터 종료+1개월까지 월별 조회, `eventtype=due`, `instance`=cmid로 매핑 | 중간. 월 누락, 개인·그룹 override 이벤트 중복 → 3.2 |
| 과제 마감 (교차검증) | 과목 페이지 `strong.end-dt`, 과제 페이지 "마감 일시" | KST 문자열을 유닉스 초로 바꿔 캘린더 값과 비교 | 불일치는 오류 신호로만 쓰고, 값으로는 쓰지 않는다 |
| 과제 설명·첨부 | `mod/assign/view.php?id=<cmid>` HTML | `#intro` 본문, introattachment 링크 | 낮음 |
| 제출 상태 | 과제 페이지 `.submissionstatustable` HTML (+ action 이벤트는 보조) | 알려진 문자열을 매핑하고, 모르는 문자열은 `unknown` | 중간. 한국어 문자열에 의존 |
| 퀴즈 | 캘린더 open/close 이벤트 + `mod/quiz/view.php` HTML | 과제와 같은 구조 | **미검증** |
| 공지·게시판 | `mod/courseboard` 목록·`article.php` HTML | `bwid`가 키, 첨부는 pluginfile | 중간. 수정 시각이 없어 본문 해시로 변경 감지 |
| 영상 | HTML의 lti 모듈 | 제목·cmid·URL만 저장 | 낮음 |

- 근거:
  - 마감 값은 캘린더 AJAX에서 **유닉스 초**로 온다. 설계 13절에서 "실제 피해로 이어지는 유일한 위험"으로 꼽은 마감 파싱 오류를 토큰 없이도 피할 수 있다.
  - 과목 구성 HTML은 API와 cmid 단위로 일치했다.
  - 토큰은 수명을 모르고 사용자가 폐기할 수 없으므로 쓰지 않는 쪽이 낫다.
- 버린 대안:
  - 토큰 REST API 주력: V7 결과 얻는 이득(구조화된 제출 상태, 퀴즈 메타)이 작다. 폐기할 수 없는 장기 자격증명이라는 위험을 감수할 이유가 없다.
  - 전부 Playwright: 느리고 개편에 가장 취약하다. V3에서 필요 없음이 확인됐다.
- **CLI에는 `launch.php`, `webservice/rest`, `tool_mobile_*` 호출 코드를 넣지 않는다.** 옵션으로도 두지 않는다.
- 설계 4절 구조도의 klms 모듈은 "세션 쿠키 + sesskey AJAX 클라이언트 + HTML 어댑터(과목 페이지, 과제, courseboard)"로 바꾼다.

### 3.2 HTML 의존으로 늘어난 위험과 완화책, 수집 원칙

**마감 정확도** (실제 피해로 이어지는 유일한 항목)
- 마감 값은 항상 캘린더의 유닉스 초만 쓴다.
- 캘린더 값과 HTML `end-dt`가 다르면 그 과제는 구글 캘린더에 쓰지 않는다. 대신 `needs_review`로 출력한다. 둘 중 하나를 조용히 고르지 않는다.
- 월 누락 방지: 받은 due 이벤트의 cmid 집합이 HTML에서 마감이 보이는 과제 cmid 집합을 모두 포함하는지 확인한다. 빠진 과제는 HTML `end-dt`로 보충하고 `source=html`로 표시한다.
- 같은 cmid에 due 이벤트가 여럿이면 우선순위는 본인(userid) → 그룹 → 과목 전체다. 그래도 후보가 둘 이상 남으면 `needs_review`로 둔다.
- `instance`=cmid는 KLMS 특이사항이다. 어댑터 한 곳에서만 해석하고, 매 sync마다 instance가 HTML cmid 집합에 들어 있는지 검사한다. KLMS가 표준(과제 ID)으로 돌아가는 경우를 잡기 위해서다.
- HTML 날짜 파싱은 Asia/Seoul 고정으로 한다. "오전 12:00 = 00:00"은 테스트로 명시한다. 초기 몇 주는 KLMS와 직접 대조한다(설계 13절).

**개편 감지** (조용히 틀리는 것 방지)
- 불변식 1: HTML에서 파싱한 cmid 집합과 `core_course_get_updates_since`(since=0)의 cmid 집합이 같아야 한다. 다르면 파서 고장으로 보고 그 과목의 sync를 중단한다. [추정] since=0이면 전체 모듈이 나온다. 확인이 필요하다.
- 불변식 2: 과목마다 섹션 수와 모듈 수가 0보다 커야 한다. 파일 모듈에서 `downloadFile` 링크 추출률은 100%여야 한다.
- 불변식 3: 테마(`oklass39`)와 themerev 값을 저장해 두고, 바뀌면 "KLMS 변경 감지" 경고를 띄운 뒤 불변식 전부를 다시 돌린다.
- 셀렉터는 어댑터 파일 한 곳에 상수로 모은다. `kaist doctor <과목>` 같은 점검 명령을 둔다. 최근 HTML 원문을 드라이브 밖에 1회분 보관해 고장을 재현하는 테스트 자료로 쓴다.

**제출 상태**: 과목 페이지 `strong.status`(종료/기한경과/진행중)는 기간 상태로만 저장하고, 제출 여부로 해석하지 않는다.

**수집 원칙** (0단계 3.2에서 유지)
1. 요청은 직렬 또는 동시 2개 이하로 보내고 간격을 둔다. 대상은 이번 학기 과목만이다. 증분은 `core_course_get_updates_since`로 줄인다.
2. 수강 과목 외 영역(사용자 검색, 다른 과목 탐색)은 건드리지 않는다. robots.txt `Disallow: /`를 존중하는 범위다.
3. 교수가 다운로드를 막은 자료는 우회하지 않고 "뷰어 전용"으로 목록에만 기록한다.
4. 상태를 바꾸는 요청(제출, 글쓰기, 설정 변경)은 코드에 넣지 않는다.

**이미 발급된 토큰**
- 0단계에서 토큰 1개가 발급됐다. 서버에서 사용자가 지울 수 없다.
- [추정] `launch.php`를 다시 호출하면 같은 토큰을 다시 쓰게 되므로 호출하지 않는다.
- `%LOCALAPPDATA%\kaist-cli\wstoken.txt`에 남아 있다. 다른 파일에는 토큰 문자열이 없다. `launch.php` 응답 원문(privatetoken 포함)도 저장되지 않았다.
- `local/`이 OneDrive 안에 있던 동안 이 파일은 클라우드에 동기화됐다. 옮길 때 OneDrive 쪽 사본은 OneDrive 휴지통으로 갔다.
- 권고:
  - `wstoken.txt`를 삭제하고 OneDrive 휴지통과 버전 기록도 비운다(5절 질문 5).
  - 서버의 토큰은 "다시 쓰거나 재발급하지 않고 그대로 둔다"를 기본안으로 한다.
  - 위험을 완전히 없애려면 KLMS 운영팀에 토큰 삭제를 요청할 수 있다(선택).
- 설계 v0.2 13절 위험 요소 표에 "토큰 발급 사실과 미사용 결정"을 한 줄 기록한다.

### 3.3 로그인 완료 판별

- SSO 중간 URL은 신호로 쓰지 않는다(바뀔 수 있음). 다음 세 조건이 **모두 참**이면 완료로 본다:
  1. 현재 URL의 host가 `klms.kaist.ac.kr`이고 경로가 `/login/` 아래가 아님
  2. `window.M?.cfg?.sesskey`가 문자열
  3. body에 `notloggedin` 클래스 없음
- 완료 후 `klms.kaist.ac.kr` 쿠키를 **전부** 저장한다(`9-rr`/`12-rr` 로드밸런서 쿠키 포함. [추정] 빠지면 다른 서버로 가서 세션이 안 붙을 수 있음).
- 브라우저를 닫기 전에 Node fetch로 세션 프로브(3.4)를 한 번 통과시켜 확인한다.

### 3.4 세션 만료 감지

- **sync 시작 시 프로브**: `GET /my/` (redirect manual). 200이고 `sesskey`가 있으면 유효, 3xx이고 Location이 `/login/index.php` 또는 `ssologin.php`이면 만료.
- **요청 중 만료 판별** (함수 하나로 통일):
  - 페이지/파일 GET: 3xx → 로그인 경로, 또는 파일을 기대했는데 `text/html`이 옴 → 만료
  - AJAX: `errorcode: servicerequireslogin` → 만료. `invalidsesskey`이면 sesskey를 다시 얻어 1회 재시도
  - AJAX `servicenotavailable`: 만료가 아니라 허용되지 않는 함수다. 코드 오류로 보고 즉시 실패시킨다(V7). `accessexception`은 권한 문제로 보고 해당 항목만 건너뛴다
- 만료로 판별되면 받은 데까지 저장하고 재로그인을 요청한다(설계 5절 6항 유지).

### 3.5 인증 흐름(설계 5절) 변경

- **"persistent context로 쿠키가 남는 동안 재로그인 생략"은 삭제한다.** 브라우저를 다시 열면 세션 쿠키가 사라진다(V2).
- 세션의 저장소는 CLI가 관리하는 쿠키 파일이다(드라이브 밖, 예: `%LOCALAPPDATA%/kaist-cli/session.json`).
- 새 흐름:
  1. 쿠키 파일 로드 → 프로브 → 유효하면 브라우저 없이 바로 수집
  2. 만료면 Playwright로 로그인 → 쿠키 추출·검증 → 브라우저 종료
  3. sesskey는 매 sync마다 프로브 응답에서 얻어 메모리에만 둔다 (토큰은 쓰지 않음)
  4. 수집 중 만료되면 체크포인트 저장 후 2로
- persistent profile은 세션 보존용이 아니다. 비밀번호 자동완성(5절 질문 2)이나 SSO 기기 등록 유지가 필요할 때만 남긴다. 필요 없으면 매번 새 컨텍스트를 쓴다.
- 추가 측정 후보 (결정 아님): SSO 쿠키(`JSESSIONID`, `authTk`)를 저장해 두었다가 KLMS 세션 만료 후 주입하면 폰 승인 없이 KLMS 세션이 재발급되는지. 된다면 승인 횟수가 준다.

### 3.6 가정 표(11절) 갱신안

- A1: 성립 → "수집은 HTTP 요청만으로 가능"
- A3: "쿠키 파일로는 재사용 가능, 브라우저 프로필로는 불가. 유휴 만료 약 3시간 추정"
- A5: "확인한 범위에서 성립. 뷰어 전용 자료는 미확인"
- A7: "열려 있으나 사용하지 않음 (V7: 세션 AJAX + HTML로 충분)"
- 새 가정 A8: "과목 구성, 과제 설명·제출 상태, 공지/게시판은 HTML 파싱에 의존하므로 개편에 취약" → 13절 위험 요소에 추가하고 3.2 불변식으로 감지
- 새 가정 A9: "캘린더 월별 뷰의 due 이벤트가 모든 과제를 포함한다" (6/6 확인, 퀴즈는 미검증)

---

## 4. 확인하지 못한 것과 이유

| 항목 | 이유 |
|---|---|
| 세션 장시간 유지(30분, 2시간, 다음 날)와 실제 만료 응답 | 시간이 지나야 확인할 수 있다. 사용자 실행 필요 (5절) |
| WS 토큰 유효기간 | 토큰을 쓰지 않기로 해서(V7) 측정을 중단했다. `check-session.ts --token`으로만 확인할 수 있다 |
| (V7) 퀴즈, 폴더의 세션 방식 대체 수단 | 조사한 과목들에 해당 활동이 없었다 |
| (V7) override 이벤트(개인·그룹 마감 연장) 처리 | 사례가 없었다 |
| (V7) `core_course_get_updates_since`(since=0)가 전체 모듈을 돌려주는지 | 시험하지 않았다 (7일 범위로만 호출) |
| (V7) `theme_oklass39_*`, `format_kaistweeks_*` 함수의 인자 | 인자 형식을 몰라 더 탐색하지 않았다. 대체 수단이 이미 충분했다 |
| 반복 로그인 시 차단 여부, Chrome 채널/CDP 비교 | 1회 로그인이 문제없이 성공해 비교할 필요가 없었다. 반복 로그인은 요청 최소화 원칙 때문에 하지 않았다 |
| 폴더, 퀴즈, 포럼(표준) 활동 구조 | 조사한 과목들에 해당 활동이 없었다 |
| 다운로드가 막힌 '웹 뷰어' 자료 | 확인한 파일이 모두 다운로드 가능해 사례를 찾지 못했다 |
| 게시판 첨부파일 실제 다운로드, 고정 공지·비밀글 표시 | 요청 최소화를 위해 시도하지 않았다. 링크 형식만 확인했다 |
| 과제 첨부파일(HTML 쪽 마크업) | 샘플 과제에 첨부가 없었다. API 형식은 확인했다 |
| Panopto 내부 영상 목록, 게시일 | 별도 인증이 필요하다. 영상 관련 범위 밖이라 시도하지 않았다 |
| 로그인 후에 보이는 KLMS 약관·도움말 | 로그인 영역에서 약관 링크를 찾지 못했고, 따로 탐색하지 않았다 |
| `curl` UA 차단 재현 | 하위 조사의 관찰이다. 직접 재현하지 않았다 |

---

## 5. 사용자에게 물어볼 것

1. ~~WS 토큰을 수집에 쓸지~~ → V7 결과에 따라 **쓰지 않는 것으로 권고를 바꿨다** (3.1). 동의하는지만 확인해 달라.
2. **비밀번호 입력 방식** (권고: 수동)
   - 브라우저 자동완성을 쓸지, 매번 직접 입력할지.
   - 정보보안지침 제75조①7호("자동 비밀번호 입력기능 사용 금지")를 문자 그대로 읽으면 브라우저 자동완성도 해당될 수 있다.
3. **승인 횟수를 줄이는 수단을 시도할지** (권고: 1차는 sync마다 승인, 측정 결과를 보고 재검토)
   - 주기적 요청으로 3시간 유휴 만료를 막거나, SSO 쿠키 재사용을 시도하는 방법이 있다.
   - 설계 2절의 "백그라운드 수집 안 함"과 충돌할 수 있다.
4. **다운로드가 막힌 자료** (권고: 건너뜀)
   - 교수가 막아 둔 웹 뷰어 자료는 목록에만 기록하고 건너뛰는 기본값에 동의하는지.
5. **토큰 파일과 서버 토큰 처리** (권고: 파일 삭제, 서버 토큰은 그대로 둠)
   - `%LOCALAPPDATA%\kaist-cli\wstoken.txt`를 지울지. 지우면 OneDrive 웹의 휴지통과 버전 기록도 비우기를 권한다. 과거에 동기화됐기 때문이다.
   - 서버 토큰을 KLMS 운영팀에 삭제 요청할지(선택).
   - `local/`은 V7에서 OneDrive 밖(`%LOCALAPPDATA%\kaist-cli\`)으로 옮겼다. 1단계부터도 이 위치를 쓴다.
6. **세션 유지 측정 실행**
   - 로그인 시각 기준 30분, 2시간, 다음 날에 `npx tsx scripts/phase0/check-session.ts`를 실행해 달라. 결과는 `%LOCALAPPDATA%\kaist-cli\session-checks.log`에 쌓인다. 이제 쿠키만 확인한다.
   - 기준: 2026-10-13 14:58 KST
   - 마지막 확인: 15:11
   - 3시간 유휴 만료를 확인하려면 요청 없이 3시간 넘게 둔 뒤 실행해야 한다.
