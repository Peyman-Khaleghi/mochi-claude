// What you see: Mochi and the cards at the top of the screen.
//
// The app (main/main.ts) sends the whole state every time something changes, and this
// file redraws the island from it. Nothing here decides anything about Claude Code: it
// shows what it is told and reports your clicks back through window.mochi.
//
// Everything Claude wrote (commands, descriptions, messages, session names) is put on
// screen with textContent, never as HTML, so nothing it says can become markup or a link.
//
// The island has five looks, picked by mode():
//   request   a permission request or a question from Claude is open (always wins)
//   toast     a window just finished
//   overview  every window, after you click Mochi
//   pill      Mochi and one mini Mochi per window, while the pointer is on it
//   lip       tucked into the top edge: one coloured dot per window

import type { BotStateName } from "./core/layout";
import { Sound } from "./core/sound";
import { demoBridge } from "./demo";
import { BotEngine, hexToRGB } from "./mochi/engine";
import type { Activity, Bridge, Destination, IslandState, QuestionView, RequestView, SessionState, SessionView, ToastView } from "../shared/view";

declare global {
  interface Window {
    mochi?: Bridge;
  }
}

const bridge: Bridge = window.mochi ?? demoBridge();
const demoScene = window.mochi ? null : location.hash.replace("#", "") || "pill";
// In the app the window is see-through; in a browser, a dark page stands in for your screen.
if (demoScene) document.body.style.background = "#26272b";

/** How long a "finished" card stays if you don't touch it. */
const TOAST_MS = 12_000;
/** How long the island stays open after the pointer leaves it. */
const LEAVE_GRACE_MS = 700;
/** How long Mochi waves hello when the app starts. */
const GREETING_MS = 2600;
/** How long the pointer rests on a cut name before its whole text appears. */
const TIP_DELAY_MS = 350;
/** What can be cut with "…" and shown whole on hover: window names and "Always allow" rules. */
const WHOLE_ON_HOVER = ".name, .always-note code";

/** The same four colours as style.css, which takes them from Mochi's own palette. */
const COLOR: Record<SessionState, string> = {
  working: "#3B9EFF",
  waiting: "#F5A524",
  finished: "#34D499",
  idle: "#94A2B8",
};

/** How each window's mini Mochi behaves in each state. */
const MINI_STATE: Record<SessionState, BotStateName> = {
  working: "working",
  waiting: "approval",
  finished: "idle", // plus a happy face, see syncMinis
  idle: "sleeping",
};

/** Where an "Always allow" rule is saved, in words (Claude Code's destinations). */
const WHERE: Record<Destination, string> = {
  session: "فقط تا آخر همین گفت‌وگو",
  localSettings: "توی همین پروژه، فقط برای خودت",
  projectSettings: "توی همین پروژه، در تنظیمات مشترکش (shared)",
  userSettings: "توی همه‌ی پروژه‌ها",
};

// ── One Mochi on one canvas ───────────────────────────────────────────────────

class Mochi {
  readonly engine = new BotEngine();
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;

  constructor(readonly w: number, readonly h: number, color?: string) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx = this.canvas.getContext("2d")!;
    if (color) {
      this.engine.isMini = true;
      this.engine.bodyColor = hexToRGB(color);
    }
  }

  frame(dt: number): void {
    this.engine.update(dt);
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.engine.draw(this.ctx, this.w, this.h);
  }

  lookAt(x: number, y: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0) return;
    this.engine.lookX = clamp((x - (r.left + r.width / 2)) / 220, -1, 1);
    this.engine.lookY = clamp((y - (r.top + r.height / 2)) / 160, -1, 1);
  }
}

/** The big Mochi on cards. */
const avatar = new Mochi(150, 140);
avatar.engine.particleOverhang = 10;
/** Mochi in the overview: smaller than on a card, so its column doesn't outgrow the tiles. */
const host = new Mochi(100, 90);
host.engine.particleOverhang = 8;
/** The small Mochi in the pill. */
const small = new Mochi(56, 44);
/** One mini Mochi per window, coloured by what that window is doing. */
const minis = new Map<string, Mochi>();
const miniShows = new Map<string, SessionState>();

// ── State ─────────────────────────────────────────────────────────────────────

let state: IslandState = { sessions: [], requests: [], questions: [], toast: null, connected: true, soundOn: true, startsWithWindows: false };
let hovering = demoScene === "pill";
let overviewOpen = false;
let greetingUntil = 0;
let started = false;
let knownRequests = new Set<string>();
let knownToastAt = 0;
let toastShownAt = 0;
let toastTimer = 0;
let leaveTimer = 0;
let lastPointerMove = 0;

type Mode = "request" | "toast" | "overview" | "pill" | "lip";

function mode(): Mode {
  if (state.requests.length > 0 || state.questions.length > 0) return "request";
  if (state.toast) return "toast";
  if (overviewOpen) return "overview";
  if (hovering || Date.now() < greetingUntil) return "pill";
  return "lip";
}

bridge.onState((next) => {
  Sound.enabled = next.soundOn;

  // A request is known by its id, a question by its window and when it was asked.
  const keys = [...next.requests.map((r) => r.id), ...next.questions.map((q) => `${q.sessionId}@${q.at}`)];
  const fresh = keys.some((key) => !knownRequests.has(key));
  knownRequests = new Set(keys);
  const newToast = next.toast !== null && next.toast.at !== knownToastAt;
  if (next.toast) knownToastAt = next.toast.at;

  state = next;
  syncMinis();

  if (!started) {
    started = true;
    greetingUntil = Date.now() + GREETING_MS;
    small.engine.greet(); // waves, and plays the greeting sound itself
    setTimeout(render, GREETING_MS + 50);
    sendTrayIcon();
  }
  if (fresh) {
    Sound.play("approval");
    avatar.engine.setState("approval", true);
  } else if (newToast && next.requests.length === 0) {
    Sound.play("finish");
    avatar.engine.setState("finished", true);
  }
  render();
});

bridge.onOpenOverview(() => {
  overviewOpen = true;
  render();
  // Opened from the tray, the pointer may never come to the island; don't stay open forever.
  clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    if (!hovering) {
      overviewOpen = false;
      render();
    }
  }, 5000);
});

function syncMinis(): void {
  const ids = new Set(state.sessions.map((s) => s.id));
  for (const id of [...minis.keys()]) {
    if (!ids.has(id)) {
      minis.delete(id);
      miniShows.delete(id);
    }
  }
  for (const s of state.sessions) {
    let m = minis.get(s.id);
    if (!m) {
      m = new Mochi(36, 32, COLOR[s.state]);
      minis.set(s.id, m);
    }
    if (miniShows.get(s.id) === s.state) continue;
    miniShows.set(s.id, s.state);
    m.engine.bodyColor = hexToRGB(COLOR[s.state]);
    m.engine.setPermanentEmote(s.state === "finished" ? "happy" : null);
    m.engine.setState(MINI_STATE[s.state]);
  }
}

// ── Pointer ───────────────────────────────────────────────────────────────────

const root = document.getElementById("island")!;
let shownMode: Mode | null = null;

root.addEventListener("mouseenter", () => {
  hovering = true;
  clearTimeout(leaveTimer);
  bridge.setInteractive(true);
  if (mode() !== shownMode) {
    if (shownMode === "lip") Sound.play("peek");
    render();
  }
});

root.addEventListener("mouseleave", () => {
  hideTip();
  if (demoScene === "pill") return;
  hovering = false;
  bridge.setInteractive(false);
  clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    overviewOpen = false;
    render();
  }, LEAVE_GRACE_MS);
});

// The mouseenter above depends on Windows passing the pointer's moves to this page, and
// Windows can stop doing that. So the app also checks the pointer itself (main.ts,
// watchPointer), and for that it needs to know where the island is.
new ResizeObserver(() => {
  const r = root.getBoundingClientRect();
  bridge.setIslandBox({ x: r.x, y: r.y, width: r.width, height: r.height });
}).observe(root);

// Mochi's eyes follow the pointer while it is near the island.
window.addEventListener("mousemove", (e) => {
  lastPointerMove = performance.now();
  pointerX = e.clientX;
  pointerY = e.clientY;
  avatar.lookAt(e.clientX, e.clientY);
  host.lookAt(e.clientX, e.clientY);
  small.lookAt(e.clientX, e.clientY);
  updateTip();
});

// ── Whole text on hover ───────────────────────────────────────────────────────
// A name cut with "…" appears whole in a small label under it while the pointer rests
// on it. The label holds a copy of the name, so it reads exactly like the original.

const tip = el("div", "tip");
document.body.append(tip);
let pointerX = -1;
let pointerY = -1;
/** The text the label is showing, or waiting to show; "" when there is none. */
let tipText = "";
let tipTimer = 0;

/** The name (or rule) under the pointer, if part of it is cut off; null otherwise. */
function cutTextUnderPointer(): HTMLElement | null {
  const target = document.elementFromPoint(pointerX, pointerY)?.closest<HTMLElement>(WHOLE_ON_HOVER);
  if (!target) return null;
  const parts = [target, ...Array.from(target.querySelectorAll<HTMLElement>("*"))];
  return parts.some((part) => part.scrollWidth > part.clientWidth) ? target : null;
}

/** Runs on every pointer move and after every redraw, which can replace what is under a still pointer. */
function updateTip(): void {
  const target = cutTextUnderPointer();
  const text = target?.textContent ?? "";
  if (text !== tipText) {
    hideTip();
    tipText = text;
    if (text) tipTimer = window.setTimeout(showTip, TIP_DELAY_MS);
  } else if (target && tip.classList.contains("on")) {
    placeTip(target);
  }
}

function showTip(): void {
  const target = cutTextUnderPointer();
  if (!target) return;
  tip.replaceChildren(target.cloneNode(true));
  // Names read right to left like the island; a rule is code, left to right.
  tip.dir = target.matches("code") ? "ltr" : "rtl";
  placeTip(target);
  tip.classList.add("on");
}

function hideTip(): void {
  clearTimeout(tipTimer);
  tipText = "";
  tip.classList.remove("on");
}

/** Under the text, its right edge lined up with the text's; above it if there's no room below. */
function placeTip(target: HTMLElement): void {
  const r = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const below = r.bottom + 6;
  const top = below + h <= window.innerHeight - 4 ? below : r.top - 6 - h;
  tip.style.left = `${clamp(r.right - w, 4, window.innerWidth - w - 4)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

// ── Drawing the island ────────────────────────────────────────────────────────

function render(): void {
  const m = mode();
  const body = build(m);
  if (m !== shownMode && m !== "lip") body.classList.add("enter");
  root.replaceChildren(body);
  shownMode = m;
  updateTip();
  setMochiMoods(m);
  if (m === "toast") armToastTimer();
  startLoop();

  // When the island shrinks out from under a still pointer, no mouseleave arrives;
  // without this the empty space would keep swallowing clicks meant for VS Code.
  requestAnimationFrame(() => {
    if (hovering && demoScene === null && !root.matches(":hover")) {
      hovering = false;
      bridge.setInteractive(false);
    }
  });
}

function build(m: Mode): HTMLElement {
  switch (m) {
    case "lip":
      return lip();
    case "pill":
      return pill();
    case "request":
      return requests();
    case "toast":
      return toast(state.toast!);
    case "overview":
      return overview();
  }
}

function lip(): HTMLElement {
  const lip = el("div", "lip");
  for (const s of state.sessions) lip.append(el("i", s.state));
  return lip;
}

function pill(): HTMLElement {
  const body = el("div", "body pill");
  small.canvas.className = "me";
  small.canvas.onclick = () => {
    overviewOpen = true;
    Sound.play("open");
    render();
  };
  body.append(small.canvas);
  if (state.sessions.length > 0) {
    const row = el("div", "minis");
    for (const s of state.sessions) row.append(minis.get(s.id)!.canvas);
    body.append(el("div", "sep"), row);
  }
  return body;
}

function requests(): HTMLElement {
  const body = el("div", "body");
  // Permission requests first: Claude Code is held up until you answer them. Then questions.
  const waiting: Array<RequestView | QuestionView> = [...state.requests, ...state.questions];
  const [first, ...rest] = waiting;
  body.append(isQuestion(first) ? questionCard(first, waiting.length) : requestCard(first, waiting.length));

  // A window's mini Mochi is one canvas, so it can sit in only one row. (Not isConnected:
  // during a redraw the canvas is still in the old rows, which are about to be replaced.)
  const placed = new Set<string>();
  for (const r of rest.slice(0, 2)) {
    const row = el("div", "queue");
    const mini = minis.get(r.sessionId);
    if (mini && !placed.has(r.sessionId)) {
      placed.add(r.sessionId);
      row.append(mini.canvas);
    }
    let what: HTMLElement;
    if (isQuestion(r)) {
      what = el("span", "what", "هم یه سؤال ازت داره");
    } else {
      what = el("span", "what", "هم منتظر توئه · ");
      what.append(el("span", "mono", r.command ?? r.detail ?? r.tool));
    }
    row.append(nameEl(r.project, r.title), what);
    body.append(row);
  }
  if (rest.length > 2) {
    const row = el("div", "queue");
    row.append(el("span", "more", `و ${fa(rest.length - 2)} تای دیگه`));
    body.append(row);
  }
  return body;
}

function requestCard(r: RequestView, total: number): HTMLElement {
  const card = el("div", "card waiting");
  const content = el("div", "content");

  const who = el("div", "who");
  who.append(
    el("span", "dot"),
    nameEl(r.project, r.title),
    el("span", "what", r.command !== undefined ? "می‌خواد یه دستور اجرا کنه" : `می‌خواد از ${r.tool} استفاده کنه`),
  );
  if (total > 1) who.append(el("span", "when", `۱ از ${fa(total)}`));
  content.append(who);

  if (r.description) content.append(el("div", "desc", r.description));
  if (r.command !== undefined) {
    const cmd = el("div", "cmd");
    cmd.append(el("span", "prompt", "$"), document.createTextNode(r.command));
    content.append(cmd);
  }
  if (r.detail) content.append(el("div", "cmd detail", r.detail));
  content.append(where(r.cwd));

  // The same order as VS Code's own prompt: yes, yes and remember, no.
  const actions = el("div", "actions");
  actions.append(
    button("Accept", "btn primary", () => {
      Sound.play("approve");
      bridge.answer(r.id, "allow");
    }),
  );
  if (r.always) {
    actions.append(
      button("Always allow", "btn always", () => {
        Sound.play("approve");
        bridge.answer(r.id, "always");
      }),
    );
  }
  actions.append(
    button("Cancel", "btn", () => {
      Sound.play("close");
      bridge.answer(r.id, "deny");
    }),
    button("برو به VS Code", "btn ghost", () => bridge.answer(r.id, "vscode"), ICON_GO),
  );
  content.append(actions);
  if (r.always) content.append(alwaysNote(r.always));

  card.append(el("div", "glow"), avatarBox(), content);
  return card;
}

/**
 * Claude asked you a question (AskUserQuestion). It can only be answered in VS Code, so
 * the card says only that there is one, and its one button takes you there.
 */
function questionCard(q: QuestionView, total: number): HTMLElement {
  const card = el("div", "card waiting");
  const content = el("div", "content");

  const who = el("div", "who");
  who.append(el("span", "dot"), nameEl(q.project, q.title), el("span", "what", "یه سؤال ازت داره"));
  if (total > 1) who.append(el("span", "when", `۱ از ${fa(total)}`));

  const actions = el("div", "actions");
  actions.append(button("برو به VS Code", "btn primary", () => bridge.goToQuestion(q.sessionId), ICON_GO));
  content.append(who, actions);

  card.append(el("div", "glow"), avatarBox(), content);
  return card;
}

function isQuestion(item: RequestView | QuestionView): item is QuestionView {
  return !("tool" in item);
}

/** Exactly what "Always allow" saves, and where: never broader than what you read here. */
function alwaysNote(always: NonNullable<RequestView["always"]>): HTMLElement {
  const note = el("div", "always-note", "«Always allow» دیگه اینا رو ازت نمی‌پرسه:");
  for (const rule of always.rules) note.append(el("code", "", rule));
  note.append(el("span", "", `· ${WHERE[always.where]}`));
  return note;
}

function toast(t: ToastView): HTMLElement {
  const body = el("div", "body");
  const card = el("div", "card finished");
  const content = el("div", "content");

  const who = el("div", "who");
  who.append(el("span", "dot"), nameEl(t.project, t.title), el("span", "what", "کارش تموم شد"), el("span", "when", ago(t.at)));
  content.append(who);
  if (t.message) content.append(el("div", "said", t.message));

  const actions = el("div", "actions");
  actions.append(
    button(
      "برو به VS Code",
      "btn primary",
      () => {
        bridge.focusWindow(t.sessionId);
        dismissToast();
      },
      ICON_GO,
    ),
    button("باشه", "btn", dismissToast),
  );
  content.append(actions);

  card.append(el("div", "glow"), avatarBox(), content);
  body.append(card);
  return body;
}

function overview(): HTMLElement {
  const body = el("div", "body");
  const wrap = el("div", "overview");
  const waiting = state.sessions.filter((s) => s.state === "waiting").length;
  const working = state.sessions.filter((s) => s.state === "working").length;

  const me = el("div", `pane me ${waiting > 0 ? "waiting" : "idle"}`);
  host.canvas.onclick = () => {
    overviewOpen = false;
    Sound.play("close");
    render();
  };
  const count = state.sessions.length > 0 ? `${fa(state.sessions.length)} تا پنجره` : "هیچ پنجره‌ای";
  const sub =
    waiting === 1
      ? "یکی منتظر توئه"
      : waiting > 1
        ? `${fa(waiting)} تا منتظر توئن`
        : working === 1
          ? "یکی داره کار می‌کنه"
          : working > 1
            ? `${fa(working)} تا دارن کار می‌کنن`
            : "همه آرومن";
  me.append(el("div", "glow"), host.canvas, el("div", "count", count), el("div", waiting > 0 ? "sub urgent" : "sub", sub));

  const pane = el("div", "pane list");
  const tiles = el("div", state.sessions.length > 1 ? "tiles" : "tiles one");
  if (!state.connected) {
    const notice = el("div", "notice", "موچی هنوز به Claude Code وصل نیست.");
    notice.append(button("وصل کن", "btn primary", () => bridge.connect()));
    tiles.append(notice);
  } else if (state.sessions.length === 0) {
    tiles.append(el("div", "notice", "هنوز پنجره‌ای ندیدم. توی VS Code یه پیام به Claude بفرست تا اینجا پیداش بشه."));
  }
  for (const s of state.sessions) {
    // The whole tile goes to that window and its Claude tab; the × takes it off Mochi.
    const tile = el("div", `tile ${s.state}`);
    tile.title = "برو به همین پنجره و همین گفت‌وگو";
    tile.addEventListener("click", () => bridge.focusWindow(s.id));
    const text = el("div", "t");
    text.append(nameEl(s.project, s.title), el("span", "st", status(s)));
    if (s.activity) text.append(activityEl(s.activity));
    const go = icon(ICON_GO);
    go.className = "go";
    const close = button("", "close", () => bridge.forgetSession(s.id), ICON_X);
    close.title = "برداشتن از موچی";
    close.addEventListener("click", (e) => e.stopPropagation());
    tile.append(minis.get(s.id)!.canvas, text, go, close);
    tiles.append(tile);
  }
  pane.append(tiles, controls());
  wrap.append(me, pane);
  body.append(wrap);
  return body;
}

/**
 * Mochi's own two switches. They are in the tray menu too, but Windows 11 hides new tray
 * icons behind the ^ next to the clock, so they are here where you already are.
 */
function controls(): HTMLElement {
  const box = el("div", "controls");
  const on = state.startsWithWindows;
  const startup = el("button", "opt");
  startup.setAttribute("role", "switch");
  startup.setAttribute("aria-checked", String(on));
  startup.title = on ? "الان با روشن شدن ویندوز خودش باز می‌شه" : "الان با روشن شدن ویندوز باز نمی‌شه";
  startup.append(el("i", on ? "track on" : "track"), el("span", "", "با ویندوز باز بشه"));
  startup.addEventListener("click", () => bridge.setStartWithWindows(!on));

  const quit = button("خروج", "opt", () => bridge.quit(), ICON_POWER);
  quit.title = "موچی بسته می‌شه و Claude Code مثل قبل کار می‌کنه. از منوی Start دوباره بازش کن.";
  box.append(startup, quit);
  return box;
}

/** A working window's current step, under «داره کار می‌کنه»: "Read island.ts", or thinking / writing. */
function activityEl(a: Activity): HTMLElement {
  if (a.kind === "thinking") return el("span", "act", "فکر می‌کنه…");
  if (a.kind === "writing") return el("span", "act", "می‌نویسه…");
  const line = el("span", "act code");
  line.append(el("b", "", a.tool));
  if (a.target) line.append(el("span", "target", a.target));
  return line;
}

/** "my-website", or "my-website · its name" when several sessions share the folder. */
function nameEl(project: string, title?: string): HTMLElement {
  const name = el("span", "name");
  name.append(el("span", "proj", project));
  if (title) name.append(el("span", "sep", "·"), el("span", "title", title));
  return name;
}

function avatarBox(): HTMLElement {
  const box = el("div", "avatar");
  avatar.canvas.onclick = () => avatar.engine.slap();
  box.append(avatar.canvas);
  return box;
}

function where(cwd: string): HTMLElement {
  const row = el("div", "where");
  row.append(icon(ICON_FOLDER), el("span", "", cwd));
  return row;
}

function dismissToast(): void {
  clearTimeout(toastTimer);
  toastTimer = 0;
  bridge.dismissToast();
}

/** The "finished" card leaves by itself, but never while the pointer is on it. */
function armToastTimer(): void {
  if (!state.toast || toastShownAt === state.toast.at) return;
  toastShownAt = state.toast.at;
  clearTimeout(toastTimer);
  const check = () => {
    if (hovering) toastTimer = window.setTimeout(check, 2000);
    else dismissToast();
  };
  toastTimer = window.setTimeout(check, TOAST_MS);
}

/** What each Mochi feels, given what the island is showing. */
function setMochiMoods(m: Mode): void {
  const anyWaiting = state.sessions.some((s) => s.state === "waiting");
  if (m === "request") avatar.engine.setState("approval");
  else if (m === "toast") avatar.engine.setState("finished");
  else if (m === "overview") host.engine.setState(anyWaiting ? "approval" : "idle");
  small.engine.setState(anyWaiting ? "approval" : "idle");
}

// ── Animation ─────────────────────────────────────────────────────────────────
// Runs only while something is on screen. Tucked into the lip, Mochi costs nothing.

let frame = 0;
let lastTime = 0;

function startLoop(): void {
  if (frame || shownMode === "lip") return;
  lastTime = performance.now();
  frame = requestAnimationFrame(tick);
}

function tick(time: number): void {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  // With the pointer still for a while, Mochi looks at the card instead of at nothing.
  if (time - lastPointerMove > 3000) {
    avatar.engine.lookX = -0.5;
    avatar.engine.lookY = 0.15;
  }

  for (const m of [avatar, host, small, ...minis.values()]) {
    if (m.canvas.isConnected) m.frame(dt);
  }
  if (shownMode === "lip") {
    frame = 0;
    return;
  }
  frame = requestAnimationFrame(tick);
}

/** The tray icon is Mochi too, drawn once, the same way. */
function sendTrayIcon(): void {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const engine = new BotEngine();
  engine.update(1 / 60);
  ctx.translate(-4.5, -4.5); // draw at 41 px and centre it, so the body fills the icon
  engine.draw(ctx, 41, 41);
  bridge.setTrayIcon(canvas.toDataURL("image/png"));
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void, iconSvg?: string): HTMLButtonElement {
  const b = el("button", className, label);
  if (iconSvg) b.append(icon(iconSvg));
  b.addEventListener("click", onClick);
  return b;
}

/** Only ever called with the constant icons below, never with anything from Claude. */
function icon(svg: string): HTMLElement {
  const span = el("span");
  span.style.display = "inline-flex";
  span.innerHTML = svg;
  return span;
}

const ICON_FOLDER =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const ICON_GO =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 17 7 7"/><path d="M7 15V7h8"/></svg>';
const ICON_X =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_POWER =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/></svg>';

function status(s: SessionView): string {
  switch (s.state) {
    case "working":
      return "داره کار می‌کنه";
    case "waiting":
      return "منتظر جواب توئه";
    case "finished":
      return `کارش تموم شد · ${ago(s.since)}`;
    case "idle":
      return "بیکاره";
  }
}

function ago(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "همین الان";
  if (minutes < 60) return `${fa(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${fa(hours)} ساعت پیش`;
  return `${fa(Math.floor(hours / 24))} روز پیش`;
}

/** 12 → ۱۲ */
function fa(n: number): string {
  return n.toLocaleString("fa-IR");
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
