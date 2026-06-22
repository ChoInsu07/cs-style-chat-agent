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
Pi Agent가 MCP-first 7단계 + 피드백 루프로 CS 문의를 자동 분류 + 사용자별 맞춤 말투 + 피드백 학습을 통합 처리

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
| **LLM 기반 문의 분류** | Qwen으로 환불/계정/기술/결제/일반 분류 + 하위 유형 |
| **개체 추출** | 오류 코드, 금액, 이메일 등 CS 핵심 정보 추출 |
| **사용자 언어 프로파일링** | tone-profiler가 실제 메시지에서 formality/warmth/directness/verbosity 추정 |
| **지식베이스 검색** | MCP knowledge-base로 분류된 카테고리에 맞는 FAQ/정책 자동 검색 |
| **긴급도·감정 분석** | 긴급도(상/중/하) + 감정(화남/불안/중립/긍정) 분석 (ticket-analyzer 통합) |
| **동적 프롬프트 생성** | 4개 파라미터 → 자연어 가이드 + 정책 포함 |
| **피드백 루프** | 사용자 반응 → -2~+2 점수 → tone 파라미터 차원별 진화 |

## 5. 시스템 구조

```
Lobe Chat (Web UI)  ─── ?userId={userId} query param fallback
    ↓ OpenAI 호환 API (X-User-Id 헤더 우선)
API Server (Express) ─── 직전 응답 저장 (피드백 루프)
    ↓
Pi Agent (MCP-first 7단계 + 피드백)
  ┌─ MCP read ────────────────────────────────────────────┐
  │  knowledge-base: data/knowledge/{category}.json       │
  │  knowledge-base: data/tone/{userId}.json              │
  │  ticket-store:   사용자 티켓 이력 검색               │
  └───────────────────────────────────────────────────────┘
  ┌─ Extension (순수 계산) ───────────────────────────────┐
  │  classify_ticket + extract_entities                   │
  │  build_system_prompt + call_llm                       │
  │  evaluate_response + update_user_tone (계산만)        │
  └───────────────────────────────────────────────────────┘
  ┌─ Subagent parallel ───────────────────────────────────┐
  │  tone-profiler / ticket-analyzer / response-composer  │
  └───────────────────────────────────────────────────────┘
  ┌─ MCP write ───────────────────────────────────────────┐
  │  knowledge-base: data/tone/{userId}.json 저장         │
  │  ticket-store:   티켓 저장                            │
  └───────────────────────────────────────────────────────┘
  ┌─ Feedback Loop (다음 턴) ─────────────────────────────┐
  │  evaluate_response → update_user_tone(계산)           │
  │  → MCP write_file(data/tone/{userId}.json)            │
  └───────────────────────────────────────────────────────┘
```

## 6. Skill 활용 방식

**파일**: `skills/cs-style-adapter/SKILL.md`

| 역할 | 내용 |
|---|---|
| 오케스트레이션 | MCP-first → Extension → subagent parallel(3개) → MCP-write 순서 지휘 |
| 응답 전략 | tone 파라미터 + 카테고리 + 긴급도 + knowledge 반영 |
| 피드백 처리 | evaluate 결과 → update_user_tone 호출 → MCP 저장 |
| 사용자 처리 | 신규 사용자는 tone 자동 생성, 기존은 이력 기반 |

## 7. MCP 활용 방식

| MCP 서버 | 프로토콜 | 역할 | 데이터 |
|---|---|---|---|
| `knowledge-base` | filesystem(./data/) | CS FAQ/정책 + 사용자 tone 저장 및 조회 | `data/knowledge/{category}.json` (5개 카테고리) + `data/tone/{userId}.json` |
| `ticket-store` | memory | 사용자별 티켓 이력 저장 및 검색 | `data/tickets/tickets.json` |

- 2개 MCP 읽기 + 쓰기 수행
- **Extension은 직접 fs를 사용하지 않음**: 모든 파일 I/O는 MCP를 통해서만 이루어짐
- knowledge-base는 읽기/쓰기 모두 수행 (tone 저장 포함)
- ticket-store는 읽기/쓰기 모두 수행

## 8. Pi Extension 활용 방식

**파일**: `extensions/chat-tools.ts` (6개 순수 계산 도구)

| 도구명 | 설명 |
|---|---|
| `classify_ticket` | LLM 기반 CS 문의 분류 (5개 카테고리 + 하위 유형 + 긴급도 + 감정) |
| `extract_entities` | 오류 코드, 금액, 이메일 등 CS 개체 추출 |
| `build_system_prompt` | tone 파라미터 + CS 맥락 → system prompt 생성 |
| `call_llm` | llama.cpp Qwen 호출 |
| `evaluate_response` | 사용자 반응 → 피드백 점수(-2~+2) + dimensionFeedback(formality/warmth/directness/verbosity 각 -1~+1) |
| `update_user_tone` | tone-profiler 추정치 수렴(20%) + dimensionFeedback 차원별 직접 반영(우선) + feedback drift(±0.02) + adjust_tone 키워드(+0.1, fallback) 차원별 갱신 (저장은 MCP) |

**MCP 개선**: 기존 10개 도구에서 `get_user_tone`, `search_knowledge_base`, `search_ticket_memory`, `log_ticket` 4개를 제거하고 MCP가 직접 담당. Extension은 순수 계산만 수행하여 역할 분리가 명확해짐.

## 9. Web UI 설명

**Lobe Chat** 채택 이유:
- Chain of Thought(CoT) 시각화 — 에이전트의 7단계 추론 과정 표시
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
| Pi 활용도 | 20% | MCP-first 7단계 진정한 에이전트 루프 + 서브에이전트 병렬(3개) |
| Skill/MCP/Extension | 25% | Skill 1개 + MCP 2개 읽기/쓰기 + Extension 6개 순수 계산 도구 |
| Web UI | 15% | Lobe Chat + CoT 시각화 + query param fallback 완비 |
| GitHub | 10% | 구조적 README + 설치/실행법 |
| 보고서/영상 | 10% | 본 문서 + 대본 기반 영상 |

## 11. 한계점 및 개선 방향

| 한계 | 개선 방향 |
|---|---|
| LLM 기반 분류가 Qwen 자체를 사용해 느림 | 경량 분류 모델(bert 등) 별도 배치 |
| 파일시스템 MCP 확장성 한계 | ChromaDB / Notion MCP로 교체 |
| dimensionFeedback이 4개 차원만 커버 (전문성, 응답속도 등 반영 안 됨) | 차원 확장 (accuracy, responseTime, expertise 등) |
| 단일 사용자 tone만 추적 | 다중 채널/팀 단위 통합 프로필 |
| Lobe Chat 종속 Web UI | 자체 커스텀 UI 개발 |
| Pi subprocess 호출 방식 | Pi SDK 직접 임포트로 개선 |
| knowledge-base 정적 JSON | 동적 CMS 연동 또는 자동 업데이트 |
| query param fallback이 모든 사용자 식별 케이스 커버 불가 | Lobe Chat 플러그인 개발 (헤더 전송 지원) |
