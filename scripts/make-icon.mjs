// Draws Mochi into assets/icon.ico, the program's icon, with Mochi's own code:
//   1. esbuild bundles mochi/engine.ts for a page;
//   2. headless Edge draws it on a transparent 256×256 canvas and saves a PNG;
//   3. the PNG is wrapped in an .ico file (Windows reads a PNG inside an .ico).
// The icon is committed, so this only needs running again if Mochi's look changes.
//
//   pnpm run icon

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-icon-"));

try {
  await build({
    stdin: {
      contents: 'import { BotEngine } from "./src/renderer/mochi/engine"; window.BotEngine = BotEngine;',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    outfile: path.join(work, "engine.js"),
    logLevel: "warning",
  });

  // Drawn at 330 px and moved so Mochi's body sits in the middle of the 256 px icon.
  fs.writeFileSync(
    path.join(work, "icon.html"),
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head>
<body><canvas id="c" width="256" height="256"></canvas>
<script src="engine.js"></script>
<script>
  const engine = new BotEngine();
  engine.update(1 / 60);
  const ctx = document.getElementById("c").getContext("2d");
  ctx.translate(-37, -43);
  engine.draw(ctx, 330, 330);
</script></body></html>`,
  );

  const png = path.join(work, "icon.png");
  execFileSync(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      "--window-size=256,256",
      `--user-data-dir=${path.join(work, "profile")}`,
      `--screenshot=${png}`,
      "file:///" + path.join(work, "icon.html").replace(/\\/g, "/"),
    ],
    { stdio: "ignore" },
  );

  // An .ico file: a 6-byte header, one 16-byte entry describing the image, then the PNG.
  const image = fs.readFileSync(png);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // 1 = icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(0, 6); // width 256 (written as 0)
  head.writeUInt8(0, 7); // height 256 (written as 0)
  head.writeUInt8(0, 8); // no palette
  head.writeUInt8(0, 9); // reserved
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(image.length, 14);
  head.writeUInt32LE(22, 18); // the image starts right after this header
  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/icon.ico", Buffer.concat([head, image]));
  fs.copyFileSync(png, "assets/icon.png");
  console.log("assets/icon.ico written");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
