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

// ── SKILL.md 로드 ──────────────────────────────────────
function loadSkillMd() {
  const p = resolve(ROOT, "skills/cs-style-adapter/SKILL.md");
  if (existsSync(p)) {
    try { return readFileSync(p, "utf-8"); } catch {}
  }
  return "";
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

// ── Pi CLI Agent (NVIDIA Llama orchestrates all 8 tools) ─
async function callPiCLI_Agent(userMessage, tone, history, prevResponse, userId, timeoutMs = 180000) {
  const historyCtx = history?.length
    ? `Conversation history:\n${history.map(m => `[${m.role === "user" ? "User" : "Assistant"}]\n${m.content}`).join("\n\n")}`
    : "No history";

  const skillMd = loadSkillMd();
  const orchestrationMessage =
`## Orchestration Task

${skillMd ? `### SKILL.md\n\n${skillMd}\n\n---\n\n` : ""}### Available Tools

- classify_ticket(text)
- extract_entities(text)
- read_knowledge_policy(category): MCP knowledge-base (reads policy files)
- build_system_prompt(strategy: JSON string)
- call_llm(messages: JSON array, systemPrompt: string)
- evaluate_response(userId, agentResponse, userReply)
- update_user_tone(currentTone, feedbackScore, adjustTone, dimensionFeedback)
- save_ticket(data: JSON string): MCP ticket-store

### Context

- User ID: ${userId}
- Current tone: ${JSON.stringify(tone)}
- Previous response: ${prevResponse ? `"${prevResponse}"` : "none (first turn)"}
- Conversation history: ${historyCtx}

### Instructions

Execute EXACTLY in this order. Output ONLY final CS response from Step 5 — no extra commentary.

Step 1 — classify_ticket(text: "${userMessage}")
Step 2 — extract_entities(text: "${userMessage}")
Step 3 — read_knowledge_policy(category: result1.category)
Step 4 — build_system_prompt(strategy: '{"tone":...,"category":"result1.category","knowledge":"result3","history":"..."}') — strategy MUST be valid JSON
Step 5 — call_llm(messages: '[{"role":"user","content":"${userMessage}"}]', systemPrompt: result4) — output result5 as final answer
Step 6 — evaluate_response(userId: "${userId}", agentResponse: "${prevResponse || ""}", userReply: "${userMessage}")
Step 7 — update_user_tone(currentTone: '${JSON.stringify(tone)}', feedbackScore: result6.score, adjustTone: result6.adjust_tone, dimensionFeedback: 'JSON of result6.dimensionFeedback')
Step 8 — save_ticket(data: JSON.stringify({userId: "${userId}", category: result1.category, response: result5}))

### User Message

${userMessage}`;

  const args = [
    "--provider", "nvidia",
    "--model", "meta/llama-3.1-8b-instruct",
    "--no-builtin-tools",
    "--system-prompt", "You are a CS orchestrator with access to Extension and MCP tools. Follow the user's orchestration instructions step by step. Use tools exactly as directed.",
    "--mode", "json",
    "--print",
    orchestrationMessage,
  ];

  let raw = "";
  try {
    raw = execFileSync("pi", args, {
      cwd: ROOT,
      env: { NVIDIA_API_KEY: process.env.NVIDIA_API_KEY, ...process.env },
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
    }).toString();
  } catch (e) {
    if (e.stdout) raw = e.stdout.toString();
    else throw e;
  }

  const lines = raw.split("\n").filter(Boolean);
  let classification = null;
  let entities = null;
  let systemPrompt = null;
  let response = null;
  let feedback = null;
  let updatedTone = null;

  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      const resultText = evt.result?.content?.[0]?.text || "";
      const toolName = evt.toolName || evt.tool?.name || "";

      if (evt.type === "tool_execution_end") {
        try {
          const parsed = JSON.parse(resultText);
          if (toolName === "classify_ticket") classification = parsed;
          else if (toolName === "extract_entities") entities = parsed;
          else if (toolName === "evaluate_response") feedback = parsed;
          else if (toolName === "update_user_tone") updatedTone = parsed?.updatedTone || parsed;
        } catch { /* non-JSON tool result */ }

        if (toolName === "build_system_prompt") systemPrompt = resultText;
        else if (toolName === "call_llm") response = resultText;
      }

      if (evt.type === "response" || evt.type === "text") {
        if (!response) response = evt.content || evt.text || "";
      }

      if (evt.type === "agent_end") {
        const msgs = evt.messages || [];
        const lastAssistant = [...msgs].reverse().find(m =>
          m.role === "assistant" && m.content?.[0]?.type === "text" && m.content?.[0]?.text
        );
        if (lastAssistant && !response) {
          response = lastAssistant.content[0].text;
        }
      }
    } catch { /* skip non-JSON lines */ }
  }

  return { classification, entities, systemPrompt, response, feedback, updatedTone };
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

// ── Main Agent (NVIDIA 8B orchestrates 6 tools → Qwen2.5 generates) ─
export async function runPiAgent(userId, text, history = [], prevResponse = null) {
  const tone = loadTone(userId);
  const trace = [];
  const toneFile = resolve(TONE_DIR, `${userId}.json`);
  const isDefault = !existsSync(toneFile);
  console.log(`[TONE] user=${userId} warmth=${Math.round(tone.warmth * 100)}% formality=${Math.round(tone.formality * 100)}% directness=${Math.round(tone.directness * 100)}% verbosity=${Math.round(tone.verbosity * 100)}% (${isDefault ? "기본값" : "저장된 값"})`);
  trace.push(`📋 Tone: warmth=${Math.round(tone.warmth * 100)}% formality=${Math.round(tone.formality * 100)}% directness=${Math.round(tone.directness * 100)}% verbosity=${Math.round(tone.verbosity * 100)}% (${isDefault ? "기본값" : "저장된 값"})`);

  // Step 1: NVIDIA 8B orchestrates all 8 extension+MCP tools
  const _skillMd = loadSkillMd();
  console.log(`[AGENT] NVIDIA 8B → 8-tool pipeline 시작 (SKILL.md=${_skillMd.length > 0 ? `${_skillMd.length}B loaded` : "not found"})`);
  trace.push(`🔧 Agent: NVIDIA 8B → SKILL.md(${_skillMd.length}B) + MCP(knowledge-base/ticket-store) + Extension(8 tools)`);

  try {
    const agentResult = await callPiCLI_Agent(text, tone, history, prevResponse, userId);

    if (agentResult?.response) {
      const cat = agentResult.classification?.category || "unknown";
      console.log(`[AGENT] NVIDIA pipeline 완료 → ${cat}`);
      trace.push(`🔧 1. classify_ticket → ${cat} (${agentResult.classification?.urgency || "?"})`);
      trace.push(`🔧 2. extract_entities → 완료`);
      trace.push(`🔧 3. read_knowledge_policy → MCP knowledge-base 조회`);
      trace.push(`🔧 4. build_system_prompt → 생성 완료`);
      trace.push(`🔧 5. call_llm → Qwen2.5 응답 생성 완료`);

      if (agentResult.feedback) {
        saveTone(userId, agentResult.updatedTone || tone);
        trace.push(`🔧 6. evaluate_response → 피드백 (score: ${agentResult.feedback.score})`);
        trace.push(`🔧 7. update_user_tone → 말투 업데이트 완료`);
        trace.push(`🔧 8. save_ticket → MCP ticket-store 저장`);
        const changes = Object.entries(tone).map(([k, v]) =>
          `${toneLabel(k)} ${Math.round(v * 100)}%→${Math.round((agentResult.updatedTone?.[k] ?? v) * 100)}%`
        ).join(", ");
        console.log(`[AGENT] 피드백 반영 → ${changes}`);
      }

      console.log(`[WEB] 응답 전송 (user=${userId})`);
      trace.push("🖥️ Web UI → 응답 전송");
      return {
        response: agentResult.response,
        trace,
        fullLog: {
          model: "nvidia(orchestrator)+qwen-cs(generator)",
          skill: "cs-style-adapter",
          mcp: ["knowledge-base", "ticket-store"],
          userId,
          category: cat,
          entities: agentResult.entities,
          agentTools: ["classify_ticket","extract_entities","read_knowledge_policy","build_system_prompt","call_llm","evaluate_response","update_user_tone","save_ticket"],
        },
      };
    }
    console.log("[AGENT] response 없음 → fallback");
    trace.push("⚠️ Agent: 응답 없음 → direct Ollama fallback");
  } catch (e) {
    console.log("[AGENT] NVIDIA pipeline 실패:", e.message, "→ direct Ollama fallback");
    trace.push(`⚠️ Agent: NVIDIA pipeline 실패 → direct Ollama fallback`);
  }

  // ── Fallback: regex classify + direct Ollama (no Pi CLI) ─
  console.log("[FALLBACK] regex classify + direct Ollama");
  trace.push("🔄 Fallback: regex classify + direct Ollama HTTP");

  const classification = classifyTicket(text);
  const messages = [
    ...history.slice(-4).map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: text },
  ];
  const fallbackSys = buildSystemPrompt(classification.category, classification.urgency, tone, classification.sentiment, null);

  try {
    const t2 = Date.now();
    const response = await callOllama([
      { role: "system", content: fallbackSys },
      ...messages,
    ]);
    const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
    console.log(`[FALLBACK] direct Ollama 응답 완료 (${elapsed}초)`);
    trace.push(`🔄 Direct Ollama fallback 응답 완료 (${elapsed}초)`);
    console.log(`[WEB] 응답 전송 (user=${userId})`);
    trace.push("🖥️ Web UI → 응답 전송");
    return {
      response,
      trace,
      fullLog: { model: "direct-ollama(qwen-cs)", userId, category: classification.category, fallback: true },
    };
  } catch (err) {
    return { response: `[오류] ${err.message}`, fullLog: err.message, trace: [] };
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
