// Everything Mochi knows about your Claude Code sessions, and how each hook event
// changes it. Plain logic with no Electron in it, so it can be read and tested alone.
//
// A "session" is one Claude Code conversation. The folder it runs in names it
// ("my-website"); when several sessions share a folder, each also shows its own name.
//
//   SessionStart        → idle        (a conversation was opened; see below)
//   UserPromptSubmit    → working     (you sent a message)
//   PermissionRequest   → waiting     (Claude needs your yes or no)
//   request answered    → working
//   a question asked    → waiting     (AskUserQuestion; seen in the transcript, see setQuestion)
//   question answered   → working
//   Stop                → finished    (Claude ended its turn; you get a toast)
//   SessionEnd          → removed
//
// A request still open when its session sends a new message, ends its turn or closes is
// over: event() returns its id so the app can let go of it.
//
// A session that has been "finished" for FINISHED_FOR_MS quietly becomes "idle".
// One that has heard nothing for FORGET_AFTER_MS is dropped (its window was probably
// closed without a SessionEnd).
//
// A new, empty conversation (a fresh Claude tab) is not shown until it has a message or
// a name. Often you open a tab only to pick an earlier conversation from its history; the
// empty one would otherwise sit on Mochi as a second, nameless window.
//
// While working, a session also has an activity ("Read island.ts"), which main.ts reads
// from its transcript (activity.ts) and hands in with setActivity.

import path from "node:path";
import type { HookInput } from "../shared/hook-input";
import type { Activity, Destination, IslandState, QuestionView, RequestView, SessionState, SessionView, ToastView } from "../shared/view";

const FINISHED_FOR_MS = 30 * 60 * 1000;
const FORGET_AFTER_MS = 12 * 60 * 60 * 1000;
const MESSAGE_MAX_CHARS = 280;
const DESTINATIONS: readonly string[] = ["session", "localSettings", "projectSettings", "userSettings"];
/** Tools whose rules are just a command pattern, shown as "git fetch *" rather than "Bash(git fetch *)". */
const COMMAND_TOOLS: readonly string[] = ["Bash", "PowerShell"];

interface Session {
  id: string;
  cwd: string;
  state: SessionState;
  since: number;
  lastHeard: number;
  /** The session's own name, from its transcript (see transcript.ts). */
  title?: string;
  /** Has done anything besides being opened: a message, a request, a finished turn. */
  hasChat: boolean;
  /** As the hook events gave it; main.ts checks it (isTranscript) before reading it. */
  transcriptPath?: string;
  activity?: Activity;
  /** A question from Claude waiting for your answer; `dismissed` once you went to VS Code for it. */
  question?: { at: number; dismissed: boolean };
}

/** The app's own switches, which the window shows next to the sessions. */
export interface AppView {
  connected: boolean;
  soundOn: boolean;
  startsWithWindows: boolean;
}

/** Claude Code's "always allow" offer for one request, kept exactly as it arrived. */
export interface AlwaysAllow {
  rules: string[];
  where: Destination;
  /** The suggestion object itself; "Always allow" sends back this and nothing else. */
  entry: unknown;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  cwd: string;
  tool: string;
  toolInput: Record<string, unknown>;
  transcriptPath?: string;
  always?: AlwaysAllow;
}

interface Toast {
  sessionId: string;
  project: string;
  message: string;
  at: number;
}

export class Sessions {
  private sessions = new Map<string, Session>();
  private requests: PermissionRequest[] = [];
  private toast: Toast | null = null;

  constructor(private now: () => number = Date.now) {}

  /**
   * Applies a hook event that needs no answer. Returns the ids of requests this event
   * ended (their turn is over), for the app to let go of.
   */
  event(input: HookInput): string[] {
    const t = this.now();
    switch (input.hook_event_name) {
      case "SessionStart":
        this.touch(input, this.sessions.get(input.session_id)?.state ?? "idle");
        return [];
      case "UserPromptSubmit": {
        this.touch(input, "working");
        const s = this.sessions.get(input.session_id)!;
        s.activity = undefined; // a new turn hasn't done anything yet
        s.question = undefined;
        return this.dropRequests(input.session_id);
      }
      case "Stop": {
        this.touch(input, "finished");
        this.sessions.get(input.session_id)!.question = undefined;
        const message = firstLine(input.last_assistant_message ?? "");
        this.toast = { sessionId: input.session_id, project: projectName(input.cwd), message, at: t };
        return this.dropRequests(input.session_id);
      }
      case "SessionEnd":
        this.sessions.delete(input.session_id);
        if (this.toast?.sessionId === input.session_id) this.toast = null;
        return this.dropRequests(input.session_id);
      default:
        return [];
    }
  }

  /** Records a permission request; `id` is how the window will refer to it. */
  ask(input: HookInput, id: string): PermissionRequest {
    this.touch(input, "waiting");
    const request: PermissionRequest = {
      id,
      sessionId: input.session_id,
      cwd: input.cwd,
      tool: input.tool_name ?? "?",
      toolInput: input.tool_input ?? {},
      transcriptPath: input.transcript_path,
      always: alwaysAllow(input.permission_suggestions),
    };
    this.requests.push(request);
    return request;
  }

  /** The request is over, however it ended. Its session goes back to working. */
  settle(requestId: string): void {
    const request = this.requests.find((r) => r.id === requestId);
    if (!request) return;
    this.requests = this.requests.filter((r) => r !== request);
    const session = this.sessions.get(request.sessionId);
    if (session && !session.question && !this.requests.some((r) => r.sessionId === session.id)) {
      session.state = "working";
      session.since = this.now();
    }
  }

  /**
   * Whether the session's transcript shows a question from Claude waiting for your answer
   * (main.ts reads it with activity.ts). While one is open, the session is "waiting".
   * Returns true when it changed, so the app only redraws when there is something new.
   */
  setQuestion(sessionId: string, open: boolean): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || open === (s.question !== undefined)) return false;
    const t = this.now();
    if (open) {
      s.question = { at: t, dismissed: false };
      s.state = "waiting";
      s.since = t;
    } else {
      s.question = undefined;
      if (s.state === "waiting" && !this.requests.some((r) => r.sessionId === s.id)) {
        s.state = "working";
        s.since = t;
      }
    }
    return true;
  }

  /** You went to VS Code for this question: its card closes, the session stays waiting. */
  dismissQuestion(sessionId: string): void {
    const q = this.sessions.get(sessionId)?.question;
    if (q) q.dismissed = true;
  }

  /**
   * You took this window off Mochi (the × on its tile). Its open requests end too.
   * If the session does something again, it simply comes back.
   */
  forget(sessionId: string): string[] {
    this.sessions.delete(sessionId);
    if (this.toast?.sessionId === sessionId) this.toast = null;
    return this.dropRequests(sessionId);
  }

  setTitle(sessionId: string, title: string | undefined): void {
    const session = this.sessions.get(sessionId);
    if (session && title) session.title = title;
  }

  /** Returns true when it changed, so the app only redraws when there is something new. */
  setActivity(sessionId: string, activity: Activity | undefined): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || JSON.stringify(session.activity) === JSON.stringify(activity)) return false;
    session.activity = activity;
    return true;
  }

  /**
   * The sessions whose transcript is worth following: the working ones (for their
   * activity), and those with a question open (to see it answered).
   */
  followed(): Array<{ id: string; transcriptPath?: string }> {
    return [...this.sessions.values()]
      .filter((s) => s.state === "working" || s.question !== undefined)
      .map((s) => ({ id: s.id, transcriptPath: s.transcriptPath }));
  }

  request(id: string): PermissionRequest | undefined {
    return this.requests.find((r) => r.id === id);
  }

  cwdOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.cwd;
  }

  dismissToast(): void {
    this.toast = null;
  }

  /** Ages finished sessions into idle and forgets silent ones. Call now and then. */
  tidy(): boolean {
    const t = this.now();
    let changed = false;
    for (const s of this.sessions.values()) {
      if (s.state === "finished" && t - s.since > FINISHED_FOR_MS) {
        s.state = "idle";
        s.since = t;
        changed = true;
      }
      if (t - s.lastHeard > FORGET_AFTER_MS && !this.requests.some((r) => r.sessionId === s.id)) {
        this.sessions.delete(s.id);
        changed = true;
      }
    }
    return changed;
  }

  view(app: AppView): IslandState {
    const shown = [...this.sessions.values()].filter((s) => s.hasChat || s.title !== undefined);
    const names = labels(shown);
    const sessions: SessionView[] = shown.map((s) => ({
      id: s.id,
      ...names.get(s.id)!,
      state: s.state,
      since: s.since,
      ...(s.state === "working" && s.activity ? { activity: s.activity } : {}),
    }));
    const requests: RequestView[] = this.requests.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      ...(names.get(r.sessionId) ?? { project: projectName(r.cwd) }),
      cwd: r.cwd,
      tool: r.tool,
      ...describe(r.tool, r.toolInput),
      ...(r.always ? { always: { rules: r.always.rules, where: r.always.where } } : {}),
    }));
    const questions: QuestionView[] = shown
      .filter((s) => s.question && !s.question.dismissed)
      .map((s) => ({ sessionId: s.id, ...names.get(s.id)!, at: s.question!.at }))
      .sort((a, b) => a.at - b.at);
    const toast: ToastView | null = this.toast && {
      sessionId: this.toast.sessionId,
      ...(names.get(this.toast.sessionId) ?? { project: this.toast.project }),
      message: this.toast.message,
      at: this.toast.at,
    };
    return { sessions, requests, questions, toast, ...app };
  }

  private dropRequests(sessionId: string): string[] {
    const ended = this.requests.filter((r) => r.sessionId === sessionId).map((r) => r.id);
    this.requests = this.requests.filter((r) => r.sessionId !== sessionId);
    return ended;
  }

  private touch(input: HookInput, state: SessionState): void {
    const t = this.now();
    let s = this.sessions.get(input.session_id);
    if (!s) {
      s = { id: input.session_id, cwd: input.cwd, state, since: t, lastHeard: t, hasChat: false };
      this.sessions.set(s.id, s);
    }
    if (input.hook_event_name !== "SessionStart") s.hasChat = true;
    if (s.state !== state) {
      s.state = state;
      s.since = t;
    }
    s.cwd = input.cwd;
    s.transcriptPath = input.transcript_path ?? s.transcriptPath;
    s.lastHeard = t;
  }
}

/** "C:\Projects\my-website" → "my-website". */
function projectName(cwd: string): string {
  return path.win32.basename(cwd) || cwd;
}

/**
 * Every session is named after its folder. When several share a folder, each also gets
 * its own name (its title, or a number until it has one), so they can be told apart.
 */
function labels(sessions: Session[]): Map<string, { project: string; title?: string }> {
  const byProject = new Map<string, Session[]>();
  for (const s of sessions) {
    const project = projectName(s.cwd);
    byProject.set(project, [...(byProject.get(project) ?? []), s]);
  }
  const result = new Map<string, { project: string; title?: string }>();
  for (const [project, group] of byProject) {
    group.forEach((s, i) => {
      result.set(s.id, group.length === 1 ? { project } : { project, title: s.title ?? String(i + 1) });
    });
  }
  return result;
}

/**
 * The first suggestion that adds "allow" rules, if Claude Code offered one. Anything
 * else (changing the permission mode, removing rules…) is not offered on the card.
 */
function alwaysAllow(suggestions: unknown): AlwaysAllow | undefined {
  if (!Array.isArray(suggestions)) return undefined;
  for (const entry of suggestions) {
    const e = entry as { type?: unknown; behavior?: unknown; destination?: unknown; rules?: unknown };
    if (e?.type !== "addRules" || e.behavior !== "allow" || typeof e.destination !== "string") continue;
    if (!DESTINATIONS.includes(e.destination) || !Array.isArray(e.rules) || e.rules.length === 0) continue;
    const rules = e.rules.map((r: { toolName?: unknown; ruleContent?: unknown }) => {
      if (typeof r?.toolName !== "string") return null;
      if (typeof r.ruleContent !== "string") return r.toolName;
      return COMMAND_TOOLS.includes(r.toolName) ? r.ruleContent : `${r.toolName}(${r.ruleContent})`;
    });
    if (rules.some((r) => r === null)) continue;
    return { rules: rules as string[], where: e.destination as Destination, entry };
  }
  return undefined;
}

function firstLine(text: string): string {
  const line = text.trim().split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.length > MESSAGE_MAX_CHARS ? line.slice(0, MESSAGE_MAX_CHARS - 1) + "…" : line;
}

/**
 * What the card shows about a request. A tool that runs a command (Bash, PowerShell)
 * gets its description and exact command; every other tool gets the one field that says
 * what it touches, or a short JSON.
 */
function describe(_tool: string, input: Record<string, unknown>): Pick<RequestView, "description" | "command" | "detail"> {
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const command = text(input.command);
  if (command !== undefined) {
    return { description: text(input.description), command };
  }
  const detail =
    text(input.file_path) ?? text(input.url) ?? text(input.path) ?? text(input.pattern) ?? JSON.stringify(input);
  return { detail: detail.length > 400 ? detail.slice(0, 399) + "…" : detail };
}
