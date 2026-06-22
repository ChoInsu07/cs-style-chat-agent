# CS Style Chat Agent

CS 티켓을 자동 분류하고 사용자별 말투에 적응하는 AI Agent 웹 서비스.

Pi Agent가 CS 문의를 분석·분류하고, 사용자의 언어 패턴에서 tone 파라미터(formality/warmth/directness/verbosity)를 추출해 맞춤형 답변을 생성하며, 피드백 루프로 지속 진화합니다.

## 주요 기능

- **CS 문의 자동 분류** — 환불/계정/기술/결제/일반 5개 카테고리 + 하위 유형
- **사용자 말투 분석** — tone-profiler가 첫 메시지부터 formality/warmth/directness/verbosity 실시간 추정
- **지식베이스 검색** — 분류된 카테고리의 FAQ/정책을 자동 조회해 답변에 포함
- **긴급도·감정 분석** — 긴급도(상/중/하) + 감정(화남/불안/중립/긍정) 판단
- **피드백 학습** — 사용자의 반응을 평가해 tone 파라미터를 차원별로 진화
- **Lobe Chat CoT 시각화** — 에이전트의 7단계 추론 과정을 실시간 표시

## 기술 스택

| 기술 | 용도 |
|---|---|
| **Pi** | 에이전트 오케스트레이션 |
| **llama.cpp** | Qwen LoRA 모델 서빙 |
| **Lobe Chat** | Web UI (채팅 인터페이스 + CoT 시각화) |
| **Express** | OpenAI 호환 API 서버 |
| **MCP** | knowledge-base (filesystem) + ticket-store (memory) |
| **Node.js** | 서버 런타임 |

## 설치 방법

### 1. 사전 준비

- Node.js 18+
- Pi CLI 설치
- Docker (Lobe Chat)
- Qwen GGUF LoRA 모델

```bash
# Pi CLI 설치
npm install -g @earendil-works/pi-coding-agent
```

### 2. 저장소 클론

```bash
git clone https://github.com/YOUR_USERNAME/cs-style-chat-agent.git
cd cs-style-chat-agent
```

### 3. 서버 의존성 설치

```bash
cd server && npm install
```

### 4. GGUF 모델 준비

`model/` 디렉토리에 Qwen GGUF 파일 (LoRA 병합)을 배치합니다.

## 실행 방법

---

### CLI 실행 (Lobe Chat 불필요)

전제 조건: llama.cpp 서버(port 8000) + API 서버(port 9090)만 실행

```bash
# llama.cpp 서버
llama-server -m model/model.gguf --port 8000

# API 서버
cd server && node index.js
```

```bash
# 단일 문의
node server/cli.js -u user1 -m "환불 받고 싶어요"

# 대화형 모드 (입력란에서 주고받기)
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

---

### UI 실행 (Lobe Chat)

전제 조건: llama.cpp 서버(port 8000) + API 서버(port 9090) + Docker

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
  → tone-profiler: formality 0.3, warmth 0.8
  → classify_ticket: refund
  → MCP knowledge-base: 환불 정책 검색
  → "안녕하세요~ 환불 도와드릴게요! ..."

사용자2 (?userId=user2): "결제 오류. 로그ID ERR-942. 조치 바람."
  → tone-profiler: formality 0.8, directness 0.9
  → classify_ticket: technical
  → "ERR-942 관련 조치사항입니다. ..."
```

### 시나리오 2: 피드백 학습으로 말투 진화

```
사용자1: "너무 딱딱해요"
  → evaluate_response: dimensionFeedback { formality: -0.8 }
  → update_user_tone: formality -0.08 (formality 차원만 정확히 조정)
  → 다음 응답부터 덜 격식 있는 부드러운 톤으로 변경
```

## 프로젝트 구조

```
cs-style-chat-agent/
├── .mcp.json                # MCP 설정 (knowledge-base + ticket-store)
├── .pi/agents/              # 서브에이전트 (3개)
│   ├── tone-profiler.md
│   ├── ticket-analyzer.md
│   └── response-composer.md
├── data/
│   ├── knowledge/           # FAQ/정책 데이터 (5개 카테고리)
│   ├── tickets/             # 티켓 이력 (자동 생성)
│   └── tone/                # tone 파라미터 (자동 생성)
├── extensions/
│   └── chat-tools.ts        # Pi Extension (6개 도구)
├── model/                   # GGUF 모델 (직접 배치)
├── server/
│   ├── cli.js               # CLI 실행기 (Lobe Chat 불필요)
│   ├── index.js             # Express API (OpenAI 호환)
│   ├── package.json
│   └── pi-agent.js          # Pi Agent MCP-first 7단계 루프
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
| **Pi** | MCP-first 7단계 에이전트 루프, 서브에이전트 병렬 실행(3개), 도구 호출 |
| **Skill (1개)** | `cs-style-adapter` — MCP-first → Extension → subagent parallel → MCP-write 오케스트레이션 |
| **MCP (2개)** | `knowledge-base` (filesystem, data/ 전체) + `ticket-store` (memory) — 읽기/쓰기 모두 수행, Extension은 순수 계산만 |
| **Extension (6개 도구)** | classify_ticket, extract_entities, build_system_prompt, call_llm, evaluate_response, update_user_tone |

## 라이선스

MIT
