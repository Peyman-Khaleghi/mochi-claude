// The only door between the window and the rest of the app.
//
// The window runs with no access to Node or the file system (contextIsolation and
// sandbox in main.ts). This file hands it exactly the calls listed in Bridge
// (shared/view.ts), as `window.mochi`, and nothing more.

import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, IslandState } from "../shared/view";

const bridge: Bridge = {
  onState: (listener) => ipcRenderer.on("state", (_event, state: IslandState) => listener(state)),
  onOpenOverview: (listener) => ipcRenderer.on("open-overview", () => listener()),
  answer: (requestId, choice) => ipcRenderer.send("answer", requestId, choice),
  focusWindow: (sessionId) => ipcRenderer.send("focus-window", sessionId),
  goToQuestion: (sessionId) => ipcRenderer.send("go-to-question", sessionId),
  forgetSession: (sessionId) => ipcRenderer.send("forget-session", sessionId),
  dismissToast: () => ipcRenderer.send("dismiss-toast"),
  setInteractive: (on) => ipcRenderer.send("interactive", on),
  setIslandBox: (box) => ipcRenderer.send("island-box", box),
  reportHealth: (health) => ipcRenderer.send("health", health),
  connect: () => ipcRenderer.send("connect"),
  setStartWithWindows: (on) => ipcRenderer.send("start-with-windows", on),
  quit: () => ipcRenderer.send("quit"),
  setTrayIcon: (pngDataUrl) => ipcRenderer.send("tray-icon", pngDataUrl),
};

contextBridge.exposeInMainWorld("mochi", bridge);
