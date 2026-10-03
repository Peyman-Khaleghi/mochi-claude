// A plain text log of how Mochi started and what happened to its window, in
// %APPDATA%\mochi-claude\mochi.log. It is there for questions like: when the island is
// missing, which step didn't happen? When it couldn't be clicked, why? It holds only
// Mochi's own steps, never anything that came from Claude Code.
//
// Lines are added to the end, so a start that went wrong is still there after you close
// Mochi and open it again. Past MAX_LOG_BYTES the file becomes mochi.old.log and a new
// one begins, so it never grows without end.

import fs from "node:fs";
import path from "node:path";

export const MAX_LOG_BYTES = 512 * 1024;

let file: string | null = null;

/** Starts writing to `dir`\mochi.log. Until this is called, log() does nothing. */
export function startLog(dir: string): void {
  file = path.join(dir, "mochi.log");
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, path.join(dir, "mochi.old.log"));
  } catch {
    // No log yet: the first line creates it.
  }
}

export function log(line: string): void {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${timestamp(new Date())} ${line}\n`);
  } catch {
    // A log that can't be written must never stop Mochi.
  }
}

/** Local time, as the clock on the taskbar shows it: "2026-10-02 16:28:40.182". */
export function timestamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  return `${date} ${time}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}
