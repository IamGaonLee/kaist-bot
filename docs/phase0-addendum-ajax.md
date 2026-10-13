# 0단계 추가 검증: 토큰 없이 세션 방식 API로 충분한가 (Claude Code용)

`docs/`에 넣고 Claude Code에 "docs/phase0-addendum-ajax.md를 읽고 진행해줘"라고 시킨다.

## 목적

`docs/phase0-report.md`의 V4-b에서 쿠키와 sesskey로 `/lib/ajax/service.php`를 호출하는 방식이 동작했다. 수집에 필요한 함수가 모두 이 방식으로 된다면 WS 토큰을 쓰지 않는다. 토큰은 수명이 길고 사용자가 폐기할 수 없어서, 없이 갈 수 있으면 그쪽이 낫다.

## 규칙

`docs/phase0-instructions.md`의 규칙을 그대로 따른다. 추가로:

- **새 토큰을 발급하지 않는다.** `launch.php`를 다시 호출하지 않는다.
- 이번 시험은 쿠키와 sesskey만 쓴다. 저장된 토큰은 비교가 꼭 필요한 경우에만 쓰고, 썼다면 보고서에 적는다.
- 세션이 만료됐으면 사용자에게 로그인을 요청한다.
- 시작 전에 `local/` 폴더가 OneDrive 밖으로 옮겨졌는지 사용자에게 확인한다. 아직이면 먼저 옮기고 스크립트의 경로를 고친다.

## 시험할 것

이번 학기 과목 1개를 대상으로(지난번과 같은 과목이 이번 학기가 아니면 사용자에게 묻는다), 아래 함수를 `/lib/ajax/service.php?sesskey=...`로 호출해 본다. 요청 사이에 1초 이상 간격을 둔다.

| 용도 | 함수 |
|---|---|
| 과목 목록 | `core_course_get_enrolled_courses_by_timeline_classification` (이미 성공) |
| 다가오는 마감 | `core_calendar_get_action_events_by_timesort` (이미 성공) |
| 과목 구성(주차, 활동, 파일 URL) | `core_course_get_contents` |
| 과제 목록과 마감 | `mod_assign_get_assignments` |
| 과제 제출 상태 | `mod_assign_get_submission_status` |
| 퀴즈 | `mod_quiz_get_quizzes_by_courses` |
| 자료 메타 | `mod_resource_get_resources_by_courses`, `mod_folder_get_folders_by_courses`, `mod_url_get_urls_by_courses`, `mod_page_get_pages_by_courses` |
| LTI(영상 링크) | `mod_lti_get_ltis_by_courses` |
| 증분 | `core_course_get_updates_since`, `core_course_check_updates` |
| 과목별 일정 | `core_calendar_get_calendar_events`, `core_calendar_get_action_events_by_course` |

각 함수에 대해 기록한다.

- 성공 / 실패. 실패면 `errorcode` 원문 (세션 방식에서 허용되지 않는 함수라는 오류인지, 권한 오류인지, 인자 오류인지 구분)
- 성공한 경우 토큰 방식 응답과 필드가 같은지 (기존 샘플과 비교)
- 반환되는 파일 URL의 형식. `webservice/pluginfile.php`로 오는지 `pluginfile.php`로 오는지, 쿠키만으로 받을 수 있는지 (HEAD 요청 1건)

## 실패한 함수의 대체 수단

세션 방식에서 막힌 함수마다 대체 방법을 조사한다.

1. 같은 정보를 주는 다른 허용 함수가 있는지 (예: 과제 마감은 `core_calendar_*` 이벤트로, 과목 구성은 KLMS 전용 `format_kaistweeks_*`나 `theme_oklass39_*` 함수로)
2. 없으면 HTML에서 얻을 수 있는지, 그때 날짜가 어떤 형식으로 오는지 (과목 페이지의 `strong.end-dt`는 `YYYY-MM-DD HH:MM` 형식이었다)

## 산출물

`docs/phase0-report.md`에 "V7. 세션 방식 API 범위" 절을 추가한다.

1. 함수별 결과 표
2. 결론을 셋 중 하나로 명시
   - **토큰 불필요**: 필요한 정보를 모두 세션 방식(또는 그 대체 수단)으로 얻는다
   - **일부만 토큰 필요**: 어떤 정보가 토큰 없이는 안 되는지, HTML 대체 시 위험이 무엇인지
   - **토큰 필요**: 세션 방식으로는 실질적으로 수집이 안 된다
3. 3.1절 수집 방식 권고를 결과에 맞게 고친다

끝나면 결과를 사용자에게 보여주고 멈춘다.
