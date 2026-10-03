// Reading Claude Code's transcripts. Each session writes one JSON object per line to the
// transcript_path that every hook event carries, appending as the conversation goes on.
//
// Mochi only ever reads them, for two things:
//   - a session's name: the title you gave it (/rename), or the one Claude made up;
//   - which tool call a permission request is about, and whether it has been answered
//     (answered-elsewhere.ts). A PermissionRequest has no tool_use_id, but the call itself
//     is in the transcript, and so is its result once you answer.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TITLE_TAIL_BYTES = 2_000_000;
const TITLE_MAX_CHARS = 60;

/** Only files under %USERPROFILE%\.claude\ ending in .jsonl: that is where transcripts live. */
export function isTranscript(file: string | undefined): file is string {
  if (!file) return false;
  const root = path.join(os.homedir(), ".claude") + path.sep;
  const full = path.resolve(file);
  return full.toLowerCase().startsWith(root.toLowerCase()) && full.endsWith(".jsonl");
}

export function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function readRange(file: string, start: number, end: number): string {
  const length = Math.max(0, Math.min(end - start, 4_000_000));
  if (length === 0) return "";
  const buffer = Buffer.alloc(length);
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** The last `bytes` of the file, from the first whole line; `end` is where it stops. */
export function readTail(file: string, bytes: number): { text: string; end: number } {
  const end = sizeOf(file);
  const start = Math.max(0, end - bytes);
  let text = readRange(file, start, end);
  if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the cut-off first line
  return { text, end };
}

/**
 * The session's name: the last title you gave it, else the last one Claude generated.
 * Claude Code appends these lines again and again, so the end of the file has them.
 */
export function readSessionTitle(file: string): string | undefined {
  const { text } = readTail(file, TITLE_TAIL_BYTES);
  return sessionTitleIn(text);
}

export function sessionTitleIn(text: string): string | undefined {
  return lastField(text, "custom-title", "customTitle") ?? lastField(text, "ai-title", "aiTitle");
}

function lastField(text: string, type: string, field: string): string | undefined {
  const marker = `"type":"${type}"`;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes(marker)) continue;
    try {
      const value = JSON.parse(lines[i])[field];
      if (typeof value === "string" && value.trim() !== "") {
        const title = value.trim();
        return title.length > TITLE_MAX_CHARS ? title.slice(0, TITLE_MAX_CHARS - 1) + "…" : title;
      }
    } catch {
      /* a half-written line; keep looking */
    }
  }
  return undefined;
}

/**
 * Finds the id Claude Code gave a tool call, from the call's tool name and input: the
 * latest matching call that has no result yet. Undefined if it isn't there (yet).
 */
export function findToolUseId(text: string, toolName: string, toolInput: Record<string, unknown>): string | undefined {
  const nameMarker = `"name":${JSON.stringify(toolName)}`;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"tool_use"') || !line.includes(nameMarker)) continue;
    let entry: { message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j] as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
      if (block?.type !== "tool_use" || block.name !== toolName || typeof block.id !== "string") continue;
      if (!sameInput(block.input, toolInput)) continue;
      if (text.includes(`"tool_use_id":"${block.id}"`)) continue; // an earlier, identical call already answered
      return block.id;
    }
  }
  return undefined;
}

/** Two inputs are the same call when the field that says what it does is the same. */
function sameInput(a: unknown, b: Record<string, unknown>): boolean {
  if (typeof a !== "object" || a === null) return false;
  const x = a as Record<string, unknown>;
  for (const key of ["command", "file_path", "url", "path", "pattern"]) {
    if (typeof b[key] === "string") return x[key] === b[key];
  }
  return stable(x) === stable(b);
}

/** JSON with sorted keys, so two equal objects always give the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
