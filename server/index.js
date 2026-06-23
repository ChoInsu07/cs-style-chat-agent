import express from "express";
import cors from "cors";
import { runPiAgent, validatePiSetup, mcpDemonstration } from "./pi-agent.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const lastResponseMap = new Map();

app.post("/v1/chat/completions", async (req, res) => {
  const userId = req.headers["x-user-id"] || req.query.userId || req.body?.user || "user1";
  const messages = req.body?.messages || [];
  const isStream = req.body?.stream === true;

  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  const text = lastUserMsg?.content || "";
  if (!text) return res.json({ choices: [{ message: { content: "메시지가 없습니다.", role: "assistant" } }] });

  const history = messages.slice(0, -1).filter(m => m.role === "user" || m.role === "assistant").slice(-4);
  const prevResponse = lastResponseMap.get(userId) || null;

  try {
    const result = await runPiAgent(userId, text, history, prevResponse);
    const content = result.response;
    lastResponseMap.set(userId, content);

    const payload = {
      id: "chatcmpl-cs-agent",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "qwen-cs",
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, index: 0 }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.json(payload);
    }
  } catch (e) {
    res.status(500).json({ error: { message: e.message } });
  }
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [{ id: "qwen-cs", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "cs-agent" }],
  });
});

const PORT = process.env.PORT || 9090;

async function start() {
  const result = await validatePiSetup();
  if (result.ok) {
    console.log("✅ Pi CLI (ollama/qwen-cs): provider loaded");
  } else {
    console.log("ℹ️  Pi CLI validation:", result.output || "unavailable");
  }

  const mcpDemo = await mcpDemonstration();
  if (mcpDemo.ok) {
    const servers = Object.keys(mcpDemo.mcpServers).join(", ");
    console.log(`✅ MCP servers (${servers}): ${mcpDemo.operations.length} ops`);
  } else {
    console.log("ℹ️  MCP demo:", mcpDemo.reason || "skipped");
  }

  app.listen(PORT, () => {
    console.log(`\nCS Style Chat API on http://localhost:${PORT}`);
    console.log(`POST /v1/chat/completions (X-User-Id: user1|user2)`);
    console.log(`\nTest: curl -s http://localhost:${PORT}/v1/chat/completions \\`);
    console.log(`  -H "Content-Type: application/json" -H "X-User-Id: user1" \\`);
    console.log(`  -d '{"messages":[{"role":"user","content":"환불 받고 싶어요"}]}'`);
  });
}

start().catch(e => { console.error(e); process.exit(1); });
