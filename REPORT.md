# CS Style Chat Agent — 프로젝트 보고서 자료

---

## 1. 선택한 시나리오

**CS 티켓 분류 + 말투 적응 Agent** — 문의 내용을 카테고리/긴급도로 자동 분류하고, 사용자의 언어 패턴에서 tone 파라미터(formality/warmth/directness/verbosity)를 추출해 맞춤형 답변을 생성하며, 실시간 피드백으로 말투를 지속 학습하는 에이전트 서비스

## 2. 문제 정의

### 현재 문제
- CS 상담에서 모든 사용자에게 동일한 말투로 응답 (긴급한 결제 오류에도 차분한 톤, 가벼운 문의에도 딱딱한 톤)
- 분류된 카테고리에 맞는 정책을 수동으로 찾아야 함
- **사용자의 피드백이 다음 상담에 전혀 반영되지 않음** (불만을 표현해도 계속 같은 말투)
- 같은 사용자가 재문의해도 이전 맥락이 유실됨

### 해결 방안
Pi Agent가 CS 문의를 자동 분류 + 사용자별 맞춤 말투 + 피드백 학습을 통합 처리

## 3. 서비스 대상 사용자

모든 CS 문의 사용자 (별도 가입 없이 X-User-Id 헤더 + ?userId= query parameter fallback으로 자동 식별)

| 사용자 예시 | tone 파라미터 (수렴 후) | 설명 |
|---|---|---|
| user1 (alice) | formality:0.2, warmth:0.9, directness:0.6, verbosity:0.8 | 반말·따뜻·자세한 안내 선호 |
| user2 (bob) | formality:0.7, warmth:0.3, directness:0.9, verbosity:0.4 | 존댓말·직설·간결 선호 |
| 신규 사용자 | formality:0.5, warmth:0.5, directness:0.5, verbosity:0.5 | 기본값 → 첫 메시지부터 분석 시작 |

## 4. 핵심 기능

| 기능 | 설명 |
|---|---|
| **LLM 기반 문의 분류** | NVIDIA Llama 3.1 8B가 classify_ticket tool_call로 정규식 분류 실행 + 하위 구분 (항상 inquiry, fallback: pi-agent.js 직접 정규식) |
| **개체 추출** | 오류 코드, 금액, 이메일 등 CS 핵심 정보 추출 (NVIDIA + fallback 정규식) |
| **사용자 언어 프로파일링** | tone 파라미터(formality/warmth/directness/verbosity) 관리, 파일 저장 |
| **지식베이스 검색** | 분류된 카테고리에 맞는 FAQ/정책 자동 검색 (data/knowledge/*.json) |
| **긴급도·감정 분석** | 긴급도(상/중/하) + 감정(화남/불안/중립/긍정) 분석 |
| **동적 프롬프트 생성** | 4개 파라미터 → 자연어 가이드 + 분류 결과 + 정책 포함 |
| **피드백 루프** | 사용자 반응 → Ollama 1.5B 평가 → -2~+2 점수 + dimensionFeedback → tone 차원별 진화 |

## 5. 시스템 구조

```
Lobe Chat (Web UI)  ─── ?userId={userId} query param fallback
    ↓ OpenAI 호환 API (X-User-Id 헤더 우선)
API Server (Express) ─── 직전 응답 저장 (피드백 루프)
    ↓
Pi Agent (Two-Model + trace)
  Step 0: Tone 로드
     ┌───────────────────────────────────────────────┐
     │  loadTone()         — data/tone/{uid}.json   │
     └───────────────────────────────────────────────┘
  Step 1: NVIDIA Llama 3.1 8B 분류 (execFileSync)
     ┌───────────────────────────────────────────────┐
     │  callPiCLI_Agent() → pi --provider nvidia    │
     │    → meta/llama-3.1-8b-instruct              │
     │    + Korean examples (7개)                    │
     │    + --no-skills / --no-builtin-tools        │
     │    + --mode json → JSONL 파싱 (tool_execution │
     │  fallback: classifyTicket() 정규식            │
     └───────────────────────────────────────────────┘
     ↓ (분류 결과 기반)
     ┌───────────────────────────────────────────────┐
     │  loadKnowledge()  — data/knowledge/{category} │
     └───────────────────────────────────────────────┘
  Step 2: 시스템 프롬프트 생성
     ┌───────────────────────────────────────────────┐
     │  buildSystemPrompt() — tone+분류+정책 통합   │
     └───────────────────────────────────────────────┘
  Step 3: Ollama qwen-cs 응답 생성 (spawnSync)
     ┌───────────────────────────────────────────────┐
     │  callPiCLI() → pi --provider ollama          │
     │    → Ollama qwen-cs (Qwen2.5 1.5B GGUF)      │
     │    timeout: 60s                               │
     │  fallback: callOllama() (직접 HTTP API)       │
     └───────────────────────────────────────────────┘
  Step 4: 피드백 처리 (다음 턴, prevResponse 있을 때)
     ┌───────────────────────────────────────────────┐
     │  evaluateResponse() → callOllama() 직접 평가 │
     │    → JSON 파싱 실패 시 "피드백 없음"          │
     │  updateTone() → saveTone() → data/tone/      │
     └───────────────────────────────────────────────┘

시동 시 MCP Demo:
  spawn MCP JSON-RPC 서버 (knowledge-base + ticket-store)
    → JSON-RPC initialize → tools/call demo
    → 프로세스 종료 (상시 실행 아님)
```

## 6. Skill 활용 방식

**파일**: `skills/cs-style-adapter/SKILL.md`

| 역할 | 내용 |
|---|---|
| 오케스트레이션 | 분류(NVIDIA) → 프롬프트 → 생성(Ollama) → 피드백 순서 정의 |
| 응답 전략 | tone 파라미터 + 카테고리 + 긴급도 + knowledge 반영 |
| 피드백 처리 | evaluate 결과 → updateUserTone 호출 → 파일 저장 |
| 사용자 처리 | 신규 사용자는 tone 자동 생성, 기존은 이력 기반 |
| NVIDIA agent prompt | 한국어 CS 분류 예제 7개 포함 (환불/계정/기술/결제 매핑) |

> SKILL.md는 오케스트레이션 가이드 역할을 하며, **`--no-skills` 플래그로 SKILL.md의 프롬프트 주입을 비활성화**하고 pi-agent.js의 JS 코드가 직접 오케스트레이션을 수행함.

## 7. MCP 활용 방식

| MCP 서버 | 프로토콜 | 역할 | 데이터 |
|---|---|---|---|
| `knowledge-base` | filesystem(./data/) | CS FAQ/정책 조회 | `data/knowledge/{category}.json` (5개 카테고리) |
| `ticket-store` | memory | 티켓 이력 저장 및 검색 | `data/tickets/tickets.json` |

- MCP 서버는 **시동 시 JSON-RPC demo**에서만 spawn되고 tools/call을 수행
- 실제 에이전트 실행에서는 MCP 프로세스를 띄우지 않음
  - 이유: 1.5B 모델이 `<tool_call>`을 생성하지 못하므로, MCP 툴을 모델이 자동 호출할 수 없음
  - 모든 파일 I/O는 Node.js `readFileSync/writeFileSync`로 직접 수행 (pi-agent.js 내 함수)
- Extension은 순수 계산만 수행하며, 파일 I/O는 MCP를 통하지 않음

## 8. Pi Extension 활용 방식

**파일**: `extensions/chat-tools.ts` (6개 순수 계산 도구)

| 도구명 | 설명 | 실제 실행 |
|---|---|---|
| `classify_ticket` | 정규식 기반 CS 문의 분류 (5개 카테고리 + 긴급도 + 감정) | **NVIDIA agent**가 Pi CLI tool_call로 호출 (JSONL 파싱) |
| `extract_entities` | 오류 코드, 금액, 이메일 등 CS 개체 추출 | **NVIDIA agent**가 Pi CLI tool_call로 호출 |
| `build_system_prompt` | tone 파라미터 + CS 맥락 → system prompt 생성 | **JS 함수 직접 호출** (model 비사용) |
| `call_llm` | Pi CLI subprocess를 통한 Ollama Qwen 호출 | **미사용** — JS 함수(`callPiCLI`/`callOllama`)가 직접 실행 |
| `evaluate_response` | 사용자 반응 → 피드백 점수(-2~+2) + dimensionFeedback | **JS 함수 직접 호출** (내부적으로 `callOllama()` HTTP 직접 호출) |
| `update_user_tone` | dimensionFeedback 차원별 반영 + feedback drift(±0.02) | **JS 함수 직접 호출** (`updateTone()`) |

> Extension 도구는 Pi CLI에서 로드되어 등록되지만, **1.5B 모델(Qwen)이 자동으로 tool_call을 생성하지 못함**. NVIDIA 8B agent는 `classify_ticket`/`extract_entities`의 tool_call을 정상 생성하나, 나머지 도구는 pi-agent.js의 JS 함수가 직접 실행함. `call_llm`은 등록만 되어 있고 실제 호출에는 사용되지 않음.

## 9. Web UI 설명

**Lobe Chat** 채택 이유:
- OpenAI 호환 API — 커스텀 서버를 간단히 등록
- Docker 한 줄 배포, 코드 수정 불필요
- **Lobe Chat 포크 안 함**: X-User-Id 헤더를 설정할 수 없으므로 `?userId=` query parameter fallback으로 우회

**CLI 모드 병행 제공** (`server/cli.js`):
- Lobe Chat 없이도 `node server/cli.js -u user1`로 대화형 테스트 가능
- Ollama 스타일의 프롬프트(`> `)에서 메시지 입력, `/quit` 종료
- `--log` 플래그로 전체 Agent 로그 출력

## 10. 구현 결과 (평가 항목 대응)

| 평가 항목 | 비중 | 달성 내용 |
|---|---|---|
| 아이디어/문제 정의 | 20% | CS 분류 + 말투 적응 + 피드백 학습 하이브리드, 실사용 가치 높음 |
| Pi 활용도 | 20% | Pi CLI subprocess 오케스트레이션 + NVIDIA provider 분류 + Ollama provider 생성 + 5단계 two-model 에이전트 루프 |
| Skill/MCP/Extension | 25% | Skill 1개 (+ `--no-skills`로 프롬프트 비활성화) + MCP 2개 (시동 시 JSON-RPC demo) + Extension 6개 도구 등록 및 2개(NVIDIA) tool_call 실행 |
| Web UI | 15% | Lobe Chat + query param fallback 완비 |
| GitHub | 10% | 구조적 README + 설치/실행법 |
| 보고서/영상 | 10% | 본 문서 + 대본 기반 영상 |

## 11. 한계점 및 개선 방향

| 한계 | 개선 방향 |
|---|---|---|
| 분류 로직이 정규식 기반이라 한국어 변형·오타·비정형 문장에 취약 (NVIDIA는 tool_call 오케스트레이션만 담당) | 경량 분류 모델(KoBERT 등) 별도 배치 |
| `spawn("pi")`가 macOS+fnm 환경에서 hang — 동기 방식(spawnSync) 사용으로 인한 6~10s 지연 | Pi SDK 직접 임포트 또는 Ollama/NVIDIA API 직접 호출 (0.4~2s) |
| `evaluateResponse()`의 1.5B 모델 JSON 출력 불안정 — 피드백 루프가 자주 실패 | `autoAdjustTone()` 감정/긴급도 기반 fallback 도입 |
| MCP가 시동 demo에서만 사용되고 실제 에이전트 실행에서는 미사용 | MCP 서버 상시 실행 + 모델이 tool_call 하도록 프롬프트 개선 |
| dimensionFeedback이 4개 차원만 커버 (전문성, 응답속도 등 반영 안 됨) | 차원 확장 (accuracy, responseTime, expertise 등) |
| 단일 사용자 tone만 추적 | 다중 채널/팀 단위 통합 프로필 |
| Lobe Chat 종속 Web UI | 자체 커스텀 UI 개발 |
| knowledge-base 정적 JSON | 동적 CMS 연동 또는 자동 업데이트 |
| query param fallback이 모든 사용자 식별 케이스 커버 불가 | Lobe Chat 플러그인 개발 (헤더 전송 지원) |
| `--no-skills`로 SKILL.md 우회 — Skill의 오케스트레이션 역할이 제한적 | skill 프롬프트를 모델이 따르도록 최적화 |
