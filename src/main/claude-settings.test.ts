// The part of Mochi that writes to a file it doesn't own, so it gets the most tests.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isConnected, readSettings, withMochi, withoutMochi, writeSettings } from "./claude-settings";

const COMMAND = 'node "C:/Users/me/AppData/Local/mochi-claude/hook.js"';

/** A settings file like a real one: permissions, and a hook of the user's own. */
const yours = {
  permissions: { allow: ["Bash(git *)"] },
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "node .claude/hooks/my-own-hook.mjs", timeout: 20 }] }],
  },
  model: "opus",
};

test("connecting adds Mochi's hooks after yours and keeps everything else", () => {
  const result = withMochi(yours, COMMAND) as typeof yours & { hooks: Record<string, unknown[]> };
  assert.deepEqual(result.permissions, yours.permissions);
  assert.equal(result.model, "opus");
  assert.deepEqual(result.hooks.SessionStart[0], yours.hooks.SessionStart[0], "your hook stays first");
  assert.equal(result.hooks.SessionStart.length, 2);
  for (const event of ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"]) {
    assert.ok(result.hooks[event], `${event} is added`);
  }
  assert.ok(isConnected(result));
});

test("only PermissionRequest makes Claude Code wait; the rest run in the background", () => {
  const result = withMochi({}, COMMAND) as { hooks: Record<string, Array<{ hooks: Array<{ async?: boolean }> }>> };
  assert.equal(result.hooks.PermissionRequest[0].hooks[0].async, undefined);
  assert.equal(result.hooks.Stop[0].hooks[0].async, true);
});

test("connecting twice changes nothing", () => {
  const once = withMochi(yours, COMMAND);
  assert.deepEqual(withMochi(once, COMMAND), once);
});

test("disconnecting removes only Mochi's hooks", () => {
  assert.deepEqual(withoutMochi(withMochi(yours, COMMAND)), yours);
  assert.equal(isConnected(yours), false);
});

test("disconnecting from a file with only Mochi's hooks removes the hooks key", () => {
  assert.deepEqual(withoutMochi(withMochi({ model: "opus" }, COMMAND)), { model: "opus" });
});

test("reading: a missing file is empty, a byte-order mark is fine, broken JSON is refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-test-"));
  try {
    assert.deepEqual(readSettings(path.join(dir, "missing.json")), { ok: true, settings: {} });

    const bom = path.join(dir, "bom.json");
    fs.writeFileSync(bom, '\uFEFF{"model":"opus"}');
    assert.deepEqual(readSettings(bom), { ok: true, settings: { model: "opus" } });

    const broken = path.join(dir, "broken.json");
    fs.writeFileSync(broken, '{"model": ');
    assert.equal(readSettings(broken).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writing keeps a copy of the old file next to it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-test-"));
  try {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, '{"model":"opus"}');
    const backup = writeSettings(withMochi({ model: "opus" }, COMMAND), file);
    assert.ok(backup && fs.readFileSync(backup, "utf8") === '{"model":"opus"}');
    const written = readSettings(file);
    assert.ok(written.ok && isConnected(written.settings));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
