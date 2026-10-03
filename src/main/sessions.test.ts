import assert from "node:assert/strict";
import { test } from "node:test";
import type { HookInput } from "../shared/hook-input";
import { Sessions } from "./sessions";

const web = { session_id: "s1", cwd: "C:\\Projects\\my-website" };
const shop = { session_id: "s2", cwd: "C:\\Projects\\my-api" };
const APP = { connected: true, soundOn: true, startsWithWindows: false };

function at(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const ev = (base: typeof web, hook_event_name: HookInput["hook_event_name"], extra: Partial<HookInput> = {}): HookInput => ({
  ...base,
  hook_event_name,
  ...extra,
});

test("a conversation from start to finish", () => {
  const clock = at(1000);
  const s = new Sessions(clock.now);

  s.event(ev(web, "SessionStart"));
  assert.equal(s.view(APP).sessions.length, 0, "an empty new conversation is not shown");

  s.event(ev(web, "UserPromptSubmit"));
  assert.equal(s.view(APP).sessions[0].state, "working");
  assert.equal(s.view(APP).sessions[0].project, "my-website");

  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "pnpm install", description: "Install" } }), "r1");
  const asking = s.view(APP);
  assert.equal(asking.sessions[0].state, "waiting");
  assert.deepEqual(
    { command: asking.requests[0].command, description: asking.requests[0].description },
    { command: "pnpm install", description: "Install" },
  );

  s.settle("r1");
  assert.equal(s.view(APP).sessions[0].state, "working");
  assert.equal(s.view(APP).requests.length, 0);

  s.event(ev(web, "Stop", { last_assistant_message: "\n\nDone: three files fixed.\nMore detail here." }));
  const done = s.view(APP);
  assert.equal(done.sessions[0].state, "finished");
  assert.equal(done.toast?.message, "Done: three files fixed.", "the toast shows the first non-empty line");

  s.event(ev(web, "SessionEnd"));
  assert.equal(s.view(APP).sessions.length, 0);
  assert.equal(s.view(APP).toast, null);
});

test("two windows wait at once, each with its own request", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "a" } }), "r1");
  s.ask(ev(shop, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "b" } }), "r2");
  assert.deepEqual(s.view(APP).requests.map((r) => r.project), ["my-website", "my-api"]);

  s.settle("r1");
  const v = s.view(APP);
  assert.deepEqual(v.requests.map((r) => r.id), ["r2"]);
  assert.equal(v.sessions.find((x) => x.id === "s2")?.state, "waiting");
});

test("a request still open when its turn ends is handed back, and only that session's", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "a" } }), "r1");
  s.ask(ev(shop, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "b" } }), "r2");
  assert.deepEqual(s.event(ev(web, "Stop")), ["r1"]);
  assert.deepEqual(s.view(APP).requests.map((r) => r.id), ["r2"]);
  assert.deepEqual(s.event(ev(shop, "UserPromptSubmit")), ["r2"], "a new message also ends it");
});

test("one window per folder shows just the folder; several show each session's own name", () => {
  const s = new Sessions(at().now);
  s.event(ev(web, "UserPromptSubmit"));
  s.event(ev(shop, "UserPromptSubmit"));
  assert.deepEqual(s.view(APP).sessions.map((x) => x.title), [undefined, undefined]);

  s.event(ev({ ...web, session_id: "s4" }, "SessionStart")); // empty: shown nowhere, numbered nowhere
  s.event(ev({ ...web, session_id: "s3" }, "UserPromptSubmit"));
  s.setTitle("s1", "صفحه‌ی پرداخت");
  const names = s.view(APP).sessions.map((x) => [x.project, x.title]);
  assert.deepEqual(names, [
    ["my-website", "صفحه‌ی پرداخت"],
    ["my-api", undefined],
    ["my-website", "2"], // no name yet: a number until it has one
  ]);
});

test("a request carries its session's name too", () => {
  const s = new Sessions(at().now);
  s.event(ev(web, "UserPromptSubmit"));
  s.event(ev({ ...web, session_id: "s3" }, "SessionStart"));
  s.setTitle("s3", "fix cart bug");
  s.ask(ev({ ...web, session_id: "s3" }, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "x" } }), "r1");
  assert.equal(s.view(APP).requests[0].title, "fix cart bug");
});

test("Claude Code's 'always allow' offer is shown exactly, and kept to be sent back as is", () => {
  const s = new Sessions(at().now);
  const offer = {
    type: "addRules",
    rules: [
      { toolName: "Bash", ruleContent: "git fetch *" },
      { toolName: "Bash", ruleContent: "git log *" },
    ],
    behavior: "allow",
    destination: "projectSettings",
  };
  const request = s.ask(
    ev(web, "PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command: "git fetch && git log" },
      permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }, offer],
    }),
    "r1",
  );
  assert.equal(request.always?.entry, offer, "the very same object, never a rebuilt one");
  assert.deepEqual(s.view(APP).requests[0].always, { rules: ["git fetch *", "git log *"], where: "projectSettings" });
});

test("no offer, or an offer Mochi doesn't understand, means no 'Always allow' button", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "a" } }), "r1");
  s.ask(
    ev(shop, "PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command: "b" },
      permission_suggestions: [{ type: "addRules", rules: [{ ruleContent: "no tool name" }], behavior: "allow", destination: "localSettings" }],
    }),
    "r2",
  );
  assert.deepEqual(s.view(APP).requests.map((r) => r.always), [undefined, undefined]);
});

test("× takes a window off Mochi with its requests; it comes back if it does something again", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "a" } }), "r1");
  s.event(ev(shop, "UserPromptSubmit"));
  assert.deepEqual(s.forget("s1"), ["r1"]);
  assert.deepEqual(s.view(APP).sessions.map((x) => x.id), ["s2"]);
  s.event(ev(web, "UserPromptSubmit"));
  assert.deepEqual(s.view(APP).sessions.map((x) => x.id), ["s2", "s1"]);
});

test("finished becomes idle after half an hour; silence for half a day forgets the window", () => {
  const clock = at();
  const s = new Sessions(clock.now);
  s.event(ev(web, "Stop"));
  clock.advance(31 * 60 * 1000);
  assert.ok(s.tidy());
  assert.equal(s.view(APP).sessions[0].state, "idle");
  clock.advance(12 * 60 * 60 * 1000);
  s.tidy();
  assert.equal(s.view(APP).sessions.length, 0);
});

test("a command tool other than Bash (PowerShell) gets the command card too", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "PowerShell", tool_input: { command: "Get-ChildItem", description: "List" } }), "r1");
  assert.deepEqual(
    { command: s.view(APP).requests[0].command, description: s.view(APP).requests[0].description },
    { command: "Get-ChildItem", description: "List" },
  );
});

test("a tool that runs no command is summarised by what it touches", () => {
  const s = new Sessions(at().now);
  s.ask(ev(web, "PermissionRequest", { tool_name: "WebFetch", tool_input: { url: "https://example.com", prompt: "x" } }), "r1");
  assert.equal(s.view(APP).requests[0].detail, "https://example.com");
});

test("a new, empty conversation stays off Mochi until it has a message or a name", () => {
  const s = new Sessions(at().now);
  s.event(ev(web, "SessionStart")); // a new Claude tab, nothing typed yet
  assert.deepEqual(s.view(APP).sessions, []);

  // Opening an earlier conversation from it: that one has a name, so it shows.
  s.event(ev(shop, "SessionStart"));
  s.setTitle("s2", "fix cart bug");
  assert.deepEqual(s.view(APP).sessions.map((x) => x.id), ["s2"]);

  s.event(ev(web, "UserPromptSubmit"));
  assert.deepEqual(s.view(APP).sessions.map((x) => x.id), ["s1", "s2"]);
});

test("the activity shows only while working, and a new message clears it", () => {
  const s = new Sessions(at().now);
  const read = { kind: "tool" as const, tool: "Read", target: "island.ts" };
  s.event(ev(web, "UserPromptSubmit", { transcript_path: "C:\\t\\s1.jsonl" }));
  assert.deepEqual(s.followed(), [{ id: "s1", transcriptPath: "C:\\t\\s1.jsonl" }]);

  assert.ok(s.setActivity("s1", read));
  assert.equal(s.setActivity("s1", { ...read }), false, "the same activity again is no change");
  assert.deepEqual(s.view(APP).sessions[0].activity, read);

  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "pnpm test" } }), "r1");
  assert.equal(s.view(APP).sessions[0].activity, undefined, "waiting shows the card instead");
  assert.deepEqual(s.followed(), []);
  s.settle("r1");
  assert.deepEqual(s.view(APP).sessions[0].activity, read);

  s.event(ev(web, "UserPromptSubmit"));
  assert.equal(s.view(APP).sessions[0].activity, undefined);
  assert.equal(s.followed()[0].transcriptPath, "C:\\t\\s1.jsonl", "a later event without the path keeps it");
});

test("a question from Claude: the window waits, its card shows until you go to VS Code, an answer ends it", () => {
  const clock = at(1000);
  const s = new Sessions(clock.now);
  s.event(ev(web, "UserPromptSubmit", { transcript_path: "C:\\t\\s1.jsonl" }));

  clock.advance(500);
  assert.ok(s.setQuestion("s1", true));
  assert.equal(s.setQuestion("s1", true), false, "the same question again is no change");
  const asking = s.view(APP);
  assert.equal(asking.sessions[0].state, "waiting");
  assert.deepEqual(asking.questions, [{ sessionId: "s1", project: "my-website", at: 1500 }]);
  assert.equal(s.followed().length, 1, "still followed, to see it answered");

  s.dismissQuestion("s1");
  assert.deepEqual(s.view(APP).questions, [], "the card is gone");
  assert.equal(s.view(APP).sessions[0].state, "waiting", "the window still waits");

  assert.ok(s.setQuestion("s1", false));
  assert.equal(s.view(APP).sessions[0].state, "working");
});

test("a new message or the end of the turn ends a question too", () => {
  const s = new Sessions(at().now);
  s.event(ev(web, "UserPromptSubmit"));
  s.event(ev(shop, "UserPromptSubmit"));
  s.setQuestion("s1", true);
  s.setQuestion("s2", true);
  s.event(ev(web, "UserPromptSubmit"));
  s.event(ev(shop, "Stop"));
  assert.deepEqual(s.view(APP).questions, []);
  assert.deepEqual(s.view(APP).sessions.map((x) => x.state), ["working", "finished"]);
});

test("a permission request answered while a question is open leaves the window waiting", () => {
  const s = new Sessions(at().now);
  s.event(ev(web, "UserPromptSubmit"));
  s.setQuestion("s1", true);
  s.ask(ev(web, "PermissionRequest", { tool_name: "Bash", tool_input: { command: "a" } }), "r1");
  s.settle("r1");
  assert.equal(s.view(APP).sessions[0].state, "waiting");
});
