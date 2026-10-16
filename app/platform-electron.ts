// Electron 어댑터 등록. 코어(src/*)는 포트만 쓰고, 앱은 여기서 Electron 드라이버를 연결한다.
// (Playwright는 불러오지 않는다 → 앱 번들에 playwright가 안 들어간다.)
import { setLoginDriver } from '../src/sso/browser-login.js';
import { electronLoginDriver } from './electron-login.js';
import { setPdfRenderer } from '../src/files/pdf.js';
import { electronPdfRenderer } from './electron-pdf.js';

export function installElectronPlatform(): void {
  setLoginDriver(electronLoginDriver);
  setPdfRenderer(electronPdfRenderer);
}
