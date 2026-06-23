# CS Style Chat Agent

CS 티켓을 자동 분류하고 사용자별 말투에 적응하는 AI Agent 웹 서비스.

Pi Agent가 CS 문의를 분석·분류하고, 사용자의 언어 패턴에서 tone 파라미터(formality/warmth/directness/verbosity)를 추출해 맞춤형 답변을 생성하며, 피드백 루프로 지속 진화합니다.

## 주요 기능

- **CS 문의 자동 분류** — 환불/계정/기술/결제/일반 5개 카테고리 + 하위 유형
- **사용자 말투 분석** — formality/warmth/directness/verbosity 파라미터 관리
- **지식베이스 검색** — 분류된 카테고리의 FAQ/정책을 자동 조회해 답변에 포함
- **긴급도·감정 분석** — 긴급도(상/중/하) + 감정(화남/불안/중립/긍정) 판단
- **피드백 학습** — 사용자의 반응을 평가해 tone 파라미터를 차원별로 진화
- **Lobe Chat Web UI** — OpenAI 호환 API로 간단히 연동

## 기술 스택

| 기술 | 용도 |
|---|---|
| **Pi CLI** | 에이전트 오케스트레이션 (subprocess spawn) |
| **Ollama** | Qwen LoRA 모델 서빙 (qwen-cs, 1.5B GGUF) |
| **Lobe Chat** | Web UI (채팅 인터페이스) |
| **Express** | OpenAI 호환 API 서버 |
| **MCP** | knowledge-base (filesystem) + ticket-store (memory) — 시동 demo |
| **Node.js** | 서버 런타임 |

## 사전 준비

| 항목 | 설치 방법 | 필수 |
|------|----------|------|
| **Node.js 18+** | `node -v`로 확인 | 필수 |
| **Ollama** | `brew install ollama` | 필수 |
| **Pi CLI** | `npm install -g @earendil-works/pi-coding-agent` | 필수 |
| **Qwen GGUF 모델** | LoRA 병합 GGUF를 Ollama에 import | 필수 |
| **서버 의존성** | `cd server && npm install` | 필수 |
| **Docker** | Lobe Chat UI 사용 시에만 | 선택 |

```bash
# 1. Ollama 설치
brew install ollama

# 2. GGUF 모델 import (예시)
ollama create qwen-cs -f Modelfile

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

### 시나리오 1: tone 자동 분석 + CS 분류

```
사용자1 (?userId=user1): "환불 받고 싶어요 ㅠㅠ 친절하게 알려주세요"
  → classifyTicket: refund
  → loadTone: formality 0.5, warmth 0.5 (신규, 기본값)
  → loadKnowledge: 환불 정책 검색
  → "안녕하세요~ 환불 도와드릴게요! ..."

사용자2 (?userId=user2): "결제 오류. 로그ID ERR-942. 조치 바람."
  → classifyTicket: technical
  → loadTone: formality 0.8, directness 0.9 (기존)
  → "ERR-942 관련 조치사항입니다. ..."
```

### 시나리오 2: 피드백 학습으로 말투 진화

```
사용자1: "너무 딱딱해요"
  → evaluateResponse: dimensionFeedback { formality: -0.8 }
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
│   └── chat-tools.ts        # Pi Extension (6개 도구, Pi CLI 로드용)
├── server/
│   ├── cli.js               # CLI 실행기 (Lobe Chat 불필요)
│   ├── index.js             # Express API (OpenAI 호환)
│   ├── package.json
│   └── pi-agent.js          # Pi Agent 4단계 루프 (실제 실행 코드)
├── skills/
│   └── cs-style-adapter/
│       └── SKILL.md         # CS+tone 오케스트레이터
├── README.md
├── REPORT.md
└── SCRIPT.md
```

## Pi / Skill / MCP / Pi Extension 활용

| 구성 요소 | 활용 내용 |
|---|---|
| **Pi CLI** | `spawn("pi", ...)` subprocess로 Ollama Qwen 호출, Extension 도구 로드 |
| **Skill (1개)** | `cs-style-adapter` — 분류→프롬프트→LLM→피드백 4단계 오케스트레이션 규칙 정의 |
| **MCP (2개)** | `knowledge-base` (filesystem) + `ticket-store` (memory) — 시동 시 JSON-RPC demo에 사용 |
| **Extension (6개 도구)** | classify_ticket, extract_entities, build_system_prompt, call_llm, evaluate_response, update_user_tone |

> Extension 도구는 Pi CLI가 로드하지만, 1.5B 모델이 tool_call을 생성하지 못하므로 실제 실행은 pi-agent.js의 JS 함수가 직접 담당합니다.

## 라이선스

MIT
