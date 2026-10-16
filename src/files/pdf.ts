// 요약 md → PDF — 포트 인터페이스. 실제 렌더링은 플랫폼 렌더러가 한다(CLI는 Playwright, 앱은 Electron printToPDF).
// 사용자 결정: md는 Claude용으로 유지하고 사람이 볼 PDF를 함께 만든다.
import { KaistError } from '../errors.js';

export interface PdfResult {
  written: string[];
  failed: [string, string][];
}

export interface PdfRenderer {
  /** md 파일들과 같은 자리에 같은 이름의 .pdf를 만든다. 실패한 파일은 [경로, 오류]로 돌려준다 */
  renderPdfs(mdFiles: string[]): Promise<PdfResult>;
}

let renderer: PdfRenderer | null = null;

/** 플랫폼 진입점에서 1회 호출 (src/platform.ts) */
export function setPdfRenderer(r: PdfRenderer): void {
  renderer = r;
}

export function renderPdfs(mdFiles: string[]): Promise<PdfResult> {
  if (mdFiles.length === 0) return Promise.resolve({ written: [], failed: [] });
  if (!renderer) throw new KaistError('INTERNAL', 'PDF 렌더러가 설정되지 않았습니다. installPlatform()을 먼저 호출해야 합니다.');
  return renderer.renderPdfs(mdFiles);
}
