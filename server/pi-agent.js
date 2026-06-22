import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PI_BIN = "pi";
const EXTENSION = resolve(process.cwd(), "extensions/chat-tools.ts");
const SKILL = resolve(process.cwd(), "skills/cs-style-adapter");
const TONE_DIR = resolve(process.cwd(), "data/tone");

export async function runPiAgent(userId, text, history = [], prevResponse = null) {
  const tonePath = resolve(TONE_DIR, `${userId}.json`);
  const hasTone = existsSync(tonePath);

  const steps = [
    "1. MCP (knowledge-base) read_file → data/knowledge/*.json, data/tone/{userId}.json",
    "2. MCP (ticket-store) search → 사용자 티켓 이력 조회",
    "3. Extension classify_ticket + extract_entities → 문의 분류·개체 추출",
    "4. subagent(parallel) → tone-profiler, ticket-analyzer, response-composer",
    "5. Extension build_system_prompt → call_llm → 응답 생성",
    "6. Extension update_user_tone(계산) → MCP write_file로 tone 저장 → MCP ticket-store로 티켓 저장",
  ];

  const promptParts = [
    `사용자 ID: ${userId}`,
    !hasTone ? "참고: 이 사용자의 tone 파일이 없습니다. MCP read_file 시 기본값(0.5)으로 처리하세요." : "",
    `사용자 입력: "${text}"`,
  ];

  if (history.length > 0) {
    promptParts.push(`이전 대화: ${JSON.stringify(history.slice(-4))}`);
  }

  if (prevResponse) {
    steps.unshift("0. evaluate_response(피드백 점수) → update_user_tone(계산) → MCP write_file(tone 저장)");
    promptParts.push(`\n[피드백] 직전 에이전트 응답: "${prevResponse}"`);
    promptParts.push("직전 응답에 대한 사용자의 반응(현재 입력)을 evaluate_response로 평가한 후, update_user_tone으로 tone을 계산하고 MCP write_file로 저장하세요.");
  }

  promptParts.push(
    "\n위 입력을 처리하세요. 작업 순서:",
    ...steps,
    "7. 최종 응답을 -----RESPONSE----- 이후에만 출력",
  );

  const prompt = promptParts.filter(l => l).join("\n");

  const cmd = [
    PI_BIN,
    `-e "${EXTENSION}"`,
    `--skill "${SKILL}"`,
    `-p "${prompt.replace(/"/g, '\\"')}"`,
  ].join(" ");

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 60000,
      env: { ...process.env, HOME: process.env.HOME },
    });

    const responseMatch = output.match(/-----RESPONSE-----([\s\S]*)/);
    const response = responseMatch
      ? responseMatch[1].trim()
      : output.split("\n").filter(l => l.trim()).slice(-3).join("\n").trim();

    return {
      response: response || "(에이전트가 응답을 생성하지 못했습니다)",
      fullLog: output,
    };
  } catch (e) {
    return {
      response: `[Pi Agent 오류] ${e.message}`,
      fullLog: e.stderr?.toString() || e.message,
    };
  }
}
