# CS Style Chat Agent — 발표 영상 대본 (약 3분)

---

## Scene 1: 인트로 (0:00 ~ 0:20)

**화면**: 프로젝트명 + 구조 다이어그램

**대사**:
안녕하세요. **CS Style Chat Agent**입니다.

CS 문의를 자동 분류하면서도 사용자마다 다른 말투로 응답하고,
피드백을 통해 점점 더 잘 맞는 말투로 진화하는 AI Agent 시스템입니다.

---

## Scene 2: 문제 정의 (0:20 ~ 0:45)

**화면**: 문제 설명 슬라이드 + 예시 대화

**대사**:
기존 CS 시스템의 문제는 세 가지입니다.

첫째, 모든 사용자에게 동일한 말투로 응답합니다.
긴급한 결제 오류에도 차분한 톤, 가벼운 문의에도 딱딱한 톤.

둘째, 분류된 카테고리에 맞는 정책을 상담사가 수동으로 찾아야 합니다.

셋째, 사용자가 "말투가 너무 딱딱해요"라고 불만을 표현해도
그 피드백이 다음 상담에 전혀 반영되지 않습니다.

이 프로젝트는 **Pi Agent가 CS 분류 + 말투 분석 + 피드백 학습**을
하나로 통합한 구조입니다.

---

## Scene 3: 시스템 구조 (0:45 ~ 1:20)

**화면**: 4단계 에이전트 루프 다이어그램

**대사**:
4단계 에이전트 루프로 동작합니다.

Step 1: **분류 + 컨텍스트 수집**.
classifyTicket으로 문의를 5개 카테고리로 분류하고, extractEntities로 오류 코드나 금액을 추출합니다.
동시에 사용자의 tone 파라미터와 관련 CS 정책을 파일에서 읽어옵니다.

Step 2: **시스템 프롬프트 생성**.
수집된 tone 파라미터와 분류 결과, 정책 정보를 하나의 system prompt로 통합합니다.

Step 3: **Pi CLI subprocess로 LLM 호출**.
Pi CLI를 spawn하여 Ollama의 qwen-cs 모델(1.5B LoRA)로 최종 응답을 생성합니다.

Step 4: **피드백 처리**.
사용자의 다음 반응이 오면 evaluateResponse로 평가하고 tone 파라미터를 갱신합니다.

시동 시에는 MCP 서버를 실제로 spawn하여 JSON-RPC 통신 데모를 수행합니다.

---

## Scene 4: Web UI 시연 (1:20 ~ 2:20)

**화면**: Lobe Chat 실제 실행 화면

**대사**:
실제 데모입니다.

**[시연 1 - 같은 CS 문의, 다른 사용자 다른 말투]**
먼저 user1로 "환불 받고 싶어요 ㅠㅠ" 입력합니다.
classifyTicket(refund) → tone 기본값(formality 0.5) → knowledge-base(환불 정책) →
"안녕하세요~ 환불 도와드릴게요! ..." 응답.

이번에는 user2로 "결제 오류입니다. 로그ID ERR-942." 입력.
user2는 이미 formality 0.8, directness 0.9로 학습된 상태.
"ERR-942 관련 조치사항입니다. ..." 간결한 답변.

**[시연 2 - 피드백 학습]**
user1이 "말투가 너무 딱딱해요"라고 반응.
evaluateResponse가 dimensionFeedback formality -0.8 반환.
updateTone이 formality 차원만 정확히 -0.08 조정.
다음 응답부터 덜 격식 있는 부드러운 톤으로 변경됩니다.

**[시연 3 - 신규 사용자 자동 처리]**
새로운 user3가 "비밀번호를 잊었어요" 입력.
tone 파일 없으면 기본값 0.5로 시작.

---

## Scene 5: Pi / Skill / MCP / Extension 설명 (2:20 ~ 2:45)

**화면**: 4가지 구성요소 설명 슬라이드

**대사**:
네 가지 구성요소입니다.

**Pi CLI** — subprocess spawn 방식으로 Ollama Qwen을 호출합니다.
Extension 도구를 로드하지만, 1.5B 모델은 tool_call을 자동 생성하지 못하므로
실제 도구 실행은 pi-agent.js의 JS 함수가 직접 담당합니다.

**Skill** — cs-style-adapter. 4단계 분류→프롬프트→LLM→피드백 순서를 정의합니다.

**MCP** — knowledge-base(filesystem)와 ticket-store(memory).
시동 시 JSON-RPC 프로토콜로 실제 spawn되어 tools/call 데모를 수행합니다.
에이전트 실행 중에는 직접 파일 I/O를 사용합니다.

**Extension** — 6개 순수 계산 도구.
classify_ticket, evaluate_response, update_user_tone 등이 핵심입니다.

**Web UI** — Lobe Chat. OpenAI 호환 API로 연동됩니다.

---

## Scene 6: 마무리 (2:45 ~ 3:00)

**화면**: 요약 + GitHub

**대사**:
이 프로젝트의 핵심은 **CS 분류와 말투 적응과 피드백 학습을 하나의 에이전트 루프로 통합**했다는 점입니다.

사용할수록 사용자에게 더 잘 맞는 말투로 진화하고,
동시에 CS 처리 효율도 높아집니다.

감사합니다.

---

## 시연 준비 체크리스트

- [ ] `ollama serve` 실행 중 확인
- [ ] `ollama list`에 `qwen-cs` 모델 존재 확인
- [ ] `cd server && node index.js` (port 9090)
- [ ] Lobe Chat Docker 실행 (port 3210)
- [ ] user1 "환불 받고 싶어요 ㅠㅠ" → refund 분류 + tone 분석 응답 확인
- [ ] user2 "결제 오류 ERR-942" → technical 분류 + 건조한 톤 응답 확인
- [ ] user1 "말투가 너무 딱딱해요" → score -1 → tone(formality -0.1) 변화 확인
- [ ] 새로운 user3로 접속 → tone 기본값(0.5) 확인

### 특별 연출 팁
- 시연 전 `data/tone/` 디렉토리 비우기 (완전 초기화)
- user1→user2 전환 시 tone 차이를 강조하여 설명
- CLI 모드로 먼저 시연 후 Lobe Chat 전환도 가능
