import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { log, MAX_LOG_BYTES, startLog, timestamp } from "./log";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "mochi-log-"));
const read = (dir: string, name = "mochi.log") => fs.readFileSync(path.join(dir, name), "utf8");

test("a new start adds to the log, so the start before it is still there", () => {
  const dir = tempDir();
  startLog(dir);
  log("first start");
  startLog(dir);
  log("second start");
  const lines = read(dir).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /first start$/);
  assert.match(lines[1], /second start$/);
});

test("a log past its size becomes mochi.old.log and a new one begins", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "mochi.log"), "x".repeat(MAX_LOG_BYTES + 1));
  startLog(dir);
  log("fresh");
  assert.equal(read(dir, "mochi.old.log").length, MAX_LOG_BYTES + 1);
  assert.match(read(dir), /^\S+ \S+ fresh\n$/);
});

test("a folder that can't be written to is ignored, not an error", () => {
  startLog(path.join(tempDir(), "missing", "folder"));
  assert.doesNotThrow(() => log("nowhere to go"));
});

test("times are local and padded", () => {
  assert.equal(timestamp(new Date(2026, 9, 2, 6, 5, 4, 3)), "2026-10-02 06:05:04.003");
});
