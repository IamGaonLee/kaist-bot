# kaist — KAIST KLMS 개인 수집 CLI

KLMS(Moodle 3.9 커스텀)에서 이번 학기 과목의 과제, 마감, 공지, 강의자료를 **읽기 전용**으로 모읍니다. 모은 것은 구글 드라이브 폴더와 전용 구글 캘린더 "KLMS"에 정리합니다. 개인 Windows PC에서만 씁니다. 설계는 `docs/kaist-agent-design.md`, 검증 결과는 `docs/phase0-report.md`에 있습니다.

## 설치

1. Node.js 20 이상, Git
2. 이 폴더에서:
   ```
   npm install
   npx playwright install chromium
   npm run build
   npm link        # 전역 명령 kaist
   ```
3. Google Drive for desktop을 설치합니다. 기본 경로는 `G:\내 드라이브\KAIST`입니다.
   - 다른 경로를 쓰려면 `%LOCALAPPDATA%\kaist-cli\config.json`에 `{"driveRoot": "D:\\경로\\KAIST"}`를 적습니다.
4. 구글 캘린더(선택)
   - 구글 클라우드에서 Calendar API를 켜고, 데스크톱 앱 OAuth 클라이언트를 만듭니다.
   - 받은 JSON을 `%LOCALAPPDATA%\kaist-cli\google-client.json`에 저장한 뒤 `kaist cal login`을 실행합니다.

## 사용

```
kaist login                     로그인 (브라우저 창에서 직접 입력 + 폰 승인)
kaist sync                      과목·과제·공지·자료 증분 수집 + 드라이브 요약 + 캘린더 반영
kaist status [--check]          세션 상태, 마지막 수집 시각
kaist assignments [--due 7d]    마감 (⚠ = KLMS에서 직접 확인 필요)
kaist notices [--since 3d]      공지/게시판 글
kaist files [--new]             강의자료
kaist videos                    영상 링크 (영상은 받지 않음)
kaist cal list|add|update|delete|push
kaist doctor [과목] [--offline] 파서 점검
```

모든 조회 명령은 `--json`을 지원합니다. 조회 명령은 로컬 데이터만 읽고 KLMS에 접속하지 않습니다.

## 저장 위치

- `%LOCALAPPDATA%\kaist-cli\` (드라이브·OneDrive 밖, 저장소에 넣지 않음)
  - `session.json`: KLMS 세션 쿠키
  - `google-token.json`, `google-client.json`
  - `kaist.db`: 수집 기록 SQLite
  - `snapshots\`: 최근 HTML 원문
  - `staging\`: 다운로드 임시
- 드라이브: `<driveRoot>\2026-가을\_요약.md`, `<코드> <과목명>\{_과목정보.md, 강의자료\, 과제\, 게시판첨부\}`

## 고장 났을 때 점검 순서

1. **`kaist status --check`**
   - 세션이 만료됐으면 `kaist login`을 실행합니다.
   - 로그인 화면에 캡차나 차단 문구가 뜨면 사용을 멈추고 원인을 확인합니다.
2. **`kaist doctor`**: 과목마다 불변식을 검사합니다.
   - 불변식 1: 화면에서 읽은 활동 목록과 KLMS 활동 목록이 일치하는지
   - 불변식 2: 섹션, 활동, 파일 링크, 게시판이 정상인지
   - 실패하면 KLMS 화면 구조가 바뀐 것입니다.
3. **`kaist doctor --offline`**: 마지막으로 받은 HTML(`snapshots\`)로 같은 검사를 합니다. 접속 없이 재현할 수 있습니다.
4. **셀렉터 수정**: `src/klms/selectors.ts`에 모든 셀렉터가 모여 있습니다.
   - 파서 코드는 `src/klms/adapters/`, 사이트 상수와 판별 규칙은 `src/klms/site.ts`에 있습니다.
   - `snapshots\`의 HTML을 브라우저 개발자 도구로 열어 새 구조를 확인한 뒤 고칩니다.
5. **`npm test`**: 단위 테스트와 로컬 샘플 파서 테스트를 돌립니다. 샘플은 `%LOCALAPPDATA%\kaist-cli\samples\`에 있고, 없으면 건너뜁니다.
6. **sync가 "마감 확인 필요(⚠)"를 낸 경우**: 캘린더 마감과 과목 페이지·과제 페이지의 마감이 다르다는 뜻입니다. 이런 과제는 캘린더에 등록하지 않습니다. KLMS에서 직접 확인합니다.

## 원칙

- 읽기만 합니다. 제출, 글쓰기, 설정 변경은 코드에 없습니다.
- WS 토큰을 쓰지 않습니다. 비밀번호를 저장하거나 자동으로 입력하지 않으며, 2단계 인증을 우회하지 않습니다.
- 요청 간격은 500ms 이상, 동시 요청은 2개 이하이고, 이번 학기 과목만 대상으로 합니다.
- 다운로드가 막힌 자료와 스트리밍 영상은 받지 않습니다. 받은 자료는 개인 학습용입니다.
