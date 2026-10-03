// «برو به VS Code» and clicking a window in the overview: bring forward the VS Code
// window that has this folder, then the Claude tab of this exact session.
//
//   1. The window. focus-window.ps1 finds it by its title and switches to it (Windows
//      won't let Mochi do that directly; the script explains why). It is started once
//      and kept running, so later clicks are instant.
//   2. The session. The Claude Code extension opens
//      vscode://anthropic.claude-code/open?session=<id> in whichever window has focus:
//      an open tab comes forward, a closed one is reopened.
//
// If no window shows that folder, `code <folder>` opens it instead.

import { type ChildProcess, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";

/** cmd.exe treats these as commands; a folder name containing one is never passed to it. */
const UNSAFE_FOR_CMD = /[&|<>^%!"\r\n]/;
/** Claude Code session ids are UUIDs; anything else is not put in a link. */
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Give the window a moment to take focus before the link is opened in "the focused window". */
const SETTLE_MS = 300;
const HELPER_TIMEOUT_MS = 5000;

export async function goToSession(cwd: string, sessionId: string): Promise<void> {
  const found = await focusWindow(path.win32.basename(cwd));
  if (!found) {
    openWithCode(cwd);
    return;
  }
  if (!SESSION_ID.test(sessionId)) return;
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  await shell.openExternal(`vscode://anthropic.claude-code/open?session=${encodeURIComponent(sessionId)}`);
}

// ── The helper ────────────────────────────────────────────────────────────────

let helper: ChildProcess | null = null;
let nextId = 1;
const waiting = new Map<number, (found: boolean) => void>();

function startHelper(): ChildProcess {
  const script = path.join(__dirname, "focus-window.ps1");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
    { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  let buffer = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (text: string) => {
    buffer += text;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const [id, answer] = buffer.slice(0, end).trim().split(" ");
      buffer = buffer.slice(end + 1);
      waiting.get(Number(id))?.(answer === "ok");
      waiting.delete(Number(id));
    }
  });
  child.on("exit", () => {
    helper = null;
    for (const resolve of waiting.values()) resolve(false);
    waiting.clear();
  });
  child.on("error", () => child.kill());
  return child;
}

/** Brings forward the VS Code window showing `folder`; false if there is none. */
function focusWindow(folder: string): Promise<boolean> {
  helper ??= startHelper();
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(false);
    }, HELPER_TIMEOUT_MS);
    waiting.set(id, (found) => {
      clearTimeout(timer);
      resolve(found);
    });
    helper!.stdin!.write(JSON.stringify({ id, folder }) + "\n");
  });
}

export function stopHelper(): void {
  helper?.kill();
}

// ── When the folder has no window: `code <folder>` ────────────────────────────

function openWithCode(folder: string): void {
  if (UNSAFE_FOR_CMD.test(folder)) return;
  try {
    if (!fs.statSync(folder).isDirectory()) return;
  } catch {
    return;
  }
  // `code` is a .cmd file, and Windows only runs those through cmd.exe. With /s, cmd.exe
  // strips the outer pair of quotes and runs what is inside verbatim.
  execFile("cmd.exe", ["/d", "/s", "/c", `"code "${folder}""`], { windowsHide: true, windowsVerbatimArguments: true }, () => {});
}
