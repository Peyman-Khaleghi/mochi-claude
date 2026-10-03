import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionOutput } from "../shared/pipe";
import { findToolUseId, sessionTitleIn } from "./transcript";

/** Transcript lines in the shape Claude Code writes them (one JSON object per line). */
const call = (id: string, name: string, input: object) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string) =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: "ok" }] } });

test("finds the open call a permission request is about", () => {
  const text = [call("toolu_1", "Bash", { command: "git status", description: "Status" })].join("\n");
  assert.equal(findToolUseId(text, "Bash", { command: "git status", description: "Status" }), "toolu_1");
});

test("skips an earlier identical call that was already answered", () => {
  const text = [
    call("toolu_1", "Bash", { command: "git status" }),
    result("toolu_1"),
    call("toolu_2", "Bash", { command: "git status" }),
  ].join("\n");
  assert.equal(findToolUseId(text, "Bash", { command: "git status" }), "toolu_2");
});

test("in a batch of calls, picks the one with the same command", () => {
  const text = [call("toolu_a", "Bash", { command: "git fetch" }), call("toolu_b", "Bash", { command: "git log" })].join("\n");
  assert.equal(findToolUseId(text, "Bash", { command: "git fetch" }), "toolu_a");
  assert.equal(findToolUseId(text, "PowerShell", { command: "git fetch" }), undefined, "the tool has to match too");
});

test("not there (yet) is undefined, and a half-written line is ignored", () => {
  const text = [call("toolu_1", "Bash", { command: "other" }), '{"type":"assistant","message":{"content":[{"type":"tool_use"'].join("\n");
  assert.equal(findToolUseId(text, "Bash", { command: "git status" }), undefined);
});

test("a session's name: the one you gave it wins over Claude's; the latest of each counts", () => {
  const lines = [
    JSON.stringify({ type: "ai-title", aiTitle: "old ai title" }),
    JSON.stringify({ type: "ai-title", aiTitle: "امنیت اکستنشن" }),
  ];
  assert.equal(sessionTitleIn(lines.join("\n")), "امنیت اکستنشن");
  lines.push(JSON.stringify({ type: "custom-title", customTitle: "claude permission app" }));
  assert.equal(sessionTitleIn(lines.join("\n")), "claude permission app");
  assert.equal(sessionTitleIn(call("toolu_1", "Bash", {})), undefined);
});

test("the relay's answer: plain allow and deny, and allow with the rule to save", () => {
  const rule = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "git log *" }], behavior: "allow", destination: "projectSettings" };
  assert.deepEqual(JSON.parse(decisionOutput({ decision: "deny" })!), {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } },
  });
  assert.deepEqual(JSON.parse(decisionOutput({ decision: "allow", updatedPermissions: [rule] })!), {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedPermissions: [rule] } },
  });
  assert.equal(
    JSON.parse(decisionOutput({ decision: "deny", updatedPermissions: [rule] })!).hookSpecificOutput.decision.updatedPermissions,
    undefined,
    "a rule only ever goes with allow",
  );
  assert.equal(decisionOutput({ decision: null }), null, "not answering prints nothing");
});
