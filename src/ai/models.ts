// 고를 수 있는 오픈소스 로컬 모델 목록. 앱이 모델을 재배포하지 않고, 사용자가 받을 때 Hugging Face에서 직접 내려받는다.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { DEFAULT_MODEL_URI } from './local.js';

export interface ModelOption {
  id: string;
  label: string;
  uri: string;
  sizeGb: number;
  license: string;
  note: string;
}

// Qwen2.5: 1.5B·7B는 Apache-2.0, 3B는 Qwen 라이선스(비상업 위주). 사용자가 직접 받는다.
export const MODEL_CATALOG: ModelOption[] = [
  { id: 'qwen1_5b', label: 'Qwen2.5 1.5B (가볍고 빠름)', uri: 'hf:bartowski/Qwen2.5-1.5B-Instruct-GGUF:Qwen2.5-1.5B-Instruct-Q4_K_M.gguf', sizeGb: 1.0, license: 'Apache-2.0', note: '저사양 PC용. 정확도는 낮음.' },
  { id: 'qwen3b', label: 'Qwen2.5 3B (기본·균형)', uri: 'hf:bartowski/Qwen2.5-3B-Instruct-GGUF:Qwen2.5-3B-Instruct-Q4_K_M.gguf', sizeGb: 2.0, license: 'Qwen License', note: 'RAM 16GB 권장. 한국어 응답 무난.' },
  { id: 'qwen7b', label: 'Qwen2.5 7B (품질 높음·느림)', uri: 'hf:bartowski/Qwen2.5-7B-Instruct-GGUF:Qwen2.5-7B-Instruct-Q4_K_M.gguf', sizeGb: 4.7, license: 'Apache-2.0', note: 'GPU나 넉넉한 RAM일 때. 다운로드가 큼.' },
];

/** 이 URI의 모델이 이미 받아졌는지(대략). resolveModelFile이 만드는 파일명은 URI를 변형하므로 느슨히 본다. */
export function isDownloaded(uri: string): boolean {
  try {
    const modelsDir = path.join(paths.home, 'models');
    if (!fs.existsSync(modelsDir)) return false;
    const files = fs.readdirSync(modelsDir).map(f => f.toLowerCase());
    const name = (uri.split(':').pop() ?? uri).replace(/\.gguf$/i, '').toLowerCase();
    return files.some(f => f.includes(name));
  } catch { return false; }
}

export function catalogWithState(currentUri: string | undefined) {
  const cur = currentUri ?? DEFAULT_MODEL_URI;
  return MODEL_CATALOG.map(m => ({ ...m, selected: m.uri === cur, downloaded: isDownloaded(m.uri) }));
}
