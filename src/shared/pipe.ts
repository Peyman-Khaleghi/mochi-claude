// The conversation between the hook relay (dist/hook.js) and the app, over a Windows
// named pipe. One JSON object per line, in both directions.
//
//   relay → app   { "kind": "event", "input": … }   something happened; no answer wanted
//   relay → app   { "kind": "ask",   "input": … }   a permission request; keep the line open
//   app → relay   { "decision": "allow" | "deny" | null }
//
// `null` means "Mochi is not answering this one": the relay prints nothing and Claude
// Code asks in VS Code as it always does.

import os from "node:os";
import type { HookInput } from "./hook-input";

export type Decision = "allow" | "deny";

export interface RelayMessage {
  kind: "event" | "ask";
  input: HookInput;
}

export interface AppReply {
  decision: Decision | null;
  /**
   * With "allow" only: one of the request's own permission_suggestions, echoed back so
   * Claude Code saves that rule ("Always allow"). Mochi never makes one up.
   */
  updatedPermissions?: unknown[];
}

/**
 * The exact text Claude Code reads as the answer to a PermissionRequest, or null when
 * Mochi is not answering (the relay then prints nothing).
 */
export function decisionOutput(reply: AppReply): string | null {
  if (reply.decision !== "allow" && reply.decision !== "deny") return null;
  const decision: Record<string, unknown> = { behavior: reply.decision };
  if (reply.decision === "allow" && Array.isArray(reply.updatedPermissions) && reply.updatedPermissions.length > 0) {
    decision.updatedPermissions = reply.updatedPermissions;
  }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
}

/** Longest line either side accepts. A hook event is a few KB; this is generous. */
export const MAX_LINE_BYTES = 1_000_000;

/**
 * The pipe's name carries the Windows user name, so two people signed in to the same
 * machine each get their own Mochi.
 */
export function pipePath(): string {
  const user = os.userInfo().username.replace(/[^A-Za-z0-9_.-]/g, "_");
  return `\\\\.\\pipe\\mochi-claude-${user}`;
}
