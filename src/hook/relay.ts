// The program Claude Code runs at each hook moment (main/claude-settings.ts lists which).
// It reads the event from stdin and hands it to the app over the named pipe. For a
// permission request it then waits for your answer and prints it in the shape Claude
// Code expects.
//
// The one rule: never get in Claude Code's way. If the app is closed, slow to pick up,
// crashes, or replies with anything unexpected, print nothing and exit 0. Claude Code
// then carries on exactly as if Mochi did not exist.

import net from "node:net";
import { isHookInput } from "../shared/hook-input";
import { decisionOutput, MAX_LINE_BYTES, pipePath, type AppReply, type RelayMessage } from "../shared/pipe";

/** How long to wait for the app to pick up before giving up quietly. */
const CONNECT_TIMEOUT_MS = 300;

function quit(): never {
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_LINE_BYTES) quit();
      chunks.push(chunk);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", quit);
  });
}

async function main(): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    quit();
  }
  if (!isHookInput(input)) quit();

  const ask = input.hook_event_name === "PermissionRequest";
  const message: RelayMessage = { kind: ask ? "ask" : "event", input };

  const socket = net.connect(pipePath());
  const giveUp = setTimeout(() => socket.destroy(), CONNECT_TIMEOUT_MS);
  socket.on("error", quit);
  socket.on("close", quit);

  socket.on("connect", () => {
    clearTimeout(giveUp);
    socket.write(JSON.stringify(message) + "\n");
    if (!ask) socket.end();
  });

  if (!ask) return;

  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (text: string) => {
    buffer += text;
    if (buffer.length > MAX_LINE_BYTES) quit();
    const end = buffer.indexOf("\n");
    if (end < 0) return;

    let reply: AppReply;
    try {
      reply = JSON.parse(buffer.slice(0, end));
    } catch {
      quit();
    }
    const output = decisionOutput(reply);
    if (output) process.stdout.write(output, quit);
    else quit();
  });
}

main().catch(quit);
