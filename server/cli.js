import { runPiAgent } from "./pi-agent.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
CS Style Chat Agent — CLI 모드

사용법:
  node server/cli.js --userId <id> --message "<문의>"
  node server/cli.js --userId <id>                     (대화형 모드)
  node server/cli.js -u <id> -m "<문의>"

옵션:
  -u, --userId   사용자 ID (기본값: user1)
  -m, --message  문의 메시지 (생략 시 대화형 모드)
  --log          전체 Agent 로그 출력
  -h, --help     도움말

예시:
  node server/cli.js -u user1 -m "환불 받고 싶어요"
  node server/cli.js -u user1                         ← 채팅처럼 주고받기
  `);
  process.exit(0);
}

function parseArg(flag, short) {
  const idx = args.indexOf(flag);
  const shortIdx = short ? args.indexOf(short) : -1;
  const i = idx !== -1 ? idx : shortIdx;
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const userId = parseArg("--userId", "-u") || "user1";
const message = parseArg("--message", "-m");
const showLog = args.includes("--log");

async function main() {
  if (message) {
    // 단일 메시지 모드
    console.log(`\n[사용자 ${userId}] ${message}\n`);
    const result = await runPiAgent(userId, message);
    if (showLog) {
      console.log("--- Agent Log ---");
      console.log(result.fullLog);
      console.log("--- end log ---\n");
    }
    console.log(`[에이전트] ${result.response}\n`);
  } else {
    // 대화형 모드
    console.log(`\nCS Style Chat Agent — 대화형 모드 (userId: ${userId})`);
    console.log("종료하려면 /quit 입력\n");
    const history = [];
    let prevResponse = null;

    while (true) {
      const input = prompt("> ");
      if (input === null || input.trim() === "/quit") break;

      const text = input.trim();
      if (!text) continue;

      const result = await runPiAgent(userId, text, history, prevResponse);
      prevResponse = result.response;

      if (showLog) {
        console.log("\n--- Agent Log ---");
        console.log(result.fullLog);
        console.log("--- end log ---\n");
      }

      console.log(`\n🤖 ${result.response}\n`);
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: result.response });
    }
  }
}

// Node 18+ has no built-in prompt(), use readline for interactive mode
import { createInterface } from "node:readline";

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

main().catch(e => {
  console.error("[CLI 오류]", e.message);
  process.exit(1);
});
