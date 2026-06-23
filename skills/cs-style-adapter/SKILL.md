---
name: cs-style-adapter
description: CS 문의 처리 오케스트레이터. classify_ticket/extract_entities/build_system_prompt/call_llm/evaluate_response/update_user_tone Extension 도구로 문의 분석 및 맞춤형 응답 생성.
---

# CS 말투 적응 오케스트레이터

> Two-model agent: NVIDIA Llama 3.1 8B로 분류/계획, Ollama qwen-cs(GGUF LoRA)로 CS 응답 생성.

## 역할

CS 문의 처리 + 말투 적응형 오케스트레이터.
- **Extension 도구**를 순서대로 호출
- tone 파라미터(formality/warmth/directness/verbosity)에 따라 말투 조절
- 피드백 루프로 tone 파라미터 진화

## 도구 호출 순서 (NVIDIA agent loop)

도구 호출이 가능한 모델이 이 순서를 따라야 함:

1. `classify_ticket(text: 사용자문의)` → 카테고리/긴급도/감정 분류
2. `extract_entities(text: 사용자문의)` → 오류코드/금액/이메일 추출
3. `build_system_prompt(strategy: {tone, category, urgency, sentiment, knowledge})` → CS system prompt 생성
4. `call_llm(messages: 대화이력, systemPrompt: 3번 결과)` → Ollama qwen-cs 호출 → 최종 응답

## 입력 컨텍스트

- userId: 사용자 식별자
- tone: formality/warmth/directness/verbosity (0~1)
- category: refund/account/technical/billing/general
- urgency: high/medium/low
- sentiment: 화남/불안/긍정/중립
- knowledge: 관련 정책/FAQ
- history: 직전 대화 메시지 (최대 4개)

## 참고

- Extension 도구는 Pi CLI에서 로드됨
- 1.5B 모델은 tool_call을 생성하지 못하므로, 분류는 NVIDIA 8B, 생성은 Ollama qwen-cs (1.5B GGUF LoRA) 사용
- 파일 I/O는 pi-agent.js의 JS 함수가 직접 처리 (loadTone, loadKnowledge, saveTone)
- MCP 서버는 시동 시 JSON-RPC demo에만 사용
