// Pretends to be Claude Code: runs the real relay (dist/hook.js) with a made-up hook
// event on stdin, exactly as Claude Code would, and prints what the relay answered.
// For trying Mochi without waiting for Claude to need something.
//
//   pnpm fake ask       a permission request: the card appears; prints your answer
//   pnpm fake start     a window opens a conversation
//   pnpm fake prompt    you send a message (the window is "working")
//   pnpm fake stop      Claude finishes its turn (the "finished" card)
//   pnpm fake end       the conversation closes
//
// A second word pretends to be another window:   pnpm fake ask shop

import { spawn } from "node:child_process";

const [, , what = "ask", who = "web"] = process.argv;

const windows = {
  web: { session_id: "fake-web", cwd: "C:\\Projects\\my-website" },
  shop: { session_id: "fake-shop", cwd: "C:\\Projects\\my-api" },
};

const events = {
  start: { hook_event_name: "SessionStart" },
  prompt: { hook_event_name: "UserPromptSubmit" },
  ask: {
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: who === "shop"
      ? { command: "dotnet test", description: "Run the test suite" }
      : { command: "pnpm install", description: "Install package dependencies" },
    tool_use_id: `toolu_fake_${Date.now()}`,
  },
  stop: { hook_event_name: "Stop", last_assistant_message: "سه تا فایل رو درست کردم و تست‌ها همه پاس شدن." },
  end: { hook_event_name: "SessionEnd" },
};

if (!events[what] || !windows[who]) {
  console.error(`usage: pnpm fake <${Object.keys(events).join("|")}> [${Object.keys(windows).join("|")}]`);
  process.exit(1);
}

const input = { ...windows[who], ...events[what] };
const relay = spawn(process.execPath, ["dist/hook.js"], { stdio: ["pipe", "pipe", "inherit"] });
let printed = "";
relay.stdout.on("data", (chunk) => (printed += chunk));
relay.on("close", (code) => console.log(printed ? `relay printed: ${printed}` : `relay printed nothing (exit ${code})`));
relay.stdin.end(JSON.stringify(input));
