// Starts Mochi with Electron (what `pnpm start` runs after building).
//
// ELECTRON_RUN_AS_NODE is removed first. VS Code sets it for the programs it starts,
// Claude Code among them, and with it set Electron behaves as plain Node: Mochi then
// fails with "Cannot read properties of undefined (reading 'requestSingleInstanceLock')".

import { spawn } from "node:child_process";
import electron from "electron"; // the package's export is the path to electron.exe

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { env, stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 0));
