// 플랫폼 어댑터 등록. CLI는 Playwright, Electron 앱은 뒤에 자기 어댑터를 넣는다.
// 코어(src/*)는 포트(sso/browser-login.ts, files/pdf.ts)만 쓰고, 여기서만 실제 드라이버에 연결한다.
import { setLoginDriver } from './sso/browser-login.js';
import { playwrightLoginDriver } from './sso/playwright-login.js';
import { setPdfRenderer } from './files/pdf.js';
import { playwrightPdfRenderer } from './files/pdf-playwright.js';

/** CLI 진입점에서 1회 호출 */
export function installPlaywrightPlatform(): void {
  setLoginDriver(playwrightLoginDriver);
  setPdfRenderer(playwrightPdfRenderer);
}
