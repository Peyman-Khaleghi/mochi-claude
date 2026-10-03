// What each working session is doing right now, short enough to read at a glance:
// "Read island.ts", "Grep startsWithWindows", "Bash Run the tests", or thinking.
//
// It comes from the session's transcript (see transcript.ts), the same file Mochi
// already reads for the session's name. Claude Code writes each step there as it takes
// it: one line per tool call, before the tool runs. So no extra hook is needed, and
// Claude Code never waits on Mochi for this.
//
// Only what was appended since the last look is read, once a second, and only while a
// session is working or has a question open (main.ts).
//
// The same lines also tell when Claude asks you a question (its AskUserQuestion tool).
// That tool needs no permission, so no PermissionRequest hook announces it; but its call
// is written here before the question is shown, and its result once you answer or close it.

import path from "node:path";
import type { Activity } from "../shared/view";
import { readRange, readTail, sizeOf } from "./transcript";

/** How far back to look the first time, when Mochi starts in the middle of a turn. */
const FIRST_LOOK_BYTES = 256_000;
/**
 * More new text than this since the last look (Claude read a few big files at once) is
 * not read through; only its end is, which is where the current step is anyway.
 */
const CATCH_UP_MAX_BYTES = 2_000_000;
/** Longer than this is cut with "…"; the tile has room for about this much. */
const TARGET_MAX_CHARS = 48;

/**
 * The activity after these transcript lines, starting from `previous`. A new prompt from
 * you clears it (that turn hasn't done anything yet); a tool call, a thought or a reply
 * from Claude replaces it; everything else (tool results, bookkeeping lines) leaves it.
 */
export function activityAfter(previous: Activity | undefined, lines: string[]): Activity | undefined {
  let activity = previous;
  for (const line of lines) {
    // Cheap checks first: a tool result can be megabytes of file contents.
    if (line.includes('"type":"user"')) {
      if (!line.includes('"tool_result"') && isPrompt(line)) activity = undefined;
    } else if (line.includes('"type":"assistant"')) {
      activity = fromAssistant(line) ?? activity;
    }
  }
  return activity;
}

/**
 * The id of an AskUserQuestion call still waiting for your answer after these lines,
 * starting from `previous`. Its result (your answer, or you closing it) ends it, and so
 * does a new message from you.
 */
export function openQuestionAfter(previous: string | undefined, lines: string[]): string | undefined {
  let open = previous;
  for (const line of lines) {
    if (line.includes('"type":"user"')) {
      if (line.includes('"tool_result"')) {
        if (open && line.includes(`"tool_use_id":"${open}"`)) open = undefined;
      } else if (isPrompt(line)) {
        open = undefined;
      }
    } else if (line.includes('"type":"assistant"') && line.includes('"name":"AskUserQuestion"')) {
      open = questionCallId(line) ?? open;
    }
  }
  return open;
}

/** The id of the AskUserQuestion call on this line of Claude's, if it has one. */
function questionCallId(line: string): string | undefined {
  let entry: { type?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (entry.type !== "assistant" || entry.isSidechain === true) return undefined;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return undefined;
  const call = (content as Array<{ type?: unknown; name?: unknown; id?: unknown }>).find(
    (block) => block?.type === "tool_use" && block.name === "AskUserQuestion" && typeof block.id === "string",
  );
  return call?.id as string | undefined;
}

/** A message you typed, as opposed to a tool's result or a note Claude Code adds. */
function isPrompt(line: string): boolean {
  try {
    const entry = JSON.parse(line);
    return entry.type === "user" && entry.isMeta !== true && entry.isSidechain !== true && entry.isCompactSummary !== true;
  } catch {
    return false;
  }
}

function fromAssistant(line: string): Activity | undefined {
  let entry: { type?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
  try {
    entry = JSON.parse(line);
  } catch {
    return undefined;
  }
  // A subagent's own steps; its call (Agent) is already the main session's activity.
  if (entry.type !== "assistant" || entry.isSidechain === true) return undefined;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return undefined;

  let activity: Activity | undefined;
  for (const block of content as Array<{ type?: unknown; name?: unknown; input?: unknown }>) {
    if (block?.type === "tool_use" && typeof block.name === "string") activity = describeTool(block.name, block.input);
    else if (block?.type === "thinking" || block?.type === "redacted_thinking") activity = { kind: "thinking" };
    else if (block?.type === "text") activity = { kind: "writing" };
  }
  return activity;
}

/**
 * A tool call in a few words: the tool's own name, and the one thing it is touching.
 * A file is shown by its name alone; the folder is on the tile already.
 */
export function describeTool(name: string, input: unknown): Activity {
  const i = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const file = (v: unknown) => {
    const p = text(v);
    return p && path.win32.basename(p);
  };

  // "mcp__github__create_issue" → "create_issue": the server's name is noise here.
  const tool = name.startsWith("mcp__") ? name.split("__").pop() || name : name;

  let target: string | undefined;
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      target = file(i.file_path);
      break;
    case "NotebookEdit":
      target = file(i.notebook_path);
      break;
    case "Grep":
    case "Glob":
      target = text(i.pattern);
      break;
    case "Bash":
    case "PowerShell":
      // Claude's own few words ("Run the tests") read faster than the command itself.
      target = text(i.description) ?? text(i.command);
      break;
    case "WebFetch":
      target = host(text(i.url));
      break;
    case "WebSearch":
      target = text(i.query);
      break;
    case "Agent":
    case "Task":
      target = text(i.description);
      break;
    case "Skill":
      target = text(i.skill);
      break;
    case "TodoWrite":
      target = inProgress(i.todos);
      break;
  }
  return target === undefined ? { kind: "tool", tool } : { kind: "tool", tool, target: short(target) };
}

/** The step of Claude's to-do list it marked as the one it is on now. */
function inProgress(todos: unknown): string | undefined {
  if (!Array.isArray(todos)) return undefined;
  const current = todos.find((t) => t?.status === "in_progress");
  const words = current?.activeForm ?? current?.content;
  return typeof words === "string" ? words : undefined;
}

function host(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** One line, at most TARGET_MAX_CHARS. */
function short(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > TARGET_MAX_CHARS ? line.slice(0, TARGET_MAX_CHARS - 1) + "…" : line;
}

interface Followed {
  file: string;
  /** Read up to here. */
  offset: number;
  /** The start of a line that was still being written at the last look. */
  carry: string;
  activity?: Activity;
  /** The id of an AskUserQuestion call waiting for your answer. */
  question?: string;
}

/**
 * Follows the transcripts of working sessions. One instance for the whole app; it holds
 * how far each file has been read, so every byte is read once.
 */
export class ActivityReader {
  private followed = new Map<string, Followed>();

  /**
   * You sent a new message. What the transcript says before this moment belongs to the
   * previous turn, so reading starts from here.
   */
  restart(sessionId: string, file: string): void {
    this.followed.set(sessionId, { file, offset: sizeOf(file), carry: "" });
  }

  /** Reads what was appended since the last look; returns the session's activity. */
  read(sessionId: string, file: string): Activity | undefined {
    const f = this.followed.get(sessionId);
    const size = sizeOf(file);
    if (!f || f.file !== file || size < f.offset || size - f.offset > CATCH_UP_MAX_BYTES) {
      // The first look (Mochi started in the middle of a turn), a file that was rewritten,
      // or too much to catch up on: look back a little from the end for the current step.
      const { text, end } = readTail(file, FIRST_LOOK_BYTES);
      const same = f?.file === file;
      const fresh: Followed = { file, offset: end, carry: "", activity: same ? f.activity : undefined, question: same ? f.question : undefined };
      this.followed.set(sessionId, fresh);
      take(fresh, text);
      return fresh.activity;
    }
    if (size > f.offset) {
      const text = f.carry + readRange(file, f.offset, size);
      f.offset = size;
      take(f, text);
    }
    return f.activity;
  }

  /** Whether, at the last read(), Claude was waiting for your answer to a question. */
  asking(sessionId: string): boolean {
    return this.followed.get(sessionId)?.question !== undefined;
  }

  forget(sessionId: string): void {
    this.followed.delete(sessionId);
  }
}

/** Takes the whole lines of `text` into the activity and question; keeps an unfinished last line for next time. */
function take(f: Followed, text: string): void {
  const lastNewline = text.lastIndexOf("\n");
  f.carry = text.slice(lastNewline + 1);
  if (lastNewline < 0) return;
  const lines = text.slice(0, lastNewline).split("\n");
  f.activity = activityAfter(f.activity, lines);
  f.question = openQuestionAfter(f.question, lines);
}
