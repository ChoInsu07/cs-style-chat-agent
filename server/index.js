import express from "express";
import cors from "cors";
import { runPiAgent } from "./pi-agent.js";

const app = express();
const PORT = 9090;

app.use(cors());
app.use(express.json());

const lastResponseMap = new Map();

// Lobe Chat이 호출할 OpenAI 호환 /v1/chat/completions
app.post("/v1/chat/completions", async (req, res) => {
  const { messages, model, stream = false } = req.body;

  const userMessages = messages.filter(m => m.role === "user");
  const lastMsg = userMessages.pop();
  const userText = lastMsg?.content || "";
  const userId = extractUserId(req) || "user1";
  const history = messages.slice(-6, -1);

  // 피드백 루프: 직전 응답이 있으면 evaluate + tone update
  const prevResponse = lastResponseMap.get(userId) || null;

  res.setHeader("Content-Type", "application/json");

  if (stream) {
    res.setHeader("Transfer-Encoding", "chunked");
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" }, index: 0 }] })}\n\n`);
  }

  try {
    const result = await runPiAgent(userId, userText, history, prevResponse);
    const content = result.response;

    lastResponseMap.set(userId, content);

    if (stream) {
      const words = content.split(/(?<=\s)/);
      for (const word of words) {
        const chunk = {
          choices: [{ delta: { content: word }, index: 0 }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        await sleep(20);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.json({
        id: "chat-" + Date.now(),
        object: "chat.completion",
        model: model || "qwen-cs",
        choices: [{
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        }],
      });
    }
  } catch (e) {
    const errMsg = `[Error] ${e.message}`;
    if (stream) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errMsg } }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.json({
        id: "chat-error",
        object: "chat.completion",
        model: model || "qwen-cs",
        choices: [{ index: 0, message: { role: "assistant", content: errMsg }, finish_reason: "stop" }],
      });
    }
  }
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "qwen-cs",
        object: "model",
        created: Date.now(),
        owned_by: "cs-style-agent",
      },
    ],
  });
});

function extractUserId(req) {
  return req.headers["x-user-id"] || req.query.userId || "user1";
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

app.listen(PORT, () => {
  console.log(`CS Style Chat API running on http://localhost:${PORT}`);
  console.log(`OpenAI-compatible endpoint: http://localhost:${PORT}/v1/chat/completions`);
});
