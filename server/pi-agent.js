import "dotenv/config";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  existsSync, readFileSync, writeFileSync, mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TONE_DIR = resolve(ROOT, "data/tone");
const KNOWLEDGE_DIR = resolve(ROOT, "data/knowledge");
const TICKET_DIR = resolve(ROOT, "data/tickets");
const OLLAMA_API = "http://localhost:11434/v1/chat/completions";

function toneLabel(key) {
  const labels = { warmth: "온도", formality: "격식", directness: "직설성", verbosity: "상세도" };
  return labels[key] || key;
}

// ── Tone ────────────────────────────────────────────────
function loadTone(userId) {
  const p = resolve(TONE_DIR, `${userId}.json`);
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  }
  return { formality: 0.5, warmth: 0.5, directness: 0.5, verbosity: 0.5 };
}
function saveTone(userId, tone) {
  try {
    if (!existsSync(TONE_DIR)) mkdirSync(TONE_DIR, { recursive: true });
    writeFileSync(resolve(TONE_DIR, `${userId}.json`), JSON.stringify(tone, null, 2));
  } catch {}
}

// ── classify_ticket (확장 도구 #1) ──────────────────────
function classifyTicket(text) {
  const cats = {
    refund: /환불|취소|돌려|refund|cancel/i,
    account: /로그인|비밀번호|계정|login|password/i,
    technical: /에러|오류|버그|설치|error|bug|crash/i,
    billing: /결제|요금|청구|영수증|billing|payment/i,
  };
  const matched = Object.entries(cats).find(([, re]) => re.test(text));
  const category = matched?.[0] || "general";
  const urgency = /급해|빨리|긴급|중요|빠른|오류|안됨$|고장/i.test(text) ? "high" : "medium";
  const sentiment = /ㅠㅠ|짜증|화나|불편|속상/i.test(text) ? "화남"
    : /ㅠ|죄송|걱정|어떡/i.test(text) ? "불안"
    : /감사|부탁|친절|고맙/i.test(text) ? "긍정" : "중립";
  return { category, subtype: "inquiry", urgency, sentiment };
}

// ── extract_entities (확장 도구 #2) ─────────────────────
function extractEntities(text) {
  return {
    errorCodes: [...text.matchAll(/[A-Z]+-\d+/g)].map(m => m[0]),
    amounts: [...text.matchAll(/(\d[\d,]*)\s*(?:원|달러|\$)/g)].map(m => m[0]),
    emails: [...text.matchAll(/[\w.-]+@[\w.-]+\.\w+/g)].map(m => m[0]),
  };
}

// ── build_system_prompt (확장 도구 #3) ──────────────────
function buildSystemPrompt(category, urgency, tone, sentiment, knowledge) {
  const t = tone || {};
  const parts = ["당신은 CS(고객 지원) 상담사 AI입니다."];

  const dims = [
    { label: "온도", key: "warmth", high: "따뜻하고 정감 있는 톤으로 공감하며 응답", low: "차분하고 건조한 톤으로 간결하게 전달" },
    { label: "격식", key: "formality", high: "존댓말과 격식 있는 문어체로 응답", low: "자연스러운 구어체로 편하게 응답" },
    { label: "직설성", key: "directness", high: "직설적이고 명확하게 핵심 전달", low: "부드럽게 돌려서 전달" },
    { label: "상세도", key: "verbosity", high: "자세하게 설명하고 단계별로 안내", low: "간결하게 핵심만 전달" },
  ];

  parts.push("\n[말투 가이드]");
  for (const d of dims) {
    const val = Math.round((t[d.key] ?? 0.5) * 100);
    const desc = val >= 60 ? d.high : val <= 40 ? d.low : "적절한 수준으로 응답";
    parts.push(`- ${d.label} ${val}%: ${desc}`);
  }

  parts.push(`\n분류: ${category}, 긴급도: ${urgency}`);
  if (sentiment && sentiment !== "중립") parts.push(`사용자 감정: ${sentiment}. 감정에 공감하며 응답합니다.`);
  if (knowledge) parts.push(`\n참고 정책: ${knowledge}`);

  parts.push("\n[출력 규칙]");
  parts.push("- 먼저 공감/확인, 해결책, 추가 안내 순서로 구성");
  parts.push("- 모르는 정책은 '담당자 확인 후 안내드리겠습니다'라고 답변");
  parts.push("- 한국어로 응답");
  parts.push("- 답변만 출력 (부가 설명이나 메타 코멘트 없음)");
  return parts.join("\n");
}

// ── loadKnowledge ──────────────────────────────────────
function loadKnowledge(category) {
  const p = resolve(KNOWLEDGE_DIR, `${category}.json`);
  if (existsSync(p)) {
    try { return readFileSync(p, "utf-8"); } catch {}
  }
  return null;
}

// ── Pi CLI Agent (NVIDIA Llama for classification) ────
async function callPiCLI_Agent(userMessage, tone, timeoutMs = 60000) {
  const agentPrompt =
`You are a CS inquiry classifier for a Korean CS center.

Available tools:
- classify_ticket(text): classifies CS inquiry → category, subtype, confidence, urgency, sentiment
- extract_entities(text): extracts error codes, amounts, emails, product names from text

Instructions:
1. Call classify_ticket with the user's original message
2. Call extract_entities with the user's original message
3. Then summarize in Korean

Examples:
- "환불 받고 싶어요 ㅠㅠ" → category: refund
- "비밀번호를 잊었어요" → category: account
- "결제 오류 5001이 떠요" → category: technical
- "로그인이 안 돼요" → category: account
- "구매 취소해주세요" → category: refund
- "에러 코드 E-404 발생" → category: technical
- "영수증 출력 부탁드려요" → category: billing

User tone profile: ${JSON.stringify(tone)}`;

  const args = [
    "--provider", "nvidia",
    "--model", "meta/llama-3.1-8b-instruct",
    "--no-builtin-tools",
    "--no-skills",
    "--system-prompt", agentPrompt,
    "--mode", "json",
    "--print",
    userMessage,
  ];

  let raw = "";
  try {
    raw = execFileSync("pi", args, {
      cwd: ROOT,
      env: { ...process.env },
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    }).toString();
  } catch (e) {
    // execFileSync throws on non-zero exit; stdout is in e.stdout
    if (e.stdout) raw = e.stdout.toString();
    else throw e;
  }

  const lines = raw.split("\n").filter(Boolean);
  let classification = null;
  let entities = null;

  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "tool_execution_end") {
        const resultText = evt.result?.content?.[0]?.text || "";
        const toolName = evt.toolName || evt.tool?.name || "";
        try {
          const parsed = JSON.parse(resultText);
          if (toolName === "classify_ticket") classification = parsed;
          else if (toolName === "extract_entities") entities = parsed;
        } catch {
          // not JSON result, skip
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }


  return { classification, entities };
}

// ── Pi CLI Subprocess (Ollama qwen-cs for generation) ──
async function callPiCLI(systemPrompt, messages, timeoutMs = 60000) {
  const lastMsg = messages[messages.length - 1];
  const isMultiTurn = messages.length > 1;

  let finalPrompt = systemPrompt;
  if (isMultiTurn) {
    const historyText = messages.slice(0, -1).map(m =>
      `[${m.role === "user" ? "사용자" : "상담사"}]\n${m.content}`
    ).join("\n\n");
    finalPrompt += `\n\n## 대화 기록\n\n${historyText}`;
  }

  const proc = spawnSync("pi", [
    "--provider", "ollama",
    "--model", "qwen-cs",
    "--system-prompt", finalPrompt,
    "--print", lastMsg.content,
  ], {
    cwd: ROOT,
    env: { ...process.env },
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = (proc.stdout || "").toString().trim();
  const stderr = (proc.stderr || "").toString().trim();
  const outputText = stdout || stderr;
  if (outputText.length > 0) return outputText;
  throw new Error(stderr || `exit ${proc.status}`);
}

// ── Direct Ollama (fallback) ────────────────────────────
async function callOllama(messages, temperature = 0.7, maxTokens = 1024) {
  const res = await fetch(OLLAMA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "qwen-cs", messages, temperature, max_tokens: maxTokens, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// ── evaluate_response (확장 도구 #5) ────────────────────
async function evaluateResponse(agentResponse, userReply) {
  const sys = "You evaluate CS responses. Output ONLY valid JSON: {\"score\": -2~+2, \"dimensionFeedback\": {\"formality\": -1~+1, \"warmth\": -1~+1, \"directness\": -1~+1, \"verbosity\": -1~+1}, \"adjust_tone\": true|false}";
  const raw = await callOllama([
    { role: "system", content: sys },
    { role: "user", content: `[Agent Response]\n${agentResponse}\n\n[User Reply]\n${userReply}` },
  ], 0.1, 256);
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/'/g, '"').replace(/(\w+):/g, '"$1":');
    const r = JSON.parse(cleaned);
    return {
      score: Math.max(-2, Math.min(2, r.score ?? 0)),
      dimensionFeedback: r.dimensionFeedback || {},
      adjust_tone: !!r.adjust_tone,
    };
  } catch { return null; }
}

// ── update_user_tone (확장 도구 #6) ─────────────────────
function updateTone(current, feedback) {
  if (!feedback) return current;
  const tone = { ...current };
  const df = feedback.dimensionFeedback || {};
  if (df.formality) tone.formality = Math.max(0, Math.min(1, tone.formality + df.formality * 0.1));
  if (df.warmth) tone.warmth = Math.max(0, Math.min(1, tone.warmth + df.warmth * 0.1));
  if (df.directness) tone.directness = Math.max(0, Math.min(1, tone.directness + df.directness * 0.1));
  if (df.verbosity) tone.verbosity = Math.max(0, Math.min(1, tone.verbosity + df.verbosity * 0.1));
  const drift = feedback.score * 0.02;
  tone.warmth = Math.max(0, Math.min(1, tone.warmth + drift));
  return tone;
}

// ── Main Agent (two-model: NVIDIA classify → Ollama GGUF generate) ─
export async function runPiAgent(userId, text, history = [], prevResponse = null) {
  const tone = loadTone(userId);
  const trace = [];
  const toneFile = resolve(TONE_DIR, `${userId}.json`);
  const isDefault = !existsSync(toneFile);
  console.log(`[TONE] user=${userId} warmth=${Math.round(tone.warmth * 100)}% formality=${Math.round(tone.formality * 100)}% directness=${Math.round(tone.directness * 100)}% verbosity=${Math.round(tone.verbosity * 100)}% (${isDefault ? "기본값" : "저장된 값"})`);
  trace.push(`📋 Tone: warmth=${Math.round(tone.warmth * 100)}% formality=${Math.round(tone.formality * 100)}% directness=${Math.round(tone.directness * 100)}% verbosity=${Math.round(tone.verbosity * 100)}% (${isDefault ? "기본값" : "저장된 값"})`);

  console.log("[PI] Ollama qwen-cs subprocess spawn");
  trace.push("🧩 Pi CLI → Ollama qwen-cs subprocess spawn");

  // Step 1: NVIDIA Llama 3.1 8B agent loop → classification
  let classification;
  let entities;
  console.log("[AGENT] calling NVIDIA agent for classification...");
  try {
    const agentResult = await callPiCLI_Agent(text, tone);
    if (agentResult?.classification) {
      classification = agentResult.classification;
      entities = agentResult.entities || extractEntities(text);
      console.log("[AGENT] NVIDIA result:", classification.category, classification.urgency, "entities:", !!agentResult.entities);
      trace.push(`🔧 Extension: classify_ticket → ${classification.category} (긴급도: ${classification.urgency})`);
      trace.push(`🔧 Extension: extract_entities → 오류코드:${entities?.errorCodes?.length || 0}개, 금액:${entities?.amounts?.length || 0}개, 이메일:${entities?.emails?.length || 0}개`);
    } else {
      console.log("[AGENT] no classification result, falling back to regex");
      classification = classifyTicket(text);
      entities = extractEntities(text);
      trace.push(`🔧 Extension: classify_ticket fallback(regex) → ${classification.category}`);
    }
  } catch (e) {
    console.log("[AGENT] agent call failed:", e.message, "- falling back to regex");
    classification = classifyTicket(text);
    entities = extractEntities(text);
    trace.push(`🔧 Extension: classify_ticket fallback(regex after error) → ${classification.category}`);
  }

  console.log(`[MCP] knowledge-base → ${classification.category}.json 로드`);
  trace.push(`📂 MCP: knowledge-base → ${classification.category}.json 로드`);
  const knowledge = loadKnowledge(classification.category);
  const systemPrompt = buildSystemPrompt(
    classification.category, classification.urgency, tone,
    classification.sentiment, knowledge
  );

  const messages = [
    ...history.slice(-4).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: text },
  ];

  console.log(`[SKILL] cs-style-adapter → buildSystemPrompt() (온도:${Math.round(tone.warmth * 100)}% 격식:${Math.round(tone.formality * 100)}% 직설성:${Math.round(tone.directness * 100)}% 상세도:${Math.round(tone.verbosity * 100)}%)`);
  trace.push(`📋 Skill: cs-style-adapter → buildSystemPrompt()에 말투값 반영 (온도:${Math.round(tone.warmth * 100)}%, 격식:${Math.round(tone.formality * 100)}%, 직설성:${Math.round(tone.directness * 100)}%, 상세도:${Math.round(tone.verbosity * 100)}%)`);

  // Step 2: Ollama qwen-cs (LoRA GGUF) for CS response generation
  try {
    const t2 = Date.now();
    const response = await callPiCLI(systemPrompt, messages);
    const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
    console.log(`[PI] Ollama qwen-cs 응답 생성 완료 (${elapsed}초)`);
    trace.push(`🧩 Pi CLI → Ollama qwen-cs 응답 생성 완료 (${elapsed}초)`);

    // Step 3: Feedback loop (evaluate → update tone)
    if (prevResponse) {
      try {
        const feedback = await evaluateResponse(prevResponse, text);
        if (feedback) {
          const before = { ...tone };
          const newTone = updateTone(tone, feedback);
          saveTone(userId, newTone);
          const changes = Object.keys(before).map(k =>
            `${toneLabel(k)} ${Math.round(before[k] * 100)}%→${Math.round((newTone[k] ?? before[k]) * 100)}%`
          ).join(", ");
          console.log(`[SKILL] evaluate_response → 피드백 반영 (score: ${feedback.score}) → ${changes}`);
          trace.push(`📋 Skill: evaluate_response → 피드백 반영 (score: ${feedback.score}) → ${changes}`);
        } else {
          console.log("[SKILL] evaluate_response → 피드백 없음");
          trace.push(`📋 Skill: evaluate_response → 피드백 없음`);
        }
      } catch {
        console.log("[SKILL] evaluate_response → 평가 실패");
        trace.push(`📋 Skill: evaluate_response → 평가 실패`);
      }
    }

    console.log(`[WEB] 응답 전송 (user=${userId})`);
    trace.push(`🖥️ Web UI → 응답 전송`);
    return {
      response,
      trace,
      fullLog: { model: "nvidia+ollama(qwen-cs)", userId, category: classification.category, entities },
    };
  } catch (err) {
    try {
      const t2 = Date.now();
      const fallbackMsgs = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];
      const response = await callOllama(fallbackMsgs);
      const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
      console.log(`[PI] → 직접 Ollama 호출 (fallback, ${elapsed}초)`);
      trace.push(`🧩 Pi CLI → 직접 Ollama 호출 (fallback, ${elapsed}초)`);
      console.log(`[WEB] 응답 전송 (user=${userId})`);
      trace.push(`🖥️ Web UI → 응답 전송`);
      return {
        response,
        trace,
        fullLog: { model: "direct-ollama(qwen-cs)", userId, category: classification.category, entities, fallback: true },
      };
    } catch (fallbackErr) {
      return { response: `[오류] ${err.message}`, fullLog: err.message, trace: [] };
    }
  }
}

// ── MCP Demonstration (JSON-RPC over stdio) ────────────
async function mcpToolSequence(command, args, env, tools) {
  const proc = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map();
  let idCounter = 1;

  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    } catch {}
  });

  const send = (method, params = {}) => {
    const id = idCounter++;
    const req = { jsonrpc: "2.0", id, method, params };
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej });
      proc.stdin.write(JSON.stringify(req) + "\n");
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); rej(new Error("MCP timeout")); }
      }, 20000);
    });
  };

  try {
    await send("initialize", {
      protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "cs-agent", version: "1.0.0" },
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const results = [];
    for (const t of tools) results.push(await send("tools/call", { name: t.name, arguments: t.args }));
    return results;
  } finally {
    rl.close();
    proc.kill();
  }
}

export async function mcpDemonstration() {
  const demo = { mcpServers: {}, operations: [], spawn: {} };

  const mcpPath = resolve(ROOT, ".mcp.json");
  if (!existsSync(mcpPath)) return { ok: false, reason: "no .mcp.json" };

  try {
    const config = JSON.parse(readFileSync(mcpPath, "utf-8"));
    demo.mcpServers = config.mcpServers;

    // knowledge-base: list data/ directory
    const kb = config.mcpServers["knowledge-base"];
    if (kb) {
      try {
        const results = await mcpToolSequence(kb.command, kb.args, kb.env || {}, [
          { name: "list_directory", args: { path: resolve(ROOT, "data") } },
        ]);
        demo.operations.push({ server: "knowledge-base", action: "list_directory(data/)", result: results[0] });
        demo.spawn["knowledge-base"] = "ok";
      } catch (e) {
        demo.operations.push({ server: "knowledge-base", action: "list_directory", error: e.message });
        demo.spawn["knowledge-base"] = e.message;
      }
    }

    // ticket-store: add a memory entry → list memories
    const ts = config.mcpServers["ticket-store"];
    if (ts) {
      try {
        const results = await mcpToolSequence(ts.command, ts.args, ts.env || {}, [
          { name: "add_memory", args: { key: "demo-ticket", content: JSON.stringify({ id: "demo-001", text: "MCP init via server-memory", ts: Date.now() }) } },
          { name: "search_memories", args: { query: "demo" } },
        ]);
        demo.operations.push({ server: "ticket-store", action: "add_memory + search_memories", result: results[1]?.memories || results[1] || results });
        demo.spawn["ticket-store"] = "ok";
      } catch (e) {
        demo.operations.push({ server: "ticket-store", action: "add_memory", error: e.message });
        demo.spawn["ticket-store"] = e.message;
      }
    }

    demo.ok = true;
  } catch (e) {
    demo.ok = false;
    demo.error = e.message;
  }

  return demo;
}

// ── Startup Validation ─────────────────────────────────
export async function validatePiSetup() {
  try {
    const proc = spawnSync("pi", ["--list-models"], {
      cwd: ROOT,
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 10000,
    });
    const stderr = (proc.stderr || "").toString();
    const output = stderr.trim();
    return {
      ok: output.includes("ollama") && output.includes("qwen-cs"),
      output,
    };
  } catch {
    return { ok: false, output: "error" };
  }
}
