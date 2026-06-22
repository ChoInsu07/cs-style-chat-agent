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

**화면**: MCP-first 7단계 에이전트 루프 다이어그램

**대사**:
MCP-first 7단계 에이전트 루프로 동작합니다.

Step 1: **MCP**로 사용자 tone 파라미터와 knowledge-base에서 관련 정책,
        ticket-store에서 과거 티켓 이력을 조회합니다.
Step 2: classify_ticket으로 문의를 분류하고 extract_entities로 개체를 추출합니다.
Step 3: **3개 서브에이전트를 병렬 실행**합니다.
        tone-profiler(언어→파라미터), ticket-analyzer(카테고리·긴급도·감정 통합),
        response-composer(응답 가이드).
Step 4: 결과를 통합해 CS + tone 맞춤 system prompt를 생성합니다.
Step 5: Qwen LoRA 모델로 최종 응답을 생성합니다.
Step 6: **update_user_tone으로 파라미터 계산 후 MCP로 저장**하고, 티켓도 저장합니다.
Step 7: **사용자의 다음 반응을 evaluate_response로 평가해 dimensionFeedback을 부여**하고
        tone을 차원별로 갱신합니다.

---

## Scene 4: Web UI 시연 (1:20 ~ 2:20)

**화면**: Lobe Chat 실제 실행 화면

**대사**:
실제 데모입니다.

**[시연 1 - 같은 CS 문의, 다른 사용자 다른 말투]**
먼저 user1로 "환불 받고 싶어요 ㅠㅠ" 입력합니다.
CoT 영역에 classify_ticket(refund) → tone-profiler(formality 0.2, warmth 0.8) →
knowledge-base(환불 정책 검색) → "안녕하세요~ 환불 도와드릴게요! ..." 응답.

이번에는 user2로 같은 내용을 "결제 오류입니다. 로그ID ERR-942." 입력.
tone-profiler가 formality 0.8, directness 0.9로 추정하고,
"ERR-942 관련 조치사항입니다. ..." 간결한 답변.

**[시연 2 - 피드백 학습]**
user1이 "말투가 너무 딱딱해요"라고 반응.
evaluate_response가 dimensionFeedback formality -0.8 반환.
update_user_tone이 formality 차원만 정확히 -0.08 조정.
다음 응답부터 덜 격식 있는 부드러운 톤으로 변경됩니다.

**[시연 3 - 신규 사용자 자동 처리]**
새로운 user3가 "비밀번호를 잊었어요" 입력.
MCP read_file에서 tone 파일 없으면 기본값 0.5로 처리.
tone-profiler가 첫 메시지에서 "반말, 간결" 분석해 formality 0.3 방향으로 수렴 시작.

---

## Scene 5: Pi / Skill / MCP / Extension 설명 (2:20 ~ 2:45)

**화면**: 4가지 구성요소 설명 슬라이드

**대사**:
네 가지 구성요소입니다.

**Pi** — MCP-first 7단계 에이전트 루프, 서브에이전트 병렬 실행, 전체 오케스트레이션.

**Skill** — cs-style-adapter. 3개 서브에이전트 + MCP-first 순서 + 피드백 루프 규칙 정의.

**MCP** — knowledge-base(filesystem)로 FAQ/정책 5개 카테고리 검색,
ticket-store(memory)로 사용자 티켓 이력 저장·조회.
읽기와 쓰기를 모두 수행하며, Extension은 순수 계산만 담당합니다.

**Extension** — 6개 순수 계산 도구.
classify_ticket, call_llm, evaluate_response,
update_user_tone 등이 핵심입니다.

**Web UI** — Lobe Chat. CoT로 7단계 추론 과정 전부 시각화.

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

- [ ] `llama-server -m model/model.gguf --port 8000`
- [ ] `cd server && node index.js` (port 9090)
- [ ] Lobe Chat Docker 실행 (port 3210)
- [ ] user1 "환불 받고 싶어요 ㅠㅠ" → refund 분류 + tone 분석 응답 확인
- [ ] user2 "결제 오류 ERR-942" → technical 분류 + 건조한 톤 응답 확인
- [ ] user1 "말투가 너무 딱딱해요" → score -1 → tone(formality -0.1) 변화 확인
- [ ] 새로운 user3로 접속 → MCP read_file 기본값(0.5) + 첫 메시지 tone-profiler 분석 확인
- [ ] Lobe Chat CoT 활성화 확인

### 특별 연출 팁
- 시연 전 `data/tone/` 디렉토리 비우기 (완전 초기화)
- user1→user2 전환 시 CoT에 tone-profiler 결과가 다르게 표시되는 부분 캡처
- Lobe Chat CoT 영역에서 evaluate_response, update_user_tone 호출 캡처
