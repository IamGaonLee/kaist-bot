# 로컬 LLM 번들링 조사: KAIST 학생용 Windows 프로그램

- 조사일: 2026-10-16 (웹 검색, Hugging Face API, npm 레지스트리, GitHub API, OpenRouter API로 직접 확인)
- 목적: 지금 Claude Code가 하는 일(한/영 공지에서 시험·휴강 날짜 추출 → JSON, 공지 분류, 강의자료 요약, 로컬 파일 기반 과제 질의응답)의 일부나 전부를, 학생 노트북에서 도는 공개 가중치 모델로 넘길 수 있는지 판단한다.
- 표기: **[확인]** 1차 출처(모델 카드, 라이선스 원문, 레지스트리)에서 직접 봄. **[2차]** 기사·집계 사이트만 봄. **[추정]** 수치를 내가 환산하거나 판단함. **[미확인]** 찾지 못함.
- 라이선스 해석은 법률 자문이 아니다. 배포 전에 원문을 다시 읽어야 한다.

---

## 0. 결론 먼저

1. **런타임은 node-llama-cpp(MIT)가 가장 맞다.** 같은 Node 프로세스 안에서 돌고, 별도 설치가 없고, Windows용 CPU·Vulkan·CUDA 바이너리가 npm으로 나온다. 3.22.1(2026-09-28)에는 llama.cpp v0.5.0(2026-09-23)이 들어 있다. [확인]
2. **기본 모델 후보는 라이선스가 깨끗한 Apache-2.0/MIT 모델이다.** Qwen3.5(0.8B/2B/4B/9B), Gemma 4(E2B/E4B/12B/26B-A4B), Ministral 3, SKT A.X 4.0 Light, KT Mi:dm 2.0, Kakao Kanana 1.5가 여기에 든다. [확인]
3. **한국어 특화 모델 중 몇 개는 앱에 넣어 배포하기 어렵다.**
   - EXAONE 4.0/4.5(LG): 비상업·연구/교육용이다. 외부 배포는 서면 합의가 있어야 한다.
   - Kanana-2(Kakao): "온디바이스에 넣어 제3자에게 제공"하려면 별도 상용 라이선스가 필요하다.
   - HyperCLOVA X SEED(Naver): 배포는 가능하다. 대신 "Powered by HyperCLOVA X" 표기, 라이선스 동봉 같은 의무가 있다.
   - 근거는 모두 원문 확인이다. [확인]
4. **2026년 기준 한국어 독립 비교 자료가 부족하다.** Qwen3.5·Gemma 4 소형에 대해 KMMLU 같은 독립 한국어 점수를 찾지 못했다. 그래서 프로젝트에 이미 있는 학사 일정 후보 47건(처리 결과 포함)으로 직접 비교 평가를 해서 고르는 것이 맞다. [미확인 → 직접 평가 권장]
5. **등급별 잠정 권장**
   - (a) CPU 8–16GB: Qwen3.5-4B Q4_K_M(2.74GB). 8GB 노트북은 Qwen3.5-2B나 Mi:dm 2.0 Mini.
   - (b) GPU 6–8GB: Qwen3.5-9B Q4_K_M(5.68GB). 6GB면 4B.
   - (c) GPU 12GB 이상: Gemma 4 12B QAT Q4_0(6.98GB). 16GB 이상이면 Gemma 4 26B-A4B.
   - 모두 [추정]이고, 평가 후 확정한다.
6. **정확도 위험은 크다.** 소형 모델은 상대 날짜("다음 주 화요일"), 변경·취소, 한 글에 날짜가 여러 개인 경우, "이미 등록된 일정인가" 같은 판단에서 Claude보다 확실히 약하다.
   - 완화 방향: 모델은 **구간 추출과 분류만** 하고, **날짜 계산·중복 판정은 코드**가 한다.
   - 지금 있는 검사(인용 원문 대조, 요일, 학기 범위, A/B 등급)는 그대로 둔다.
   - 로컬 모델 출처는 A등급 조건을 더 좁힌다.

---

## 1. 후보 모델 비교

### 1.1 한눈에 보는 표

"번들"은 무료 앱 설치 파일이나 첫 실행 다운로드로 가중치를 학생 PC에 배포해도 되는지를 뜻한다.

| 모델 (출시) | 크기 | 라이선스 / 번들 | 한국어 근거 (제작사 자체 보고) | 컨텍스트 | 도구 호출·JSON | GGUF Q4 파일 [확인] |
|---|---|---|---|---|---|---|
| **Qwen3.5** 0.8B/2B/4B/9B (2026-03 초) | 0.8–9B dense, Gated DeltaNet 혼합 | Apache-2.0 / **가능** | MMMLU 4B 76.1, 9B 81.2. KMMLU는 [미확인]. Kanana-2 카드 기준 2B는 KMMLU-CoT 41.75, HAERAE 27.84, KoSimpleQA 3.21(한국 지식 약함) | 262K | 도구 호출 강조(BFCL-V4 4B 50.3, 9B 66.1). 기본이 thinking 모드라 끄는 설정이 필요 | 2B 1.28GB, 4B 2.74GB, 9B 5.68GB (Q4_K_M) |
| **Gemma 4** E2B/E4B (2026-04-02), 12B (2026-06-03), 26B-A4B/31B | E2B 2.3B 유효(전체 5.1B), E4B 4.5B 유효(전체 8B), 12B, 26B MoE(활성 3.8B) | Apache-2.0 / **가능** (Gemma 3까지의 자체 약관에서 바뀜) | MMMLU E2B 67.4, E4B 76.6, 12B 83.4, 26B-A4B 86.3. KMMLU는 [미확인]. 35개 이상 언어 기본 지원(한국어 포함 여부는 목록 [미확인]) | E 모델 128K, 12B 이상 256K | 네이티브 함수 호출 | E2B 3.35GB, E4B 5.15GB (google QAT Q4_0, E4B Q4_K_M 4.98GB), 12B 6.98GB (QAT), 26B-A4B 16.95GB |
| **Ministral 3** 3B/8B/14B (2025-12) | dense | Apache-2.0 / **가능** | 한국어를 지원 언어로 명시. Multilingual MMLU(base) 3B 0.652, 8B 0.706, 14B 0.742 | 256K (3B는 OpenRouter 기준 131K) | 네이티브 함수 호출·JSON 출력 | 3B 2.15GB, 8B 5.20GB |
| **A.X 4.0 Light** (SKT, 2025-07-03) | 7B, Qwen2.5 기반 | Apache-2.0 / **가능** | KMMLU 64.15 (Qwen3-8B 63.53, EXAONE-3.5-7.8B 53.76, Kanana-1.5-8B 48.28), CLIcK 68.05, KoBALT 30.29 | **16K** | vLLM hermes 파서로 도구 호출 | 4.44GB (커뮤니티 변환) |
| **Mi:dm 2.0** Mini 2.3B / Base 11.5B (KT, 2025-07-04) | dense | **MIT** / **가능** | Mini: KMMLU 45.1, HAERAE 70.8, Ko-IFEval 73.3(Qwen3-4B 75.9). Base: 한국 사회·문화 평균 78.4(Qwen3-14B 64.1) | [미확인] | vLLM 전용 파서(2025-10) | Mini 1.43GB, Base 7.11GB (커뮤니티 변환) |
| **Kanana 1.5** 2.1B/8B (Kakao, 2025-05-23) | dense | Apache-2.0 / **가능** | 8B: KMMLU 48.94(base), HAE-RAE 82.77, KoMT-Bench 7.63, FunctionChatBench 58.0 | 32K (YaRN 128K) | 함수 호출 개선 명시 | 8B 4.92GB |
| **Tri-7B** (Trillion Labs, 2025-07) | 7.76B | Apache-2.0 / **가능** | KMMLU 51.74, HAERAE 82.49, CLIcK 64.43, KoBEST 82.72, KoMT 7.64 | 32K | 언급 없음 | 공식 GGUF [미확인] (5개 양자화본 존재) |
| **gpt-oss-20b** (OpenAI, 2025-08-05) | 21B MoE | Apache-2.0 / **가능** | 한국어 점수 [미확인] | 128K | 도구 호출 | 12.11GB (MXFP4) |
| **Kanana-2** 1.3B/3B (2026-07-27), 30B-A3B (2025-12~2026-01) | 3B는 슬라이딩 윈도우 혼합 | Kanana Open License / **별도 허락 필요** (아래 1.2) | 3B-Instruct: KoMT 6.92, KMMLU-CoT 43.32, HAERAE 43.75, KoSimpleQA 22.29. 모두 Qwen3.5-2B보다 높음 | 32K | BFCL-v3 Live 71.94 | 3B 2.16GB, 1.3B 0.85GB (커뮤니티 변환) |
| **HyperCLOVA X SEED** 0.5B/1.5B/3B (2025-04-24), Think 14B (2025-07-22), 8B Omni·32B Think (2025-12~2026-01) | dense | HyperCLOVA X SEED License / **조건부 가능** (아래 1.2) | 1.5B: KMMLU 0.393, HAE-RAE 0.567, KoBEST 0.649 (Qwen2.5-1.5B보다 높음). 14B Think: KMMLU 0.665, HAERAE 0.854, CLIcK 0.728 | 1.5B 16K, 14B 32K | 14B는 tool_list 형식 지원 | 1.5B 1.13GB, 14B 8.92GB (공식 naver-ellm) |
| **EXAONE 4.0** 1.2B/32B (2025-07-15), 4.5 33B (2026-04) | dense | EXAONE AI Model License 1.2 **NC** / **불가** (LG 서면 합의 필요) | 1.2B: KMMLU-Redux 46.9 / KMMLU-Pro 42.7 (Qwen3-1.7B 38.0/38.3). 소형 중 한국어 최상위권 | 64K | BFCL-v3 1.2B 52.9–55.7 | 1.2B 0.81GB (공식) |
| Llama 3.2 1B/3B, Llama 4 | – | Llama Community License / 가능("Built with Llama" 표기) | **한국어가 공식 지원 언어에 없음** (3.2는 8개, 4는 12개 언어) | 128K | – | 권장하지 않음 |

표 읽는 법:
- 한국어 점수는 모두 **제작사가 직접 보고한 값**이다. 측정 조건(shot 수, CoT 여부)이 모델마다 달라서, 행끼리 직접 비교하면 안 된다.
- "커뮤니티 변환"은 제작사가 아닌 사람이 올린 GGUF다. 배포에 쓰려면 직접 변환하고 해시를 고정하는 것이 안전하다.
- Gemma 4 E 모델은 계산량은 2.3B/4.5B 수준이다. 하지만 레이어별 임베딩 때문에 **파일과 RAM은 5B/8B 수준**이다.

### 1.2 라이선스 원문에서 확인한 핵심 조항

- **Apache-2.0 계열**: 상업적 이용·재배포가 가능하다. LICENSE와 NOTICE를 동봉한다. 해당 모델은 Qwen3.5, Gemma 4, Ministral 3, A.X 4.0 Light, Kanana 1.5, Tri-7B, gpt-oss-20b다.
  - A.X 4.0 Light는 Qwen2.5(Apache-2.0) 기반이라 문제가 없다.
- **MIT**: Mi:dm 2.0. 가장 단순하다.
- **HyperCLOVA X SEED Model License (2025-04-24)** [확인, ScanCode 원문]
  - 상업적 이용이 가능한 무상 라이선스다. 다만 "revocable"(철회 가능)로 되어 있다.
  - 재배포할 때 할 일
    - 계약서 사본을 동봉한다.
    - 금지 이용 정책을 하위 이용자에게 넘긴다.
    - 수정한 파일에 그 사실을 표시한다.
    - "Notice" 파일에 정해진 문구를 넣는다.
    - 관련 웹사이트·UI·문서에 **"Powered by HyperCLOVA X"를 눈에 띄게 표시**한다.
  - 다음 경우에는 NAVER의 허락이 필요하다.
    - 전월 MAU가 1,000만을 넘는 경우
    - NAVER 서비스와 "실질적으로 유사하거나 직접 경쟁"하는 제품을 배포하는 경우
  - 출력물로 다른 모델을 만들면 이름 앞에 "HyperCLOVA X"를 붙여야 한다.
  - 학생용 무료 도구라면 조건을 지키는 한 가능해 보인다. [추정]
- **Kanana Open License (Kanana-2)** [확인, HF LICENSE 원문]
  - 4.2조: "자기 서비스 개발·운영"에는 상용 라이선스가 필요 없다.
  - 4.1조: 다음 셋은 **Kakao가 따로 허락한 상용 라이선스가 있어야 한다.** 허락 여부는 Kakao 재량이다(4.3조).
    - (i) API나 클라우드로 제3자에게 제공
    - (ii) SI·온프레미스 솔루션의 일부로 제공
    - (iii) **"on-device domains"에 넣어 제3자에게 제공(offering or (re)selling)**
  - 학생 PC에 모델을 넣어 나눠주는 앱은 (iii)에 해당할 가능성이 높다. "offering"이라서 무료여도 해당될 수 있다. [추정]
  - 그 밖의 의무: "Powered by Kanana" 표시, 라이선스 동봉, Notice 파일
  - **결론: Kakao에 문의해 허락받기 전에는 기본 모델로 쓰지 않는다.**
- **EXAONE AI Model License 1.2 – NC** [확인, ScanCode 원문]
  - 2.1조: "연구와 교육 목적으로만" 쓸 수 있다.
  - 3.1조: 직접이든 간접이든 수익을 내는 제품·서비스는 금지다.
  - 2.2조: 외부 배포는 Licensor가 서면으로 동의하지 않으면 "strictly prohibited"다.
  - HF 모델 카드는 4.0 출시 뒤 교육 목적까지 넓혔다고 한다. 하지만 **앱에 넣어 배포하려면 LG AI Research의 서면 동의가 필요하다.**
  - EXAONE 4.5 33B(2026-04)도 연구·교육용으로 보도됐다. [2차]
- **Llama 3.x/4 Community License** [확인, HF 카드]
  - MAU 7억 초과면 Meta의 허락이 필요하다.
  - 재배포할 때 "Built with Llama"를 표시해야 한다.
  - 파생 모델 이름 앞에 "Llama"를 붙여야 한다.
  - 한국어가 공식 지원 언어가 아니라서 이 용도에는 맞지 않는다.

### 1.3 노트북에 올릴 수 없는 2026년 한국 대형 모델 (호스팅으로만 의미 있음)

- K-EXAONE 2.0 (LG, 750B MoE, 2026-07~08): Apache-2.0으로 공개됐다고 보도됐다. [2차]
- Solar Open 2 (Upstage, 250B MoE, 2026-07): Apache 기반 Upstage Solar License라고 한다. [2차]
- HyperCLOVA X SEED 32B Think (2025-12~2026-01)
- 이 모델들은 노트북 대상이 아니다.

---

## 2. Windows 번들용 런타임

| 런타임 | 라이선스 | 배포 방식 | GPU 가속 | 크기 [확인] | JSON 강제 | 판단 |
|---|---|---|---|---|---|---|
| **node-llama-cpp 3.22.1** (2026-09-28) | MIT | npm 의존성. 같은 프로세스에서 실행, 설치 불필요. 바이너리가 없으면 cmake로 빌드하는 경로도 있지만 `NODE_LLAMA_CPP_SKIP_DOWNLOAD`로 끌 수 있다 | CPU, Vulkan, CUDA를 자동 감지 | 본체 39.6MB, `win-x64` 30.7MB, `win-x64-vulkan` 74.3MB, `win-x64-cuda` 176MB, `win-x64-cuda-ext` 368MB (npm 압축 해제 기준) | `createGrammarForJsonSchema()`로 문법 수준에서 강제. JSON Schema는 일부만 지원 | **1순위**. TypeScript CLI에 바로 붙는다. 내장 llama.cpp는 v0.5.0(2026-09-23)이라 Qwen3.5·Gemma 4 이후 구조를 포함한다 |
| **llama.cpp** (`llama-server` 별도 프로세스) | MIT | zip을 앱 폴더에 넣고 자식 프로세스로 띄워 localhost OpenAI 호환 API로 쓴다 | CPU, Vulkan, CUDA 12/13, SYCL, ROCm, OpenVINO | b11681(2026-10-16) Windows zip: CPU 19.6MB, Vulkan 32.2MB, CUDA 13.4 154.6MB (+cudart 423.5MB), CUDA 12.4 266.6MB (+cudart 391.4MB), SYCL 149MB, ROCm 258MB | `json_schema`, GBNF | 2순위. 네이티브 애드온 문제를 피할 때 쓴다. 최신 모델 지원이 가장 빠르다 |
| **Ollama v0.40.5** (2026-10-14) | MIT | 사용자가 설치하거나, 독립 zip을 넣고 `ollama serve` | CUDA, ROCm(별도 zip), MLX | `OllamaSetup.exe` 1,584MB, `ollama-windows-amd64.zip` 1,471MB (+rocm 256MB) | `format`에 JSON 스키마 | 무겁다. 사용자의 기존 Ollama와 포트·모델 폴더가 겹칠 수 있다. "이미 설치돼 있으면 쓰는" 선택지로만 둔다 |
| **LM Studio / llmster** | 앱은 독점 약관, SDK(`@lmstudio/sdk` 2.1.0)만 MIT | **재배포 금지**("sublicense, distribute… 하지 않는다") | – | – | 있음 | 번들 불가. 사용자가 직접 설치한 경우에만 연동 |
| **ONNX Runtime GenAI v0.17.0** (2026-09-28) | MIT | C/C#/Python. 공식 Node GenAI 패키지는 npm에서 찾지 못함 | CUDA, WinML. DirectML은 유지보수 모드이고 Windows ML이 후속 | win-x64 3.8MB, cuda·winml 8.1MB (+ ONNX Runtime 본체) | 일부 | 모델을 ONNX로 변환해야 한다. 한국어 모델의 ONNX 변환본이 드물어 맞지 않는다 |
| **Foundry Local SDK** (`foundry-local-sdk` 2.1.0, MIT) | SDK는 MIT, CLI는 MS 약관(미리보기) | 같은 프로세스. ONNX Runtime 기반. NPU·GPU·CPU 자동 선택 | NPU, GPU, CPU | npm 93MB | OpenAI 형식 | 카탈로그가 큐레이션돼 있다(Qwen, Phi, Mistral, GPT-OSS, DeepSeek). 한국어 특화 모델이나 임의 GGUF를 쓸 수 있는지는 [미확인] |
| **MLC LLM / WebLLM** | Apache-2.0 | MLC 형식으로 컴파일해야 한다. `@mlc-ai/web-llm` 0.2.86은 WebGPU 기반 | Vulkan, WebGPU | WebLLM 14.4MB | 있음 | 한국어 모델 컴파일본이 드물다. CLI에는 맞지 않는다 |

**배포 권장 구성** [추정]
- 기본 설치에 넣을 것: `node-llama-cpp` + `win-x64` + `win-x64-vulkan`, 약 145MB
  - Vulkan은 NVIDIA, AMD, Intel 내장 GPU를 모두 덮는다.
- CUDA(`win-x64-cuda`, 176MB)는 NVIDIA 사용자가 고를 때만 추가로 받는다.
- 모델 파일(0.8–7GB)은 설치 파일에 넣지 않는다. 첫 실행 때 하드웨어를 감지해 받는다.
  - SHA-256으로 검증한다.
  - 모델 라이선스 파일도 함께 저장한다.

---

## 3. 성능 등급 (2k 토큰 프롬프트 기준)

### 3.1 공개 벤치마크 원자료 [확인]

- 출처: llama.cpp Vulkan 스코어보드(Discussion #10879), CUDA 스코어보드(#15013, KnightLi 정리)
- 조건: Llama 2 7B Q4_0(3.56GB), t/s 단위
- 열 의미
  - pp512 = 프롬프트 처리(prefill) 속도
  - tg128 = 생성 속도

| 장치 | pp512 | tg128 | 비고 |
|---|---|---|---|
| Intel Iris Xe (11세대 내장) | 42–106 | 5.9–7.3 | Vulkan, 빌드에 따라 차이 |
| Intel Core Ultra 100 (Meteor Lake 내장 Arc) | 78–186 | 7.8–8.2 | Vulkan |
| AMD Ryzen 7000/8000 (내장 780M급) | 267–313 | 19.8–21.3 | Vulkan |
| Intel Core Ultra 200 (Lunar Lake 내장 Arc 140V급) | 865–867 | 24.4–25.1 | Vulkan |
| AMD Ryzen AI 300 (내장 890M급) | 479–533 | 22.4–23.9 | Vulkan |
| RTX 4050 Laptop 6GB | 1,154–1,726 | 41.9–43.7 | Vulkan / CUDA |
| RTX 4060 Laptop 8GB | 2,136–2,358 | 59.5–60.0 | Vulkan |
| RTX 3060 12GB | 1,816–2,408 | 75.6–80.6 | Vulkan / CUDA |
| RTX 4070 12GB | 3,179–4,294 | 91.5–92.3 | Vulkan |

- 스코어보드에는 칩 이름만 있다. Vulkan 표이므로 내장 GPU 결과로 읽었다. [추정]
- **순수 CPU** 참고값(ik_llama.cpp #164, 2024-12 빌드)
  - 데스크톱 Ryzen 9 7950X(16코어): LLaMA-3.1-8B Q4_0에서 pp512 153.5, tg128 11.2(2스레드)
  - 노트북 Ryzen 5600H CPU: pp512 약 34(Medium 글, 검색 요약으로만 확인). [2차]
  - 그래서 최신 노트북 8코어 CPU는 7B Q4에서 pp 약 40–90, tg 약 8–12로 본다. [추정]

### 3.2 등급별 환산

- 조건: 2,048 토큰 프롬프트와 출력 300 토큰(추출 JSON 정도)
- 환산 방법
  - pp는 활성 파라미터 수에 반비례한다고 보고 위 7B 값에서 환산했다.
  - tg는 모델 파일 크기에 반비례한다고 보고 환산했다.
- 전부 [추정]이다. Qwen3.5의 DeltaNet 층이 CPU·Vulkan에서 얼마나 빠른지는 측정 자료를 찾지 못했다.

| 등급 | 쓸 만한 모델 크기 | 예시 | 2k prefill | 300토큰 생성 | 한 건 합계 | 사용 방식 |
|---|---|---|---|---|---|---|
| (a) CPU만, RAM 8GB | 0.8–2B (파일 ≤1.5GB) | Qwen3.5-2B, Mi:dm 2.0 Mini | 8–16초 | 10–15초 | **20–30초** | 아침 sync 뒤 배치 처리만. 대화형은 답답하다 |
| (a) CPU만, RAM 16GB | 3–4B (파일 ≤3GB) | Qwen3.5-4B | 16–30초 | 20–27초 | **35–60초** | 배치는 충분하다. 대화형은 느리다. 9B는 한 건 1.5–2분 |
| (a′) 내장 GPU(780M, Arc 140V)를 Vulkan으로 | 4B | Qwen3.5-4B | 1.5–4초 | 10–12초 | **12–16초** | 2023년 이후 AMD·Intel 노트북은 CPU 대비 prefill 3–10배. Iris Xe는 CPU와 비슷하거나 더 느리다 |
| (b) GPU 6GB (RTX 4050 Laptop) | 4B는 전부 GPU에. 9B는 일부만 GPU에 | Qwen3.5-4B | 1초 미만 | 약 5초 | **약 6초** | 대화형 가능. 9B(5.68GB)는 KV 캐시까지 6GB에 다 안 들어가 일부를 CPU로 넘기므로 느려진다 |
| (b) GPU 8GB (RTX 4060 Laptop) | 7–9B | Qwen3.5-9B, A.X 4.0 Light | 1–1.5초 | 약 8초 | **약 10초** | 대화형 가능 |
| (c) GPU 12GB (RTX 3060/4070) | 12–14B | Gemma 4 12B QAT, HyperCLOVA X SEED Think 14B | 1–2초 | 8–10초 | **약 10초** | 요약·질의응답에도 쓸 만하다 |
| (c) GPU 16GB 이상 | 20–26B MoE | Gemma 4 26B-A4B(16.95GB), gpt-oss-20b(12.1GB) | 1–2초 | 3–5초(활성 4B) | **약 5초** | 16GB에는 26B-A4B Q4가 빠듯하다. 32GB RAM과 일부 CPU 오프로드로도 가능 |

- **RAM 기준**: 모델 파일 + KV 캐시와 런타임 0.5–1.5GB(8K 컨텍스트) + Windows와 다른 앱 3–5GB [추정]
  - 8GB 노트북이면 파일 1.5GB 이하가 현실적이다.
  - 16GB면 6GB 이하가 현실적이다.
  - Gemma 4·Kanana-2(슬라이딩 윈도우)와 Qwen3.5(DeltaNet)는 긴 문서에서 KV 캐시가 작다.
- **긴 강의자료 요약(2만 토큰 이상)**: CPU 등급에서는 prefill만 수 분이 걸린다. 매일 07:00 자동 sync 뒤 백그라운드 배치로 돌리는 것이 현실적이다.

---

## 4. 호스팅 대안 (노트북이 너무 약할 때)

**주의**
- 클라우드 의존이 다시 생긴다.
- 공지·메일 본문이 제3자 서버로 간다.
- 무료 앱에는 API 키를 넣을 수 없다. 사용자 본인 키(BYOK)를 쓰게 하거나, 프록시 서버를 운영해야 한다.

가격은 2026-10-16 기준이다. OpenRouter는 `/api/v1/models` 응답에서 직접 읽었다. [확인]

| 제공자 | 모델 | 입력 / 출력 (US$ / 100만 토큰) | 비고 |
|---|---|---|---|
| OpenRouter | qwen/qwen3.5-9b | 0.10 / 0.15 | 262K, structured_outputs·tools |
| OpenRouter | google/gemma-4-26b-a4b-it | 0.09 / 0.30 (`:free` 무료판 있음) | 무료판은 속도 제한이 있고, 데이터 정책을 확인해야 한다 |
| OpenRouter | google/gemma-4-31b-it | 0.20 / 0.40 (`:free` 있음) | |
| OpenRouter | mistralai/ministral-8b-2512, 3b-2512, 14b-2512 | 0.15/0.15, 0.10/0.10, 0.20/0.20 | |
| OpenRouter | qwen/qwen3.5-35b-a3b | 0.15 / 1.00 | |
| OpenRouter | upstage/solar-mini4, solar-pro4 (한국 업체) | 0.05/0.20, 0.09/0.36 | 공개 가중치 모델은 아니다(Solar Open과 다름). [2차] |
| Together | Qwen3.5 9B, Gemma 4 31B | 0.17/0.25, 0.39/0.97 | 요금 페이지 [확인] |
| Groq | gpt-oss-20b, gpt-oss-120b | 0.075/0.30, 0.15/0.60 | 미리보기 qwen3.8-27b는 0.80/4.00. Gemma·소형 Qwen은 없음 |
| FriendliAI (한국 업체) | EXAONE 4.0.1 32B | 0.6 / 1.0 | 상업 이용 가능한 공식 엔드포인트. 가격은 검색 요약 기준 [2차] |
| Naver CLOVA Studio | HyperCLOVA X(HCX-005, DASH 등) | [미확인] | 2026년 요금표를 찾지 못했다 |

**비용 감**: 공지 한 건(입력 2k, 출력 300)을 qwen3.5-9b로 처리하면 약 $0.00025다. 한 학기에 1,000건이어도 $0.25 수준이다. [추정]

비용보다 개인정보, 키 배포, 오프라인 동작이 결정 요인이다.

---

## 5. 권장안

### 5.1 작업별로 무엇을 넘길 수 있나 [추정]

| 작업 | 소형 로컬 모델(2–4B) | 중형(9–14B) | 제안 |
|---|---|---|---|
| 공지 분류(일정 관련 여부, 공지/질문/잡담) | 쓸 만하다 | 좋다 | 가장 먼저 넘긴다. 틀려도 피해가 작다 |
| 날짜·일정 추출 → JSON | 명시적 절대 날짜는 쓸 만하다. 상대 표현·변경·취소는 약하다 | 개선되지만 Claude보다 약하다 | **구간 추출만** 넘긴다. 날짜 계산·중복 판정은 코드가 하고, 지금의 검사 사슬을 유지한다 |
| 강의자료 요약 | 짧은 글은 가능하다. 사실 누락·환각이 늘어난다 | 쓸 만하다 | 배치로 돌리고 "자동 요약(로컬 모델)" 표시를 붙인다 |
| 과제 질의응답(로컬 파일) | 약하다. CPU에서는 느리다 | 검색 결과가 좋으면 가능하다 | 검색(키워드/BM25) + 근거 인용을 강제한다. 어려운 질문은 Claude로 넘긴다 |

### 5.2 등급별 기본값 (평가 전 잠정)

| 등급 | 런타임·백엔드 | 기본 모델 | 대안 |
|---|---|---|---|
| (a) CPU, 8GB | node-llama-cpp, CPU (내장 GPU가 있으면 Vulkan) | Qwen3.5-2B Q4_K_M (1.28GB) | Mi:dm 2.0 Mini (MIT, 1.43GB, 한국어 특화) |
| (a) CPU, 16GB | 같음 | **Qwen3.5-4B Q4_K_M (2.74GB)** | Gemma 4 E4B (5GB, MMMLU 76.6), Kanana 1.5 2.1B |
| (b) GPU 6GB | node-llama-cpp, Vulkan (CUDA 선택) | Qwen3.5-4B를 전부 GPU에 | Gemma 4 E4B |
| (b) GPU 8GB | 같음 | **Qwen3.5-9B Q4_K_M (5.68GB)** | A.X 4.0 Light (한국어 KMMLU 64, 단 16K 컨텍스트), Ministral 3 8B |
| (c) GPU 12GB | 같음 | **Gemma 4 12B QAT Q4_0 (6.98GB)** | HyperCLOVA X SEED Think 14B (8.92GB, 표기 의무 있음), Mi:dm 2.0 Base |
| (c) GPU 16GB 이상 | 같음 | Gemma 4 26B-A4B Q4 (16.95GB) | gpt-oss-20b (12.1GB) |
| 너무 약함 / 사용자가 선택 | OpenRouter (BYOK) | qwen/qwen3.5-9b | gemma-4-26b-a4b |

- Qwen3.5를 기본으로 둔 이유
  - Apache-2.0이다.
  - 크기 사다리(0.8–9B)가 촘촘해서 등급마다 같은 프롬프트·스키마를 쓸 수 있다.
  - 도구 호출과 지시 따르기가 강하다.
  - 컨텍스트가 길다.
- Qwen3.5의 약점
  - 한국 고유 지식(HAERAE, KoSimpleQA)은 한국 모델보다 크게 낮다. 2B 기준이고, Kanana-2 카드에 실린 값이다.
  - 그래서 **Gemma 4 E4B, Mi:dm 2.0 Mini, A.X 4.0 Light와 직접 비교 평가한 뒤 확정한다.**
  - 원문을 주고 뽑는 작업은 지식보다 독해·지시 따르기가 중요하다. 그래서 차이가 작을 수도 있다. [추정]
- **Kakao·LG가 허락하면 다시 볼 만한 모델**
  - Kanana-2-3B: 한국어 점수, 파일 크기, BFCL 모두 좋다.
  - EXAONE 4.0 1.2B: 0.81GB에 소형 중 한국어 최상위권이다.

### 5.3 정확도 위험: 솔직한 평가

- 지금 흐름은 Claude가 후보를 읽고 판단한다. 판단 내용은 다음과 같다.
  - 일정인지
  - 이미 등록됐는지
  - 지난 일정인지
  - 상대 표현을 글 게시일 기준으로 어떻게 푸는지
- 그 결과를 `kaist events add --dry-run`의 기계 검증이 다시 거른다. 검증 항목은 인용 원문 대조, 요일, 학기 범위, A/B 등급이다.
- S6 첫 처리 결과: 후보 47건 중 A 1건, B 12건을 등록했고 나머지는 닫았다.
- 소형 로컬 모델로 바꾸면 예상되는 실패 [추정, 2026년 소형 모델의 한국어 날짜 추출 독립 벤치마크는 찾지 못함]
  1. **상대 날짜 계산**: "다음 주 수업은 휴강", "8주차 수업 시간에 중간고사". 기준일과 주차를 계산하다 틀리기 쉽다.
  2. **변경·취소 판정**: "10/21 → 10/23으로 변경", "휴강 취소". 이전 날짜를 새 일정으로 뽑을 위험이 있다.
  3. **한 글에 날짜가 여러 개**: 시험일, 성적 공개일, 이의신청 마감이 섞인다. 종류를 틀리게 붙이기 쉽다.
  4. **일정이 아닌 글을 일정으로 오인**: 과거 회고, 예시 문장, 다른 분반 이야기
  5. **인용 지어내기**: 원문 대조 검사가 막는다. 하지만 거부가 늘어 재현율이 떨어진다.
  6. **한영 혼용**: "Midterm on Oct. 21 (Tue) in class"는 대체로 괜찮다. 반면 "10.21.(화) 3교시" 같은 한국식 표기는 모델마다 편차가 크다.
- 대략적인 기대치 [추정]
  - 명시적 절대 날짜(A등급 유형): 9B급 90% 안팎, 4B급 80–90%
  - 상대·변경·다중 날짜(B등급 유형): 4B급 50–70%, 9B급 60–80%
  - Claude는 둘 다 이보다 높다.
  - **측정이 아니라 판단**이다. 아래 평가로 바꿔야 한다.

### 5.4 완화책 (프로젝트에 이미 있는 장치를 활용)

1. **모델이 할 일을 줄인다.** 모델은 다음만 낸다.
   - 원문 구간(`quote`, 그대로 복사)
   - 종류(exam/no_class/online/makeup/none)
   - 날짜 원문 표현(`dateText`, 예: "다음 주 화요일", "10.21.(화)")
   - 상태(new/change/cancel)
   - **날짜를 YYYY-MM-DD로 바꾸는 일은 코드가 한다.** 글 게시일, 학기 시작일, 시간표, 요일을 써서 계산한다.
   - 결과가 하나로 정해지지 않으면 B등급으로 보낸다.
2. **문법으로 JSON을 강제한다.** node-llama-cpp `createGrammarForJsonSchema()`나 llama-server `json_schema`를 쓴다.
   - enum과 필수 필드를 스키마로 고정한다.
   - JSON 문법 오류를 0으로 만든다.
   - 지원하는 스키마는 일부뿐이라 단순하게 설계한다.
3. **퓨샷 예시**: 과거에 처리한 후보에서 유형별로 3–5개를 고른다. 휴강, 시험, 변경, 취소, 일정 아님. 고정 프롬프트로 넣는다.
4. **기존 검사를 그대로 거친다.** 인용 원문 대조, 요일, 학기 범위, 중복 키 `(course, kind, date)`
5. **로컬 모델 출처의 A등급을 좁힌다.** [제안]
   - `dateText` 자체가 월·일이 있는 절대 표현이어야 한다.
   - 같은 글에 일정 후보가 하나여야 한다.
   - 상태가 `new`여야 한다.
   - 이 조건을 다 만족할 때만 자동 등록하고, 나머지는 모두 B등급으로 보낸다.
6. **두 번 뽑아 비교**: temperature 0으로 한 번, 다른 프롬프트로 한 번 뽑는다. 결과가 다르면 B등급으로 보낸다.
7. **어려운 건은 Claude로 넘긴다.** 노트북이 켜져 있고 사용자가 Claude Code를 쓸 때 B등급 후보만 Claude에게 다시 판단시킨다.
8. **미세조정은 나중에 한다.** 부산시 사례(DLM-NL2JSON-4B)는 Qwen3-4B를 LoRA로 조정해 한 영역의 한국어 JSON 추출에서 GPT-4o보다 높은 점수를 보고했다. 단 제작사 보고이고, 날짜 정규화는 따로 측정하지 않았다.
   - 데이터가 쌓이면 Apache 모델에 LoRA를 거는 방법이 있다. Kanana·EXAONE·HyperCLOVA는 파생 모델 이름 규칙 같은 조항이 붙는다.

### 5.5 다음 단계: 직접 비교 평가 (선택 전에 꼭)

- **정답셋**: S6의 후보 47건과 최종 처리 결과, S7 메일 후보, 이번 학기 등록된 일정
  - 처리 결과는 등록(종류, 날짜, 시각) 또는 닫음(사유)이다.
  - 개인정보가 있으니 로컬에서만 쓰고 저장소에 넣지 않는다.
- **후보**: Qwen3.5-2B/4B/9B, Gemma 4 E4B/12B, Mi:dm 2.0 Mini, A.X 4.0 Light, Ministral 3 8B
- **지표**
  - 일정 여부의 정밀도·재현율
  - (종류, 날짜, 시각) 완전 일치율
  - 인용 검사 통과율
  - 잘못된 A등급 수(가장 중요, 0이어야 함)
  - 건당 시간(이 PC 기준)
- **이 PC에서 속도 측정**: `npx node-llama-cpp inspect gpu`, 그리고 llama.cpp `llama-bench -p 2048 -n 300`

---

## 6. 확인하지 못한 것

- 2026년 소형 모델(Qwen3.5, Gemma 4, Ministral 3)의 **독립 한국어 벤치마크**(KMMLU, HAE-RAE, Horangi 리더보드 최신판). 찾지 못했다.
- Gemma 4가 "기본 지원 35개 언어"에 한국어를 넣었는지 목록을 직접 보지 못했다.
- Qwen3.5(Gated DeltaNet)의 CPU·Vulkan 실측 속도, 노트북 CPU에서 4B/9B의 pp/tg 실측값. 3.2절 표는 환산 추정이다.
- Kanana-2 4.1(iii) "on-device" 조항이 무료 학생용 앱에 실제로 적용되는지. Kakao의 해석이 필요하다.
- EXAONE의 교육 목적 확대가 외부 배포 금지 조항까지 풀었는지. LG 확인이 필요하다.
- A.X 3.1 Light 라이선스, Mi:dm 2.0 컨텍스트 길이, Tri-7B 공식 GGUF
- Foundry Local이 임의 모델(GGUF·한국어 모델)을 지원하는지, GA인지
- Naver CLOVA Studio의 2026년 요금. FriendliAI EXAONE 요금 페이지도 직접 열어 보지 못했다.
- 2026년 7–8월 보도된 K-EXAONE 2.0, Solar Open 2의 라이선스. 2차 자료만 봤다.

---

## 7. 출처

모델 카드·라이선스
- Qwen3.5-4B: https://huggingface.co/Qwen/Qwen3.5-4B
- Qwen3.5-9B: https://huggingface.co/Qwen/Qwen3.5-9B
- Qwen3.5 소형 출시 보도: https://insiderllm.com/guides/qwen-3-5-small-models-9b-beats-30b/ , https://www.80aj.com/2026/03/03/qwen35-lightweight-commercial-models/
- Gemma 4 E4B: https://huggingface.co/google/gemma-4-E4B-it
- Gemma 4 12B: https://huggingface.co/google/gemma-4-12B-it
- Gemma 4 출시와 Apache-2.0 전환: https://www.implicator.ai/google-releases-gemma-4-under-apache-2-0-dropping-its-custom-ai-license/
- Gemma 4 12B 출시(2026-06-03): https://datanorth.ai/news/google-releases-gemma-4-12b
- Ministral 3 8B: https://huggingface.co/mistralai/Ministral-3-8B-Instruct-2512
- A.X 4.0 Light: https://huggingface.co/skt/A.X-4.0-Light
- Mi:dm 2.0 Mini: https://huggingface.co/K-intelligence/Midm-2.0-Mini-Instruct
- Mi:dm 2.0 Base: https://huggingface.co/K-intelligence/Midm-2.0-Base-Instruct
- Kanana 1.5 8B: https://huggingface.co/kakaocorp/kanana-1.5-8b-instruct-2505
- Kanana 1.5 Apache 공개: https://www.kakaocorp.com/page/detail/11566
- Kanana-2 3B: https://huggingface.co/kakaocorp/kanana-2-3b-instruct
- Kanana-2 라이선스: https://huggingface.co/kakaocorp/kanana-2-3b-instruct/blob/main/LICENSE
- Kanana-2 소형 해설: https://braindetox.kr/en/posts/kakao_kanana2_open_models_2026.html
- Tri-7B: https://huggingface.co/trillionlabs/Tri-7B
- HyperCLOVA X SEED 1.5B: https://huggingface.co/naver-hyperclovax/HyperCLOVAX-SEED-Text-Instruct-1.5B
- HyperCLOVA X SEED Think 14B: https://huggingface.co/naver-hyperclovax/HyperCLOVAX-SEED-Think-14B
- HyperCLOVA X SEED 라이선스 원문: https://scancode-licensedb.aboutcode.org/hyperclova-x-seed-2025.html
- 8B Omni·32B Think: https://clova.ai/en/tech-blog/hyperclova-x-omni-koreas-flagship-ai-on-the-road-to-omnimodality
- EXAONE 4.0 1.2B: https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-1.2B
- EXAONE NC 라이선스 원문: https://scancode-licensedb.aboutcode.org/exaone-ai-model-1.2-nc.html
- EXAONE 4.5: https://huggingface.co/LGAI-EXAONE/EXAONE-4.5-33B , https://letsdatascience.com/news/lg-unveils-exaone-45-multimodal-ai-model-1ff108ad
- K-EXAONE 2.0 [2차]: https://ai-revolution.co.jp/media/what-is-k-exaone-2/
- Solar Open 2 [2차]: https://en.wikipedia.org/wiki/Upstage_(company)
- Llama 4 Scout: https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct
- gpt-oss-20b: https://huggingface.co/openai/gpt-oss-20b
- GGUF 파일 크기: Hugging Face API `https://huggingface.co/api/models/<repo>/tree/main`
  - 확인한 저장소: unsloth/Qwen3.5-{2B,4B,9B}-GGUF, google/gemma-4-{E2B,E4B,12B}-it-qat-q4_0-gguf, unsloth/gemma-4-26B-A4B-it-GGUF, mistralai/Ministral-3-{3B,8B}-Instruct-2512-GGUF, LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF, naver-ellm/HyperCLOVAX-SEED-Think-14B-GGUF, mradermacher/kanana-2-3b-instruct-GGUF, mykor/A.X-4.0-Light-gguf, mykor/Midm-2.0-Mini-Instruct-gguf, Mungert/Midm-2.0-Base-Instruct-GGUF, DevQuasar/kakaocorp.kanana-1.5-8b-instruct-2505-GGUF, ggml-org/gpt-oss-20b-GGUF

런타임
- node-llama-cpp: https://node-llama-cpp.withcat.ai/guide/ , https://github.com/withcatai/node-llama-cpp
  - npm `npm view node-llama-cpp`, `@node-llama-cpp/win-x64{,-vulkan,-cuda,-cuda-ext}`로 버전·크기·MIT 확인
  - 패키지의 `llama/llama.cpp.info.json`에서 tag v0.5.0 확인
- llama.cpp 릴리스: https://github.com/ggml-org/llama.cpp/releases (GitHub API로 b11681 자산 크기, v0.5.0 날짜 확인)
- Ollama: https://docs.ollama.com/windows , https://github.com/ollama/ollama/releases (v0.40.5 자산 크기)
- LM Studio 약관: https://lmstudio.ai/app-terms
- llmster: https://lmstudio.ai/docs/app/basics/lmstudio-vs-llmster-vs-lms
- LM Studio SDK: https://lmstudio.ai/blog/introducing-lmstudio-sdk
- ONNX Runtime GenAI: https://github.com/microsoft/onnxruntime-genai/releases (v0.17.0)
- DirectML 유지보수 모드: https://learn.microsoft.com/windows/ai/directml/dml-min-app
- Foundry Local: https://github.com/microsoft/Foundry-Local
- WebLLM: npm `@mlc-ai/web-llm` 0.2.86

성능
- llama.cpp Vulkan 스코어보드: https://github.com/ggml-org/llama.cpp/discussions/10879
- CUDA 스코어보드 정리: https://knightli.com/en/2026/04/23/llama-cpp-gpu-benchmark-cuda-rocm-vulkan-scoreboard/ (원 출처 Discussion #15013)
- CPU 비교: https://github.com/ikawrakow/ik_llama.cpp/discussions/164
- CPU와 내장 GPU 비교 [2차, 검색 요약]: https://medium.com/@techhara/llama-cpp-benchmark-cpu-vs-igpu-93b3cc40ece5

호스팅
- OpenRouter 모델·가격 API: https://openrouter.ai/api/v1/models (2026-10-16 조회)
- Together 가격: https://www.together.ai/pricing
- Groq 모델·가격: https://console.groq.com/docs/models
- FriendliAI 가격 [2차]: https://friendli.ai/docs/guides/serverless_endpoints/pricing

정확도 관련
- DLM-NL2JSON-4B (한국어 JSON 추출 미세조정 사례, 제작사 보고): https://huggingface.co/dataslab/DLM-NL2JSON-4B
- 프로젝트 내부: `docs/school-events-design.md` (A/B 등급 기준, S6 처리 결과 47건)
