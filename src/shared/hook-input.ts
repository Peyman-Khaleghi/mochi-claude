// What Claude Code writes to a hook's stdin, limited to the fields Mochi reads.
// The full reference: https://code.claude.com/docs/en/hooks
//
// Every field is checked before use (see isHookInput): this arrives from outside the
// app, so nothing in it is trusted until it has the expected shape.

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "Stop"
  | "SessionEnd";

export interface HookInput {
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  transcript_path?: string;
  /** PermissionRequest: which tool wants to run, e.g. "Bash". */
  tool_name?: string;
  /** PermissionRequest: the tool's arguments; for Bash, `command` and `description`. */
  tool_input?: Record<string, unknown>;
  /**
   * PermissionRequest: the "always allow" options Claude Code offers for this request,
   * e.g. a rule for this project. A PermissionRequest has no tool_use_id (unlike
   * PreToolUse); see main/transcript.ts for how Mochi finds the call anyway.
   */
  permission_suggestions?: unknown[];
  /** Stop: the last thing Claude said in that turn. */
  last_assistant_message?: string;
}

const EVENTS: readonly string[] = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"];

/** True when `value` has the shape of a hook event Mochi understands. */
export function isHookInput(value: unknown): value is HookInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hook_event_name === "string" &&
    EVENTS.includes(v.hook_event_name) &&
    typeof v.session_id === "string" &&
    typeof v.cwd === "string"
  );
}
