// Connecting Mochi to Claude Code means adding a few hooks to your *user* settings,
// %USERPROFILE%\.claude\settings.json, so they apply in every folder and every window.
//
// Every hook Mochi adds runs the same relay, and that command line is how Mochi
// recognises its own entries: disconnecting removes exactly those and nothing else.
// Your own hooks, and every other setting in the file, are left as they are.
//
// Writing is careful on purpose:
//   - a file that cannot be read as JSON is never overwritten;
//   - a dated copy of the file is taken before every write;
//   - a missing file is fine and starts empty.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

/** Where the relay lives. Outside the project, so moving the project breaks nothing. */
export const RELAY_PATH = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "mochi-claude", "hook.js");

/** Part of every Mochi command line; how Mochi finds its own hooks. */
const MARKER = "mochi-claude/hook.js";

/**
 * The events Mochi listens to. Only PermissionRequest makes Claude Code wait (for your
 * answer); the rest run in the background (`async`) and never slow Claude Code down.
 */
const EVENTS: Record<string, { async: boolean }> = {
  SessionStart: { async: true },
  UserPromptSubmit: { async: true },
  PermissionRequest: { async: false },
  Stop: { async: true },
  SessionEnd: { async: true },
};

/**
 * Forward slashes and quotes, so the same line works whether Claude Code runs hooks
 * through Git Bash, PowerShell or cmd. `node` is found on PATH, like the hooks you
 * already use.
 */
export function relayCommand(relayPath = RELAY_PATH): string {
  return `node "${relayPath.replace(/\\/g, "/")}"`;
}

type Json = Record<string, unknown>;
type HookGroup = { matcher?: string; hooks?: Array<{ command?: unknown }> };

export type ReadResult = { ok: true; settings: Json } | { ok: false; reason: string };

export function readSettings(file = SETTINGS_PATH): ReadResult {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, settings: {} };
    return { ok: false, reason: `could not read ${file}: ${(error as Error).message}` };
  }
  text = text.replace(/^﻿/, ""); // Notepad likes to start files with a byte-order mark
  if (text.trim() === "") return { ok: true, settings: {} };
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: `${file} is not a JSON object` };
    }
    return { ok: true, settings: parsed };
  } catch (error) {
    return { ok: false, reason: `${file} is not valid JSON: ${(error as Error).message}` };
  }
}

function isMochiGroup(group: unknown): boolean {
  const hooks = (group as HookGroup)?.hooks;
  return Array.isArray(hooks) && hooks.some((h) => typeof h?.command === "string" && h.command.includes(MARKER));
}

/** True when every event Mochi needs has its hook. */
export function isConnected(settings: Json): boolean {
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  return Object.keys(EVENTS).every((event) => Array.isArray(hooks?.[event]) && hooks[event].some(isMochiGroup));
}

/** Removes Mochi's hooks; an event left with no hooks at all is removed too. */
export function withoutMochi(settings: Json): Json {
  const hooks = settings.hooks;
  if (typeof hooks !== "object" || hooks === null) return settings;
  const kept: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      kept[event] = groups as unknown[];
      continue;
    }
    const rest = groups.filter((g) => !isMochiGroup(g));
    if (rest.length > 0) kept[event] = rest;
  }
  const result: Json = { ...settings, hooks: kept };
  if (Object.keys(kept).length === 0) delete result.hooks;
  return result;
}

/** Adds Mochi's hooks after any you already have. Running it twice changes nothing. */
export function withMochi(settings: Json, command = relayCommand()): Json {
  const clean = withoutMochi(settings);
  const hooks = { ...((clean.hooks as Record<string, unknown[]>) ?? {}) };
  for (const [event, { async }] of Object.entries(EVENTS)) {
    const hook: Json = { type: "command", command };
    if (async) hook.async = true;
    hooks[event] = [...(hooks[event] ?? []), { hooks: [hook] }];
  }
  return { ...clean, hooks };
}

/** settings.json → settings.json.mochi-backup-2026-10-01-153012 */
export function backupPathFor(file: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `${file}.mochi-backup-${stamp}`;
}

/** Copies the current file aside (if there is one), then writes. Returns the copy's path. */
export function writeSettings(settings: Json, file = SETTINGS_PATH): string | null {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    backup = backupPathFor(file);
    fs.copyFileSync(file, backup);
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return backup;
}

/** The events Mochi adds, for showing you before anything is written. */
export function eventNames(): string[] {
  return Object.keys(EVENTS);
}
