// Mochi's main process: the part of the app that runs on Node. It owns the window at
// the top of the screen, the tray icon, the named pipe the hooks talk to, and the state
// of your sessions. The window (renderer/island.ts) only draws what this file sends it.
//
// The life of a permission request, end to end:
//   Claude Code runs the relay → the relay connects to the pipe (pipe.ts) → `ask` below
//   records it (sessions.ts) and the card appears → it ends in exactly one of these ways:
//     Accept / Cancel on the card         → the relay prints allow / deny
//     Always allow                         → allow, plus Claude Code's own suggested rule
//     «برو به VS Code»                    → the relay prints nothing; VS Code's prompt stays
//     you answered in VS Code              → noticed in the transcript (answered-elsewhere.ts)
//     the turn ended, or a new message     → sessions.event() hands it back
//     nobody answered in HAND_BACK_AFTER_MS → handed back to VS Code, untouched
//
// While a session is working, its transcript is read once a second for the step it is
// on (activity.ts), and its tile says that ("Read island.ts") instead of just "working".
// The same reading notices when Claude asks you a question (AskUserQuestion): that gets
// a card with one button, «برو به VS Code», since only VS Code can take the answer.
//
// Two command-line flags are for the installer only (scripts/install.ps1, uninstall.ps1):
//   --start-with-windows   turn on "start with Windows" (the first run after installing)
//   --uninstall            undo everything Mochi did outside its own folder, then quit
//
// Each step of starting, and what happens to the window after, goes to mochi.log (log.ts).

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray, type IpcMainEvent } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { HookInput } from "../shared/hook-input";
import type { Decision } from "../shared/pipe";
import type { IslandBox, PageHealth } from "../shared/view";
import { ActivityReader } from "./activity";
import { watchForAnswer } from "./answered-elsewhere";
import * as claude from "./claude-settings";
import { log, startLog, timestamp } from "./log";
import { startPipe, type Ask } from "./pipe";
import { Sessions } from "./sessions";
import { isTranscript, readSessionTitle } from "./transcript";
import { goToSession, stopHelper } from "./vscode";

/**
 * How long a card waits for you before it closes and leaves the question to VS Code.
 * VS Code asks at the same time, so nothing is lost when it does.
 */
const HAND_BACK_AFTER_MS = 2 * 60 * 1000;

/** How often a working session's transcript is checked for its next step (activity.ts). */
const ACTIVITY_POLL_MS = 1000;

/** How often the app checks the pointer itself, so the island can always be clicked (watchPointer). */
const POINTER_POLL_MS = 100;

/** How often the app looks at its own health and the page's (watchHealth). */
const HEALTH_CHECK_MS = 1000;
/** The page reports every 5 s (island.ts); nothing from it for this long goes to the log. */
const PAGE_QUIET_MS = 20_000;
/** A gap this long between two health checks means the app itself was stopped, as in standby. */
const PAUSED_MS = 5000;
/** How many of the latest pointer and click events are kept, to be logged when Mochi quits. */
const RECENT_EVENTS = 30;

/**
 * The window is a fixed, invisible rectangle at the top centre of the screen, big enough
 * for the largest card. Everything outside the island is transparent and lets clicks
 * through (see setClickable).
 */
const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 470;

/**
 * The window appears on "ready-to-show", Chromium's word that the page has painted. If
 * that never comes, the window would stay hidden for good, so this long after the page
 * has loaded it is shown anyway.
 */
const SHOW_ANYWAY_AFTER_MS = 5000;

const UNINSTALL = process.argv.includes("--uninstall");
const START_WITH_WINDOWS = process.argv.includes("--start-with-windows");

// Only one Mochi at a time. A second copy (say, opened from the Start menu while Mochi
// runs) hands over to the first, which shows its window ("second-instance" below), and
// does nothing else. app.quit() alone doesn't stop it: Electron still fires "ready" in
// it, and it would then try to open the pipe the first one holds (EADDRINUSE).
const SECOND_COPY = !UNINSTALL && !app.requestSingleInstanceLock();
if (SECOND_COPY) app.quit();

if (!UNINSTALL && !SECOND_COPY) {
  startLog(app.getPath("userData"));
  log(`started, version ${app.getVersion()}${START_WITH_WINDOWS ? ", --start-with-windows" : ""}`);
}

// Chromium only lets a page play sound after you have clicked it. Mochi's sound is the
// one that tells you a window needs you, so it has to play before any click.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Chromium switches off a window's input when it thinks the window can't be seen (the
// laptop locked, the screen off, standby), and for Mochi's see-through, click-through
// window it doesn't always switch it back on: the island keeps drawing new cards but no
// click reaches them until Mochi is restarted. Mochi is always on top, so this saving
// (CalculateNativeWinOcclusion) is of no use to it anyway.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const sessions = new Sessions();
const activity = new ActivityReader();
/** Requests still waiting, by id, with the one function that ends each of them. */
const open = new Map<string, (decision: Decision | null, updatedPermissions?: unknown[]) => void>();
let connected = false;
let soundOn = true;
/** Kept here rather than asked of Windows on every redraw; set by setStartWithWindows. */
let startsWithWindows = false;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Whether the window takes clicks now, or lets them through to the windows under it. */
let clickable = false;
/** What the page last said: the pointer is on the island (its mouseenter and mouseleave). */
let pageHover = false;
/** The island's place in the window, as the page last reported it. */
let islandBox: IslandBox | null = null;
/** At the last check the pointer was on the island and the page hadn't noticed. */
let unnoticed = false;
/** The page's latest health report (island.ts) and when it came. */
let health: { at: number; report: PageHealth } | null = null;
/** When watchHealth last ran, to notice the app itself being stopped. */
let lastHealthCheck = 0;
/** The page has been quiet for PAGE_QUIET_MS and that is already in the log. */
let pageQuiet = false;
/** The latest pointer and click events, "12:58:30.120 clickable (page)", oldest first. */
const recent: string[] = [];

function push(): void {
  win?.webContents.send("state", sessions.view({ connected, soundOn, startsWithWindows }));
}

// ── Hook events ───────────────────────────────────────────────────────────────

function onAsk(ask: Ask): void {
  const id = randomUUID();
  const request = sessions.ask(ask.input, id);
  learnTitle(ask.input);

  const timer = setTimeout(() => end(null), HAND_BACK_AFTER_MS);
  const stopWatching = watchForAnswer(request.transcriptPath, request.tool, request.toolInput, () => end(null));
  ask.onGone(() => end(null));

  function end(decision: Decision | null, updatedPermissions?: unknown[]): void {
    if (!open.delete(id)) return;
    clearTimeout(timer);
    stopWatching();
    ask.reply(decision, updatedPermissions);
    sessions.settle(id);
    push();
  }

  open.set(id, end);
  push();
}

function onEvent(input: HookInput): void {
  // Requests whose turn this event ended (a new message, Stop, the window closing).
  for (const id of sessions.event(input)) open.get(id)?.(null);
  if (input.hook_event_name === "UserPromptSubmit" && isTranscript(input.transcript_path)) {
    activity.restart(input.session_id, input.transcript_path);
  } else if (input.hook_event_name === "SessionEnd") {
    activity.forget(input.session_id);
  }
  learnTitle(input);
  push();
}

/**
 * Each followed session's latest step, and whether it is asking you a question, from its
 * transcript; redraws only when something changed.
 */
function followActivity(): void {
  let changed = false;
  for (const s of sessions.followed()) {
    if (!isTranscript(s.transcriptPath)) continue;
    if (sessions.setActivity(s.id, activity.read(s.id, s.transcriptPath))) changed = true;
    if (sessions.setQuestion(s.id, activity.asking(s.id))) changed = true;
  }
  if (changed) push();
}

/** Picks up the session's name from its transcript, for telling apart sessions in one folder. */
function learnTitle(input: HookInput): void {
  if (input.hook_event_name === "SessionEnd" || !isTranscript(input.transcript_path)) return;
  sessions.setTitle(input.session_id, readSessionTitle(input.transcript_path));
}

// ── The window ────────────────────────────────────────────────────────────────

function placeWindow(): void {
  const { bounds, scaleFactor } = screen.getPrimaryDisplay();
  win?.setBounds({
    x: Math.round(bounds.x + (bounds.width - WINDOW_WIDTH) / 2),
    y: bounds.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });
  log(`placed on a ${bounds.width}x${bounds.height} screen at ${bounds.x},${bounds.y}, scale ${scaleFactor}`);
}

/** One line on where the window is and whether Windows shows it. */
function logWindow(what: string): void {
  if (!win) return;
  const { x, y, width, height } = win.getBounds();
  log(`${what}: visible ${win.isVisible()}, at ${x},${y} size ${width}x${height}`);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Never takes the keyboard from VS Code: clicking Accept leaves your cursor where it was.
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  placeWindow();
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true, { forward: true });

  // The window shows only our own page: no new windows, no navigating away.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  win.webContents.on("did-finish-load", push);
  win.once("ready-to-show", () => {
    win?.showInactive();
    logWindow("ready-to-show, shown");
  });
  win.webContents.once("did-finish-load", () => {
    log("page loaded");
    setTimeout(() => {
      if (!win || win.isVisible()) return;
      win.showInactive();
      logWindow("no ready-to-show after the page loaded, shown anyway");
    }, SHOW_ANYWAY_AFTER_MS);
  });
  win.webContents.on("did-fail-load", (_event, code, description) => log(`page failed to load: ${code} ${description}`));
  win.webContents.on("render-process-gone", (_event, details) => log(`page process gone: ${details.reason}`));
  win.on("unresponsive", () => log("page not responding"));
  win.on("responsive", () => log("page responding again"));
  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  log("window created");

  screen.on("display-metrics-changed", placeWindow);
  screen.on("display-added", placeWindow);
  screen.on("display-removed", placeWindow);
}

/**
 * The window takes clicks only while the pointer is on the island. Everywhere else they
 * pass through to the window under it, but the page still gets the pointer's moves
 * (`forward`), which is how its mouseenter knows to make the island clickable.
 */
function setClickable(on: boolean, why: string): void {
  if (!win || on === clickable) return;
  clickable = on;
  win.setIgnoreMouseEvents(!on, { forward: true });
  note(`${on ? "clickable" : "click-through"} (${why})`);
}

/** Whether the pointer is on the island, by the app's own look rather than the page's. */
function pointerOnIsland(): boolean {
  if (!win || !islandBox || !win.isVisible()) return false;
  const pointer = screen.getCursorScreenPoint();
  const at = win.getBounds();
  const x = pointer.x - at.x;
  const y = pointer.y - at.y;
  const box = islandBox;
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

/**
 * The safety net under setClickable. While clicks pass through, the page learns about the
 * pointer's moves from a mouse hook Electron asks Windows for. Windows removes such a hook
 * without telling anyone if the app is ever too slow to answer it (say, while the PC
 * wakes up), and from then on the page never hears the pointer arrive: the island still
 * shows everything, but every click on it falls through to VS Code. So the app also looks
 * at the pointer itself, and when it is on the island for two checks in a row without the
 * page noticing, the island is made clickable anyway. The page then gets ordinary mouse
 * messages, and when the pointer leaves, setClickable(false) asks Electron for a new hook.
 */
function watchPointer(): void {
  const on = pointerOnIsland();
  if (pageHover) {
    unnoticed = false;
    return;
  }
  if (on && unnoticed && !clickable) {
    log("the pointer was on the island but the page wasn't told; made it clickable");
    setClickable(true, "pointer on the island, page not told");
  } else if (!on && clickable) {
    // Made clickable just above, and the pointer left without the page noticing either.
    setClickable(false, "pointer left, page not told");
  }
  unnoticed = on;
}

// ── Health, for mochi.log ─────────────────────────────────────────────────────
// Coming back from standby has left the island drawing new cards but deaf to clicks.
// These lines are there to find out which link breaks: the mouse reaching the page, or
// the page reaching the app. The page reports itself every few seconds (island.ts); the
// app writes down when it was stopped itself, when the page goes quiet, and, when Mochi
// quits (which is what you do when it is stuck), how everything looked at that moment.

/**
 * While the app is stopped (standby), Windows can't call its mouse hook and drops it (see
 * watchPointer). Switching click-through off and on again makes Electron ask for a new one,
 * so the page hears the pointer again without waiting for watchPointer's rescue.
 */
function freshMouseHook(): void {
  if (!win || clickable) return;
  win.setIgnoreMouseEvents(false);
  win.setIgnoreMouseEvents(true, { forward: true });
  note("fresh mouse hook");
}

/** Keeps a pointer or click event for the log at quit; only the latest RECENT_EVENTS. */
function note(event: string): void {
  recent.push(`${timestamp(new Date()).slice(11)} ${event}`);
  if (recent.length > RECENT_EVENTS) recent.shift();
}

/** "3 s ago", or "never" for 0. */
function ago(at: number): string {
  return at === 0 ? "never" : `${Math.round((Date.now() - at) / 1000)} s ago`;
}

/** How things look right now, in one line. */
function stateLine(): string {
  const parts = [
    `clickable ${clickable}`,
    `page says pointer on island ${pageHover}`,
    `pointer on island ${pointerOnIsland()}`,
    `window visible ${win?.isVisible() ?? false}`,
  ];
  if (!health) {
    parts.push("no report from the page yet");
  } else {
    const r = health.report;
    parts.push(
      `last report from the page ${ago(health.at)}`,
      `page: ${r.mode}, visible ${r.visible}, pointer on island ${r.hovering}`,
      `last mouse move ${ago(r.lastMove)}, press ${ago(r.lastDown)}, click ${ago(r.lastClick)}`,
    );
  }
  return parts.join("; ");
}

function watchHealth(): void {
  const now = Date.now();
  if (lastHealthCheck !== 0 && now - lastHealthCheck > PAUSED_MS) {
    log(`the app was stopped for ${Math.round((now - lastHealthCheck) / 1000)} s (standby?)`);
    // The page was stopped too; give it time to report again before calling it quiet.
    if (health) health.at = now;
    freshMouseHook();
  }
  lastHealthCheck = now;
  if (health && !pageQuiet && now - health.at > PAGE_QUIET_MS) {
    pageQuiet = true;
    log(`nothing from the page for ${Math.round((now - health.at) / 1000)} s; ${stateLine()}`);
  }
}

/** Messages are only accepted from our own window. */
function fromIsland(event: IpcMainEvent): boolean {
  return win !== null && event.sender === win.webContents;
}

/** fromIsland for a click on the island, which is also noted for the log (see note). */
function clicked(event: IpcMainEvent, what: string): boolean {
  const ok = fromIsland(event);
  note(`page: ${what}${ok ? "" : ", not from our window"}`);
  return ok;
}

ipcMain.on("answer", (event, requestId: unknown, choice: unknown) => {
  if (!clicked(event, `answer ${String(choice)}`) || typeof requestId !== "string") return;
  const end = open.get(requestId);
  const request = sessions.request(requestId);
  if (!end || !request) return;
  if (choice === "allow" || choice === "deny") {
    end(choice);
  } else if (choice === "always") {
    // Only ever the suggestion Claude Code itself sent with this request.
    if (request.always) end("allow", [request.always.entry]);
  } else if (choice === "vscode") {
    end(null);
    void goToSession(request.cwd, request.sessionId);
  }
});

ipcMain.on("focus-window", (event, sessionId: unknown) => {
  if (!clicked(event, "go to window") || typeof sessionId !== "string") return;
  const cwd = sessions.cwdOf(sessionId);
  if (cwd) void goToSession(cwd, sessionId);
});

ipcMain.on("go-to-question", (event, sessionId: unknown) => {
  if (!clicked(event, "go to question") || typeof sessionId !== "string") return;
  sessions.dismissQuestion(sessionId);
  push();
  const cwd = sessions.cwdOf(sessionId);
  if (cwd) void goToSession(cwd, sessionId);
});

ipcMain.on("forget-session", (event, sessionId: unknown) => {
  if (!clicked(event, "forget window") || typeof sessionId !== "string") return;
  for (const id of sessions.forget(sessionId)) open.get(id)?.(null);
  activity.forget(sessionId);
  push();
});

ipcMain.on("start-with-windows", (event, on: unknown) => {
  if (fromIsland(event) && typeof on === "boolean") setStartWithWindows(on);
});

ipcMain.on("quit", (event) => {
  if (fromIsland(event)) app.quit();
});

ipcMain.on("dismiss-toast", (event) => {
  if (!clicked(event, "dismiss toast")) return;
  sessions.dismissToast();
  push();
});

ipcMain.on("interactive", (event, on: unknown) => {
  if (!fromIsland(event)) return;
  pageHover = on === true;
  note(`page: pointer ${pageHover ? "on" : "off"} the island`);
  setClickable(pageHover, "page");
});

ipcMain.on("health", (event, report: unknown) => {
  if (!fromIsland(event) || typeof report !== "object" || report === null) return;
  const r = report as Record<string, unknown>;
  const times = [r.lastMove, r.lastDown, r.lastClick].every((t) => typeof t === "number");
  if (!times || typeof r.hovering !== "boolean" || typeof r.mode !== "string" || typeof r.visible !== "boolean") return;
  if (pageQuiet) {
    pageQuiet = false;
    log(`the page is reporting again, after ${Math.round((Date.now() - (health?.at ?? 0)) / 1000)} s`);
  }
  if (health && health.report.visible !== r.visible) log(`the page is ${r.visible ? "visible" : "hidden"} now (Chromium's view)`);
  health = { at: Date.now(), report: r as unknown as PageHealth };
});

ipcMain.on("island-box", (event, box: unknown) => {
  if (!fromIsland(event) || typeof box !== "object" || box === null) return;
  const { x, y, width, height } = box as Record<string, unknown>;
  if ([x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) {
    islandBox = { x, y, width, height } as IslandBox;
  }
});

ipcMain.on("connect", (event) => {
  if (fromIsland(event)) void connect();
});

ipcMain.on("tray-icon", (event, url: unknown) => {
  if (!fromIsland(event) || typeof url !== "string" || !url.startsWith("data:image/png;base64,")) return;
  tray?.setImage(nativeImage.createFromDataURL(url));
});

// ── Connecting to Claude Code ─────────────────────────────────────────────────

/** Copies the relay to its fixed place, so the hooks keep working if the program moves. */
function installRelay(): void {
  fs.mkdirSync(path.dirname(claude.RELAY_PATH), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "hook.js"), claude.RELAY_PATH);
}

function refreshConnected(): void {
  const read = claude.readSettings();
  connected = read.ok && claude.isConnected(read.settings);
  refreshTray();
  push();
}

async function connect(): Promise<void> {
  const read = claude.readSettings();
  if (!read.ok) {
    await dialog.showMessageBox({
      type: "error",
      title: "Mochi",
      message: "نتونستم تنظیمات Claude Code رو بخونم، برای همین بهش دست نزدم.",
      detail: read.reason,
    });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Mochi",
    buttons: ["وصل کن", "الان نه"],
    defaultId: 0,
    cancelId: 1,
    message: "موچی رو به Claude Code وصل کنم؟",
    detail: [
      `این فایل تغییر می‌کنه:\n${claude.SETTINGS_PATH}`,
      `این hookها بهش اضافه می‌شن:\n${claude.eventNames().join("، ")}`,
      `همه‌شون این رو اجرا می‌کنن:\n${claude.relayCommand()}`,
      "قبل از نوشتن، یه نسخه‌ی پشتیبان کنار فایل ذخیره می‌شه. hookهای خودت و بقیه‌ی تنظیمات دست نمی‌خورن.",
    ].join("\n\n"),
  });
  if (response !== 0) return;

  const backup = claude.writeSettings(claude.withMochi(read.settings));
  refreshConnected();
  await dialog.showMessageBox({
    type: "info",
    title: "Mochi",
    message: "وصل شد.",
    detail:
      (backup ? `نسخه‌ی پشتیبان:\n${backup}\n\n` : "") +
      "اگه پنجره‌ای که از قبل باز بوده موچی رو نشون نداد، توش یه گفت‌وگوی تازه با Claude باز کن.",
  });
}

async function disconnect(): Promise<void> {
  const read = claude.readSettings();
  if (!read.ok) {
    await dialog.showMessageBox({ type: "error", title: "Mochi", message: "نتونستم تنظیمات Claude Code رو بخونم.", detail: read.reason });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "Mochi",
    buttons: ["قطع کن", "نه"],
    defaultId: 1,
    cancelId: 1,
    message: "hookهای موچی از تنظیمات Claude Code پاک بشن؟",
    detail: `فقط hookهای خود موچی پاک می‌شن، با یه نسخه‌ی پشتیبان قبلش.\n\n${claude.SETTINGS_PATH}`,
  });
  if (response !== 0) return;
  claude.writeSettings(claude.withoutMochi(read.settings));
  refreshConnected();
}

/**
 * `mochi-claude.exe --uninstall`, run by scripts/uninstall.ps1: takes Mochi's hooks out
 * of Claude Code's settings (with a backup, as always), stops starting with Windows, and
 * deletes the relay. The script then deletes the program itself.
 */
function uninstall(): void {
  const read = claude.readSettings();
  if (read.ok) {
    const without = claude.withoutMochi(read.settings);
    if (JSON.stringify(without) !== JSON.stringify(read.settings)) claude.writeSettings(without);
  }
  app.setLoginItemSettings({ ...loginItem(), openAtLogin: false });
  fs.rmSync(path.dirname(claude.RELAY_PATH), { recursive: true, force: true });
  app.quit();
}

// ── Tray icon ─────────────────────────────────────────────────────────────────

/**
 * Starting with Windows: Electron writes Mochi into your user's "Run" list in the registry
 * (HKCU\Software\Microsoft\Windows\CurrentVersion\Run), which Windows starts at sign-in.
 * Run from source, Electron also needs to be told which folder to open.
 */
function loginItem(): { path: string; args: string[] } {
  return { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };
}

function setStartWithWindows(on: boolean): void {
  app.setLoginItemSettings({ ...loginItem(), openAtLogin: on });
  startsWithWindows = app.getLoginItemSettings(loginItem()).openAtLogin;
  refreshTray();
  push();
}

function refreshTray(): void {
  if (!tray) return;
  tray.setToolTip(connected ? "Mochi" : "Mochi · هنوز به Claude Code وصل نیست");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "همه‌ی پنجره‌ها", click: () => win?.webContents.send("open-overview") },
      { type: "separator" },
      connected
        ? { label: "قطع از Claude Code…", click: () => void disconnect() }
        : { label: "وصل به Claude Code…", click: () => void connect() },
      {
        label: "صدا",
        type: "checkbox",
        checked: soundOn,
        click: (item) => {
          soundOn = item.checked;
          push();
        },
      },
      {
        label: "با روشن شدن ویندوز باز بشه",
        type: "checkbox",
        checked: startsWithWindows,
        click: (item) => setStartWithWindows(item.checked),
      },
      { type: "separator" },
      { label: "خروج", click: () => app.quit() },
    ]),
  );
}

// ── Start and stop ────────────────────────────────────────────────────────────

// Opening Mochi again while it runs is what you'd do if the island went missing, so the
// window is put back in its place and shown, and then the list of windows opens.
app.on("second-instance", () => {
  logWindow("opened again while running");
  if (!win) return;
  placeWindow();
  win.showInactive();
  logWindow("shown again");
  win.webContents.send("open-overview");
});

// Closing Mochi must never leave Claude Code waiting: every open request goes back to VS Code.
app.on("before-quit", () => {
  log("quitting");
  // Quitting is what you do when Mochi is stuck, so this is the moment worth a picture.
  if (win) {
    log(`at quit: ${stateLine()}`);
    for (const event of recent) log(`  recent: ${event}`);
  }
  for (const end of [...open.values()]) end(null);
  stopHelper();
});

app.whenReady().then(async () => {
  if (SECOND_COPY) return;
  if (UNINSTALL) {
    uninstall();
    return;
  }
  log("ready");
  installRelay();
  if (START_WITH_WINDOWS) app.setLoginItemSettings({ ...loginItem(), openAtLogin: true });
  startsWithWindows = app.getLoginItemSettings(loginItem()).openAtLogin;

  try {
    await startPipe({ event: onEvent, ask: onAsk });
  } catch (error) {
    log(`pipe failed: ${(error as Error).message}`);
    // With the single-instance check above, a pipe that is taken means an older Mochi is
    // still running but didn't answer the hand-over.
    const message =
      (error as NodeJS.ErrnoException).code === "EADDRINUSE"
        ? "یه موچی دیگه از قبل باز مونده ولی جواب نمی‌ده. از Task Manager ببندش (mochi-claude.exe) و دوباره موچی رو باز کن."
        : `نتونستم منتظر Claude Code بمونم:\n${(error as Error).message}`;
    dialog.showErrorBox("Mochi", message);
    app.quit();
    return;
  }
  log("pipe listening");

  // Windows events that can move or hide a window, to read next to the window's own lines.
  app.on("child-process-gone", (_event, details) => log(`${details.type} process gone: ${details.reason}`));
  powerMonitor.on("suspend", () => log("going to sleep"));
  powerMonitor.on("resume", () => log("woke up"));
  powerMonitor.on("lock-screen", () => log("screen locked"));
  powerMonitor.on("unlock-screen", () => log("screen unlocked"));

  createWindow();
  tray = new Tray(nativeImage.createEmpty());
  tray.on("click", () => win?.webContents.send("open-overview"));
  refreshConnected();

  setInterval(() => {
    if (sessions.tidy()) push();
  }, 60 * 1000);
  setInterval(followActivity, ACTIVITY_POLL_MS);
  setInterval(watchPointer, POINTER_POLL_MS);
  setInterval(watchHealth, HEALTH_CHECK_MS);

  if (!connected) void connect();
});
