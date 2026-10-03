import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ActivityReader, activityAfter, describeTool, openQuestionAfter } from "./activity";

// Transcript lines in the shape Claude Code writes them: one JSON object per line.
const prompt = (text: string) => JSON.stringify({ type: "user", isSidechain: false, message: { role: "user", content: [{ type: "text", text }] } });
const call = (name: string, input: object, extra: object = {}) =>
  JSON.stringify({ type: "assistant", isSidechain: false, ...extra, message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${name}`, name, input }] } });
const result = (id: string) => JSON.stringify({ type: "user", message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: "file text" }] } });
const thought = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "x" }] } });
const reply = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
const reminder = JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "<system-reminder>…" } });

test("each step replaces the activity; a new message from you clears it", () => {
  let a = activityAfter(undefined, [prompt("fix it"), call("Read", { file_path: "C:\\src\\island.ts" })]);
  assert.deepEqual(a, { kind: "tool", tool: "Read", target: "island.ts" });

  a = activityAfter(a, [result("toolu_Read"), reminder]);
  assert.deepEqual(a, { kind: "tool", tool: "Read", target: "island.ts" }, "a result or a note changes nothing");

  assert.deepEqual(activityAfter(a, [thought]), { kind: "thinking" });
  assert.deepEqual(activityAfter(a, [reply]), { kind: "writing" });
  assert.equal(activityAfter(a, [prompt("and now this")]), undefined);
});

test("a subagent's own steps and half-written lines are ignored", () => {
  const agent = activityAfter(undefined, [call("Agent", { description: "Find the relay", prompt: "…" })]);
  assert.deepEqual(agent, { kind: "tool", tool: "Agent", target: "Find the relay" });
  assert.deepEqual(activityAfter(agent, [call("Grep", { pattern: "x" }, { isSidechain: true })]), agent);
  const progress = JSON.stringify({ type: "progress", data: { message: { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: {} }] } } } });
  assert.deepEqual(activityAfter(agent, [progress]), agent);
  assert.deepEqual(activityAfter(agent, ['{"type":"assistant","message":{"content":[{"type":"tool_u']), agent);
});

test("a question from Claude is open until its result arrives", () => {
  const question = call("AskUserQuestion", { questions: [{ question: "Which one?", header: "Pick", options: [], multiSelect: false }] });
  const open = openQuestionAfter(undefined, [prompt("help me choose"), question]);
  assert.equal(open, "toolu_AskUserQuestion");
  assert.equal(openQuestionAfter(open, [reminder, thought]), open, "notes and thoughts change nothing");
  assert.equal(openQuestionAfter(open, [result("toolu_other")]), open, "another tool's result changes nothing");
  assert.equal(openQuestionAfter(open, [result("toolu_AskUserQuestion")]), undefined, "answered, or closed");
});

test("a new message ends an open question; a subagent's and other tools' calls never open one", () => {
  const open = openQuestionAfter(undefined, [call("AskUserQuestion", {})]);
  assert.equal(openQuestionAfter(open, [prompt("never mind")]), undefined);
  assert.equal(openQuestionAfter(undefined, [call("AskUserQuestion", {}, { isSidechain: true })]), undefined);
  assert.equal(openQuestionAfter(undefined, [call("Read", { file_path: "AskUserQuestion.md" })]), undefined);
});

test("a tool in a few words", () => {
  assert.deepEqual(describeTool("Grep", { pattern: "startsWithWindows" }), { kind: "tool", tool: "Grep", target: "startsWithWindows" });
  assert.deepEqual(describeTool("Bash", { command: "pnpm test", description: "Run the tests" }), { kind: "tool", tool: "Bash", target: "Run the tests" });
  assert.deepEqual(describeTool("PowerShell", { command: "pnpm build\npnpm test" }), { kind: "tool", tool: "PowerShell", target: "pnpm build" });
  assert.deepEqual(describeTool("WebFetch", { url: "https://code.claude.com/docs/en/hooks" }), { kind: "tool", tool: "WebFetch", target: "code.claude.com" });
  assert.deepEqual(describeTool("mcp__github__create_issue", { title: "x" }), { kind: "tool", tool: "create_issue" });
  assert.deepEqual(describeTool("TodoWrite", { todos: [{ content: "Build", activeForm: "Building", status: "in_progress" }] }), {
    kind: "tool",
    tool: "TodoWrite",
    target: "Building",
  });
  assert.deepEqual(describeTool("SomethingNew", "not even an object"), { kind: "tool", tool: "SomethingNew" });

  const long = describeTool("Grep", { pattern: "x".repeat(200) });
  assert.equal(long.kind === "tool" && long.target?.length, 48);
  assert.ok(long.kind === "tool" && long.target?.endsWith("…"));
});

test("the reader follows a growing transcript, reading each byte once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-activity-"));
  const file = path.join(dir, "session.jsonl");
  const append = (text: string) => fs.appendFileSync(file, text);
  try {
    append(prompt("hello") + "\n" + call("Read", { file_path: "a.ts" }) + "\n");
    const reader = new ActivityReader();
    assert.deepEqual(reader.read("s1", file), { kind: "tool", tool: "Read", target: "a.ts" }, "the first look reads back");

    // A line caught while it is being written counts only once it is whole.
    const grep = call("Grep", { pattern: "needle" });
    append(grep.slice(0, 30));
    assert.deepEqual(reader.read("s1", file), { kind: "tool", tool: "Read", target: "a.ts" });
    append(grep.slice(30) + "\n");
    assert.deepEqual(reader.read("s1", file), { kind: "tool", tool: "Grep", target: "needle" });

    // A new message: nothing before this moment counts.
    reader.restart("s1", file);
    assert.equal(reader.read("s1", file), undefined);
    append(prompt("next") + "\n" + call("Edit", { file_path: "b.ts" }) + "\n");
    assert.deepEqual(reader.read("s1", file), { kind: "tool", tool: "Edit", target: "b.ts" });

    // A question: asking from the moment its call is written until its result is.
    assert.equal(reader.asking("s1"), false);
    append(call("AskUserQuestion", { questions: [] }) + "\n");
    reader.read("s1", file);
    assert.equal(reader.asking("s1"), true);
    append(result("toolu_AskUserQuestion") + "\n");
    reader.read("s1", file);
    assert.equal(reader.asking("s1"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
