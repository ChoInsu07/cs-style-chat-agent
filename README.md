# CS Style Chat Agent

CS 티켓을 자동 분류하고 사용자별 말투에 적응하는 Two-Model AI Agent 웹 서비스.

**Pi CLI agent loop**가 **NVIDIA Llama 3.1 8B**를 실행해 8개 Extension/MCP tool을 순차적으로 오케스트레이션하고, **Ollama qwen-cs (Qwen2.5 1.5B Instruct GGUF)**가 사용자의 tone 파라미터(formality/warmth/directness/verbosity)에 맞춤형 답변을 생성하며, 피드백 루프로 지속 진화합니다.

## 주요 기능

- **Pi CLI agent loop** — NVIDIA 8B가 8개 Extension/MCP tool을 순차적으로 tool_call하는 에이전트 루프
- **CS 문의 자동 분류** — classify_ticket tool (정규식)로 카테고리·긴급도·감정 분류
- **MCP knowledge-base** — 분류된 카테고리의 FAQ/정책을 JSON-RPC로 자동 조회
- **사용자 말투 분석** — formality/warmth/directness/verbosity 파라미터 관리, tone 파일 저장
- **Two-model 아키텍처** — NVIDIA 8B tool_call 오케스트레이션 → Ollama 1.5B GGUF 응답 생성
- **피드백 학습** — 사용자의 반응을 Ollama 1.5B로 평가해 tone 파라미터 차원별 진화
- **MCP ticket-store** — 상담 내역 JSON-RPC 기록
- **Agent trace 로그** — 모든 단계의 trace를 CLI --log로 확인 가능
- **Lobe Chat Web UI** — OpenAI 호환 API로 간단히 연동

## 기술 스택

| 기술 | 용도 |
|---|---|
| **Pi CLI** | 에이전트 오케스트레이션 (execFileSync agent loop) |
| **NVIDIA Llama 3.1 8B** | 8개 Extension/MCP tool 오케스트레이션 (Pi CLI --provider nvidia, agent loop) |
| **Ollama** | Qwen2.5 모델 서빙 (qwen-cs, 1.5B GGUF) |
| **Lobe Chat** | Web UI (채팅 인터페이스) |
| **Express** | OpenAI 호환 API 서버 |
| **MCP** | knowledge-base (filesystem) + ticket-store (memory) — Extension 통해 실제 호출 |
| **Node.js** | 서버 런타임 |

## 사전 준비

| 항목 | 설치 방법 | 필수 |
|------|----------|------|
| **Node.js 18+** | `node -v`로 확인 | 필수 |
| **Ollama** | `brew install ollama` | 필수 |
| **Pi CLI** | `npm install -g @earendil-works/pi-coding-agent` | 필수 |
| **Qwen2.5 GGUF 모델** | GGUF 파일을 Ollama에 import | 필수 |
| **서버 의존성** | `cd server && npm install` | 필수 |
| **Docker** | Lobe Chat UI 사용 시에만 | 선택 |

```bash
# 1. Ollama 설치
brew install ollama

# 2. GGUF 모델 import (Modelfile 필요)
# ollama create qwen-cs -f ./Modelfile

# 3. Pi CLI 설치
npm install -g @earendil-works/pi-coding-agent

# 4. 서버 의존성 설치
cd server && npm install
```

## 실행 방법

> 사전 준비의 모든 항목이 완료된 상태여야 합니다.

### 1. 서버 실행 (CLI / UI 공통)

```bash
# 터미널 1: Ollama 서버
ollama serve

# 터미널 2: Express API 서버 (포트 9090)
node server/index.js
```

### 2. CLI 실행 (Lobe Chat 불필요)

```bash
# 단일 문의
node server/cli.js -u user1 -m "환불 받고 싶어요"

# 대화형 모드
node server/cli.js -u user1

# 전체 Agent 로그 출력
node server/cli.js -u user1 -m "결제 오류입니다" --log
```

```
CLI 대화형 모드 화면 예시:

$ node server/cli.js -u user1

CS Style Chat Agent — 대화형 모드 (userId: user1)
종료하려면 /quit 입력

> 환불 받고 싶어요

🤖 안녕하세요~ 환불 도와드릴게요! ...
```

### 3. UI 실행 (Lobe Chat)

```bash
# Lobe Chat 실행
docker run -d -p 3210:3210 --name lobe-chat lobehub/lobe-chat
```

Lobe Chat 설정:
1. 브라우저에서 `http://localhost:3210?userId=user1` 접속
2. 설정 → 언어 모델 → OpenAI 호환 공급자 추가
3. 엔드포인트: `http://host.docker.internal:9090/v1`
4. 모델: `qwen-cs`
5. 사용자 전환: URL의 `userId` 파라미터 변경 (예: `http://localhost:3210?userId=user2`)

## 데모 시나리오

### 시나리오 1: tone 자동 분석 + CS 분류 (Two-Model)

```
사용자1 (?userId=user1): "환불 받고 싶어요 ㅠㅠ 친절하게 알려주세요"
  → loadTone: formality 0.5, warmth 0.5 (신규, 기본값)
  → execFileSync("pi", args): NVIDIA 8B agent loop 실행
    → tool #1 classify_ticket: refund, urgency: medium, sentiment: 불안
    → tool #2 extract_entities: 개체 추출
    → tool #3 read_knowledge_policy: MCP knowledge-base → 환불 정책
    → tool #4 build_system_prompt: tone+분류+정책 통합
    → tool #5 call_llm: Ollama qwen-cs 응답 생성
    → tool #6 evaluate_response: 피드백 평가
    → tool #7 update_user_tone: tone 업데이트
    → tool #8 save_ticket: MCP ticket-store 저장
  → "안녕하세요~ 환불 도와드릴게요! ..."

사용자2 (?userId=user2): "결제 오류. 로그ID ERR-942. 조치 바람."
  → loadTone: formality 0.7, directness 0.9 (기존)
  → Pi CLI agent loop → technical, urgency: high → ERR-942 관련 조치사항 응답
```

### 시나리오 2: 피드백 학습으로 말투 진화

```
# 1턴: 사용자 문의 → 에이전트 응답 (prevResponse 저장)
사용자1: "환불 받고 싶어요"
  → 8-tool pipeline 정상 실행 → 응답 생성
  → 서버가 응답을 prevResponse로 저장

# 2턴: 사용자 피드백 → evaluateResponse 실행 (prevResponse 존재)
사용자1: "너무 딱딱해요"
  → loadTone (기존)
  → Pi CLI agent loop (NVIDIA 8B)
  → ★ prevResponse 있음 → evaluateResponse(직전응답, "너무 딱딱해요")
  → dimensionFeedback { formality: -0.8 }
  → updateTone: formality -0.08
  → saveTone: data/tone/user1.json 갱신
  → 다음 응답부터 덜 격식 있는 부드러운 톤으로 변경
```

## 프로젝트 구조

```
cs-style-chat-agent/
├── .mcp.json                # MCP 설정 (knowledge-base + ticket-store)
├── data/
│   ├── knowledge/           # FAQ/정책 데이터 (5개 카테고리)
│   ├── tickets/             # 티켓 이력 (자동 생성)
│   └── tone/                # tone 파라미터 (자동 생성)
├── extensions/
│   └── chat-tools.ts        # Pi Extension (8개 도구, MCP JSON-RPC bridge 포함)
├── server/
│   ├── cli.js               # CLI 실행기 (Lobe Chat 불필요)
│   ├── index.js             # Express API (OpenAI 호환)
│   ├── package.json
│   └── pi-agent.js          # Pi Agent 8단계 two-model 루프 (+ SKILL.md 주입)
├── skills/
│   └── cs-style-adapter/
│       └── SKILL.md         # 8단계 CS+tone 오케스트레이터 (3404B)
├── README.md
├── REPORT.md
└── SCRIPT.md
```

## Pi / Skill / MCP / Pi Extension 활용

| 구성 요소 | 활용 내용 |
|---|---|
| **Pi CLI** | `execFileSync("pi", ...)`로 NVIDIA 8B agent loop 실행 — 8개 tool 순차적 tool_call + JSONL 이벤트 파싱 |
| **Skill (1개)** | `cs-style-adapter` (3404B) — 8단계 오케스트레이션 규칙, `loadSkillMd()`가 orchestration message에 주입되어 모델이 실행 순서 참조 |
| **MCP (2개)** | `knowledge-base` (filesystem) + `ticket-store` (memory) — Extension tool 내부 `callMCPTool()` JSON-RPC bridge로 실제 실행 |
| **Extension (8개 도구)** | classify_ticket, extract_entities, **read_knowledge_policy(MCP)**, build_system_prompt, call_llm, evaluate_response, update_user_tone, **save_ticket(MCP)** — 모두 NVIDIA 8B가 agent loop에서 tool_call |

> NVIDIA 8B agent는 Pi CLI agent loop에서 모든 8개 Extension/MCP tool을 순차적으로 tool_call합니다. `call_llm`이 Qwen2.5 1.5B를 HTTP 호출해 최종 CS 응답을 생성합니다. `read_knowledge_policy`는 MCP knowledge-base에서 정책 파일을, `save_ticket`은 MCP ticket-store에 상담 내역을 JSON-RPC로 저장합니다.

## 라이선스

MIT
