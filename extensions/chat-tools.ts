import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const LLM_API = "http://localhost:11434/v1/chat/completions";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, isError };
}

function fixJSON(raw: string): string {
  try { JSON.parse(raw); return raw; } catch {}
  return raw
    .replace(/'/g, '"')
    .replace(/True/g, "true")
    .replace(/False/g, "false")
    .replace(/None/g, "null");
}

async function callLLM(system: string, user: string): Promise<string> {
  const res = await fetch(LLM_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen-cs",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 256,
      stream: false,
    }),
  });
  if (!res.ok) return "";
  const data = await res.json() as any;
  return (data.choices?.[0]?.message?.content || "").trim();
}

export default function (pi: ExtensionAPI) {

  // ── Provider: NVIDIA 등록 (Pi CLI 오케스트레이션용) ──────────
  pi.registerProvider("nvidia", {
    name: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: "NVIDIA_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });

  // ── 도구 1: CS 문의 분류 ──────────────────────────────────────
  pi.registerTool({
    name: "classify_ticket",
    label: "Classify Ticket",
    description: "CS 문의를 분석해 카테고리(refund/account/technical/billing/general)와 하위 유형, 긴급도, 감정을 분류한다. (MCP가 가져온 데이터를 받아 처리만 함)",
    parameters: Type.Object({
      text: Type.String({ description: "사용자 문의 텍스트" }),
    }),
    execute: async (_id, params) => {
      try {
        const text = params.text.trim();
        if (!text) return textResult(JSON.stringify({ category: "general", confidence: 0 }));

        // regex-only: LLM 호출 없음 (속도 최적화)
        const cats: Record<string, RegExp> = {
          refund: /환불|취소|돌려|refund|cancel/i,
          account: /로그인|비밀번호|계정|login|password/i,
          technical: /에러|오류|버그|설치|error|bug|crash/i,
          billing: /결제|요금|청구|영수증|billing|payment/i,
        };
        const matched = Object.entries(cats).find(([, re]) => re.test(text));
        const category = matched?.[0] || "general";
        const urgency = /급해|빨리|긴급|중요|빠른|오류|안됨$|고장/i.test(text) ? "high" : "medium";
        const sentiment = /ㅠㅠ|짜증|화나|불편|속상/i.test(text) ? "화남" : /ㅠ|죄송|걱정|어떡/i.test(text) ? "불안" : /감사|부탁|친절|고맙/i.test(text) ? "긍정" : "중립";
        return textResult(JSON.stringify({ category, subtype: "inquiry", confidence: 0.8, urgency, sentiment }));
      } catch (e: any) {
        return textResult(JSON.stringify({ category: "general", subtype: "inquiry", confidence: 0 }), true);
      }
    },
  });

  // ── 도구 2: 개체 추출 ──────────────────────────────────────────
  pi.registerTool({
    name: "extract_entities",
    label: "Extract Entities",
    description: "입력 텍스트에서 오류 코드, 금액, 이메일 등 CS 관련 개체를 추출한다.",
    parameters: Type.Object({
      text: Type.String({ description: "분석할 텍스트" }),
    }),
    execute: async (_id, params) => {
      try {
        const text = params.text;
        const entities: Record<string, string[]> = {};
        entities.errorCodes = [...text.matchAll(/[A-Z]+-\d+/g)].map(m => m[0]);
        entities.amounts = [...text.matchAll(/(\d[\d,]*)\s*(원|달러|\$)/g)].map(m => m[0]);
        entities.emails = [...text.matchAll(/[\w.-]+@[\w.-]+\.\w+/g)].map(m => m[0]);
        const topics: string[] = [];
        if (/환불|취소|refund|cancel/i.test(text)) topics.push("환불");
        if (/로그인|비밀번호|계정|login|password/i.test(text)) topics.push("계정");
        if (/에러|오류|버그|error|bug/i.test(text)) topics.push("기술오류");
        if (/결제|요금|billing|payment/i.test(text)) topics.push("결제");
        return textResult(JSON.stringify({ topics, entities }));
      } catch (e: any) {
        return textResult(JSON.stringify({ topics: [], entities: {} }), true);
      }
    },
  });

  // ── 도구 3: 시스템 프롬프트 생성 ───────────────────────────────
  pi.registerTool({
    name: "build_system_prompt",
    label: "Build System Prompt",
    description: "tone 파라미터 + 카테고리 + knowledge + 감정을 바탕으로 Qwen에 전달할 system prompt를 생성한다.",
    parameters: Type.Object({
      strategy: Type.String({ description: "응답 전략 (JSON). tone, category, urgency, knowledge, sentiment 등 포함" }),
    }),
    execute: async (_id, params) => {
      try {
        const s = JSON.parse(fixJSON(params.strategy));
        const t = s.tone || {};

        const formality = typeof t.formality === "number" ? t.formality : 0.5;
        const warmth = typeof t.warmth === "number" ? t.warmth : 0.5;
        const directness = typeof t.directness === "number" ? t.directness : 0.5;
        const verbosity = typeof t.verbosity === "number" ? t.verbosity : 0.5;

        function pDesc(val: number, low: string, high: string): string {
          if (val <= 0.3) return low;
          if (val >= 0.7) return high;
          return `${low}와(과) ${high}의 중간 수준`;
        }

        const sections: string[] = [
          "당신은 CS(고객 지원) 상담사 AI입니다. 다음 가이드라인을 따라 응답을 생성하십시오.\n",
          `[격식 수준: ${Math.round(formality * 100)}%] ${pDesc(formality, "반말과 구어체를 자연스럽게 사용한다.", "존댓말을 사용하고 격식 있는 문어체를 쓴다.")}`,
          `[온도: ${Math.round(warmth * 100)}%] ${pDesc(warmth, "차분하고 건조한 톤으로 간결하게 전달한다.", "따뜻하고 정감 있는 톤으로 공감을 표현한다.")}`,
          `[직설성: ${Math.round(directness * 100)}%] ${pDesc(directness, "우회적이고 부드럽게 전달한다.", "직설적이고 명확하게 핵심을 전달한다.")}`,
          `[상세도: ${Math.round(verbosity * 100)}%] ${pDesc(verbosity, "핵심만 간결하게 전달한다.", "자세하게 설명하고 단계별로 안내한다.")}`,
        ];

        if (s.category) {
          sections.push(`\n분류된 카테고리: ${s.category}${s.subtype ? ` (${s.subtype})` : ""}`);
        }
        if (s.urgency) {
          sections.push(`긴급도: ${s.urgency}`);
          if (s.urgency === "high") sections.push("빠른 처리가 필요함을 인지하고, 우선 대응한다는 느낌을 준다.");
        }
        if (s.knowledge) {
          sections.push(`\n참고 knowledge: ${s.knowledge}`);
        }
        if (s.sentiment && s.sentiment !== "중립") {
          sections.push(`사용자 감정 상태: ${s.sentiment}. 감정에 적절히 공감하며 대응한다.`);
        }

        if (s.responseGuide) {
          sections.push(`\n[응답 가이드]`);
          try {
            const guide = typeof s.responseGuide === "string" ? JSON.parse(s.responseGuide) : s.responseGuide;
            if (guide.toneHint) sections.push(`말투 힌트: ${guide.toneHint}`);
            if (guide.policyFocus) sections.push(`정책 포커스: ${guide.policyFocus}`);
            if (guide.avoidPhrases?.length) sections.push(`피해야 할 표현: ${guide.avoidPhrases.join(", ")}`);
            if (guide.mustInclude) sections.push(`필수 포함: ${guide.mustInclude}`);
            if (guide.urgencyNote) sections.push(`긴급도 코멘트: ${guide.urgencyNote}`);
          } catch {}
        }

        sections.push(
          "\n출력 규칙:",
          "- 먼저 공감/확인 한마디, 해결책, 추가 안내 순서로 구성한다.",
          "- 모르는 정책은 '담당자 확인 후 안내드리겠습니다'라고 답변한다.",
          "- 한국어로 응답한다.",
          "- 답변만 생성한다. 부가 설명이나 메타 코멘트를 붙이지 않는다.",
        );

        return textResult(sections.join("\n"));
      } catch (e: any) {
        return textResult("[오류] system prompt 생성 실패: " + e.message, true);
      }
    },
  });

  // ── 도구 4: 로컬 LLM 호출 ─────────────────────────────────────
  pi.registerTool({
    name: "call_llm",
    label: "Call Local LLM",
    description: "Ollama 서버(localhost:11434)를 호출해 qwen-cs 모델의 응답을 받아온다.",
    parameters: Type.Object({
      messages: Type.String({ description: "대화 메시지 배열 (JSON 문자열)" }),
      systemPrompt: Type.String({ description: "적용할 system prompt" }),
    }),
    execute: async (_id, params) => {
      try {
        const messages = JSON.parse(fixJSON(params.messages));
        const systemContent = (params.systemPrompt || "").trim() || "당신은 CS 상담사 AI입니다. 사용자의 문의에 친절하게 답변하세요.";
        const validMessages = messages.filter(
          (m: any) => m && typeof m.content === "string" && m.content.trim().length > 0
        );
        const fullMessages = [
          { role: "system", content: systemContent },
          ...validMessages,
        ];

        const res = await fetch(LLM_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "qwen-cs",
            messages: fullMessages,
            temperature: 0.7,
            max_tokens: 2048,
            stream: false,
          }),
        });

        if (!res.ok) return textResult(`[오류] LLM API 오류: ${res.status}`, true);
        const data = await res.json() as any;
        return textResult(data.choices?.[0]?.message?.content || "");
      } catch (e: any) {
        return textResult(`[오류] LLM 호출 실패: ${e.message}`, true);
      }
    },
  });

  // ── 도구 5: 사용자 응답 평가 ──────────────────────────────────
  pi.registerTool({
    name: "evaluate_response",
    label: "Evaluate Response",
    description: "직전 에이전트 응답에 대한 사용자의 반응을 분석해 피드백 점수를 부여한다. score: -2~+2.",
    parameters: Type.Object({
      userId: Type.String({ description: "사용자 ID" }),
      agentResponse: Type.String({ description: "직전 에이전트 응답" }),
      userReply: Type.String({ description: "응답에 대한 사용자의 다음 메시지" }),
    }),
    execute: async (_id, params) => {
      try {
        const { agentResponse, userReply } = params;

        const system = "너는 AI 응답에 대한 사용자 반응을 평가하는 전문가다. 다음 JSON만 출력해.\n{\"score\": -2~+2, \"dimensionFeedback\": {\"formality\": -1~+1, \"warmth\": -1~+1, \"directness\": -1~+1, \"verbosity\": -1~+1}, \"satisfaction\": \"positive\"|\"neutral\"|\"negative\"|\"correction\", \"reason\": \"짧은 판단 이유\", \"adjust_tone\": true|false}\n- formality: 격식/딱딱함/반말에 대한 피드백\n- warmth: 따뜻함/공감/건조함에 대한 피드백\n- directness: 직설성/완곡/돌려말함에 대한 피드백\n- verbosity: 상세도/장황함/간결함에 대한 피드백\n- 0이면 해당 차원에 문제 없음";
        const prompt = `[에이전트 응답]\n${agentResponse}\n\n[사용자 반응]\n${userReply}`;

        const llmRaw = await callLLM(system, prompt);
        let result: any;
        try {
          result = JSON.parse(llmRaw);
        } catch {
          result = { score: 0, dimensionFeedback: { formality: 0, warmth: 0, directness: 0, verbosity: 0 }, satisfaction: "neutral", reason: "parse_fallback", adjust_tone: false };
        }

        const df = result.dimensionFeedback || {};
        return textResult(JSON.stringify({
          score: Math.max(-2, Math.min(2, result.score || 0)),
          dimensionFeedback: {
            formality: Math.max(-1, Math.min(1, df.formality ?? 0)),
            warmth: Math.max(-1, Math.min(1, df.warmth ?? 0)),
            directness: Math.max(-1, Math.min(1, df.directness ?? 0)),
            verbosity: Math.max(-1, Math.min(1, df.verbosity ?? 0)),
          },
          satisfaction: result.satisfaction || "neutral",
          reason: result.reason || "",
          adjust_tone: !!result.adjust_tone,
        }));
      } catch (e: any) {
        return textResult(JSON.stringify({ score: 0, dimensionFeedback: { formality: 0, warmth: 0, directness: 0, verbosity: 0 }, satisfaction: "neutral", reason: "error", adjust_tone: false }), true);
      }
    },
  });

  // ── 도구 6: 사용자 tone 업데이트 (순수 계산, fs 없음) ────────
  pi.registerTool({
    name: "update_user_tone",
    label: "Update User Tone",
    description: "현재 tone 파라미터, tone-profiler 추정치, 피드백 점수를 받아 새로운 tone 파라미터를 계산한다. (저장은 MCP가 담당)",
    parameters: Type.Object({
      currentTone: Type.String({ description: "현재 tone JSON (formality/warmth/directness/verbosity)" }),
      feedbackScore: Type.Number({ description: "-2 ~ +2 피드백 점수" }),
      adjustTone: Type.Boolean({ description: "말투 조정 필요 여부" }),
      toneEstimate: Type.Optional(Type.String({ description: "tone-profiler 추정치 JSON" })),
      dimensionFeedback: Type.Optional(Type.String({ description: "차원별 피드백 JSON (formality/warmth/directness/verbosity, 각 -1~+1)" })),
      note: Type.Optional(Type.String({ description: "변경 사유" })),
    }),
    execute: async (_id, params) => {
      try {
        const current = JSON.parse(params.currentTone);
        const tone = {
          formality: typeof current.formality === "number" ? current.formality : 0.5,
          warmth: typeof current.warmth === "number" ? current.warmth : 0.5,
          directness: typeof current.directness === "number" ? current.directness : 0.5,
          verbosity: typeof current.verbosity === "number" ? current.verbosity : 0.5,
        };

        const adjust: Record<string, number> = {};

        if (params.toneEstimate) {
          try {
            const estimated = JSON.parse(params.toneEstimate);
            for (const d of ["formality", "warmth", "directness", "verbosity"] as const) {
              if (typeof estimated[d] === "number") {
                const diff = estimated[d] - tone[d];
                tone[d] = Math.round(Math.max(0, Math.min(1, tone[d] + diff * 0.2)) * 100) / 100;
                adjust[d] = Math.round(diff * 0.2 * 100) / 100;
              }
            }
          } catch {}
        }

        if (params.dimensionFeedback) {
          try {
            const df = JSON.parse(params.dimensionFeedback);
            for (const dim of ["formality", "warmth", "directness", "verbosity"] as const) {
              if (typeof df[dim] === "number" && df[dim] !== 0) {
                const adj = Math.max(-0.1, Math.min(0.1, df[dim] * 0.1));
                tone[dim] = Math.round(Math.max(0, Math.min(1, tone[dim] + adj)) * 100) / 100;
                adjust[dim] = Math.round(((adjust[dim] || 0) + adj) * 100) / 100;
              }
            }
          } catch {}
        }

        if (params.adjustTone) {
          const note = params.note || "";
          if (/반말|존댓|격식/.test(note)) {
            tone.formality = Math.round(Math.max(0, Math.min(1, tone.formality + 0.1)) * 100) / 100;
            adjust.formality = (adjust.formality || 0) + 0.1;
          }
          if (/차갑|건조|따뜻|정감|감정/.test(note)) {
            tone.warmth = Math.round(Math.max(0, Math.min(1, tone.warmth + 0.1)) * 100) / 100;
            adjust.warmth = (adjust.warmth || 0) + 0.1;
          }
          if (/직설|완곡|돌려|직접/.test(note)) {
            tone.directness = Math.round(Math.max(0, Math.min(1, tone.directness + 0.1)) * 100) / 100;
            adjust.directness = (adjust.directness || 0) + 0.1;
          }
          if (/길|짧|상세|간결/.test(note)) {
            tone.verbosity = Math.round(Math.max(0, Math.min(1, tone.verbosity + 0.1)) * 100) / 100;
            adjust.verbosity = (adjust.verbosity || 0) + 0.1;
          }
        }

        const score = Math.max(-2, Math.min(2, params.feedbackScore));
        const drift = score * 0.02;
        tone.warmth = Math.round(Math.max(0, Math.min(1, tone.warmth + drift)) * 100) / 100;
        adjust.warmth = (adjust.warmth || 0) + drift;

        return textResult(JSON.stringify({
          updatedTone: tone,
          adjust,
        }));
      } catch (e: any) {
        return textResult(JSON.stringify({ updatedTone: null, error: e.message }), true);
      }
    },
  });
}
