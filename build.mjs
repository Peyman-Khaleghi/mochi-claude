// Builds everything into dist/. Four separate programs come out of src/:
//
//   dist/main.js              the app itself (Electron's main process, runs on Node)
//   dist/preload.js           the narrow bridge between the app and the window
//   dist/renderer/island.js   what you see: Mochi and the cards (runs in the window)
//   dist/hook.js              the relay Claude Code runs at each hook moment
//
// esbuild only translates and bundles; it does not check types. `pnpm typecheck` does.

import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

const common = { bundle: true, target: "es2022", logLevel: "warning" };

rmSync("dist", { recursive: true, force: true });

await Promise.all([
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/hook/relay.ts"], outfile: "dist/hook.js", platform: "node", format: "cjs" }),
  build({ ...common, entryPoints: ["src/renderer/island.ts"], outfile: "dist/renderer/island.js", platform: "browser", format: "iife" }),
]);

cpSync("src/main/focus-window.ps1", "dist/focus-window.ps1");
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/style.css", "dist/renderer/style.css");
cpSync("src/renderer/fonts", "dist/renderer/fonts", { recursive: true });
cpSync("assets/sounds", "dist/renderer/sounds", { recursive: true });

console.log("built dist/");
