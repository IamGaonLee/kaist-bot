# 배포 방법 (GitHub Pages 홈페이지 + 설치 파일 릴리스)

`site/`에 홈페이지(`index.html`)와 설명서(`guide.html`)가 있고, 설치 파일은 GitHub 릴리스로 올린다.

## 1. 저장소 올리기

```
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main         # 또는 feature/app 병합 후 main
```

## 2. 홈페이지 (GitHub Pages)

- GitHub 저장소 → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- `.github/workflows/pages.yml`이 `site/` 폴더를 Pages로 올린다(main에 `site/**` 변경이 푸시될 때).
- 주소는 `https://<계정>.github.io/<저장소>/`. 홈페이지의 다운로드 버튼은 이 주소에서 저장소를 추정해 `releases/latest`로 연결된다.

## 3. 설치 파일 (릴리스)

- 로컬 Windows는 electron-builder가 winCodeSign 압축을 풀 때 **심볼릭 링크 권한**이 필요하다. 권한이 없으면 실패한다.
  - 해결: Windows **개발자 모드** 켜기(설정 → 개인정보/업데이트 → 개발자용) 또는 관리자 터미널. 그 뒤 `npm run dist` → `release/KAISTBOT-Setup-<버전>.exe`.
- 또는 CI로 빌드(권장, 러너는 권한이 있음):
  ```
  git tag v1.0.0
  git push --tags
  ```
  `.github/workflows/release.yml`이 windows-latest에서 설치 파일을 빌드해 릴리스에 첨부한다.

## 4. 서명 (선택)

- 무서명이면 설치 시 Windows SmartScreen "PC 보호" 경고가 뜬다(홈페이지·설명서에 "추가 정보 → 실행" 안내 있음).
- 없애려면 OV 코드 서명 인증서(연 약 $150~300)가 필요하다. 한국 개인은 Azure Trusted Signing을 쓸 수 없다. 지인 배포 규모면 무서명 + 안내로 충분하다.

## 5. 모델·구글

- 로컬 AI 모델은 앱이 재배포하지 않고, 사용자가 설정 마법사에서 고를 때 Hugging Face에서 직접 받는다.
- 구글은 공유 앱(미인증)으로, 각 사용자가 "확인되지 않은 앱" 경고를 넘겨 자기 계정으로 동의한다(평생 100명 한도). Gmail(제한 범위)이 다른 계정에서 막히면 그 사용자만 자기 OAuth 클라이언트로 전환.
