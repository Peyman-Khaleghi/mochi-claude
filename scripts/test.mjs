// Runs the tests: every src/**/*.test.ts, bundled by esbuild and run by Node's own
// test runner (node:test). No test framework to install or learn.
//
//   pnpm test

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

const tests = readdirSync("src", { recursive: true })
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.join("src", file));

rmSync("dist-test", { recursive: true, force: true });
await build({
  entryPoints: tests,
  outdir: "dist-test",
  outbase: "src",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});

const built = tests.map((file) => path.join("dist-test", path.relative("src", file)).replace(/\.ts$/, ".mjs"));
execFileSync(process.execPath, ["--test", ...built], { stdio: "inherit" });
