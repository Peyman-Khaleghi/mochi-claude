// What the app sends the window to draw. The window never sees raw hook input; the
// app reduces it to these shapes first (see main/sessions.ts).

export type SessionState = "working" | "waiting" | "finished" | "idle";

/**
 * What a working session is doing right now (main/activity.ts): a tool and the one thing
 * it touches ("Read" + "island.ts"), or thinking, or writing its reply.
 */
export type Activity =
  | { kind: "tool"; tool: string; target?: string }
  | { kind: "thinking" }
  | { kind: "writing" };

/** Where an "Always allow" rule is saved; Claude Code's own names (see the hooks docs). */
export type Destination = "session" | "localSettings" | "projectSettings" | "userSettings";

export interface SessionView {
  id: string;
  /** The folder's name, e.g. "my-website". */
  project: string;
  /**
   * Only when several sessions share a folder: the session's name (the one you gave it,
   * or the one Claude made up), so they can be told apart. Shown as "my-website · name".
   */
  title?: string;
  state: SessionState;
  /** When the session entered its current state, in milliseconds since 1970. */
  since: number;
  /** Only while working, once its transcript shows a step. */
  activity?: Activity;
}

export interface RequestView {
  id: string;
  sessionId: string;
  project: string;
  title?: string;
  cwd: string;
  /** The tool Claude wants to use, e.g. "Bash". */
  tool: string;
  /** Bash only: the plain-words description Claude wrote for the command. */
  description?: string;
  /** Bash only: the exact command. */
  command?: string;
  /** Any other tool: a short summary of what it will touch (a file, a URL…). */
  detail?: string;
  /**
   * Claude Code's own "always allow" offer for this request, when it made one: the rules
   * it would save (e.g. "git fetch *") and where. The card shows exactly this.
   */
  always?: { rules: string[]; where: Destination };
}

/**
 * A window where Claude asked you a question (its AskUserQuestion tool). Mochi doesn't
 * show the question: it can only be answered in VS Code, so the card just says there is
 * one and takes you there.
 */
export interface QuestionView {
  sessionId: string;
  project: string;
  title?: string;
  /** When it was asked, in milliseconds since 1970; also tells a new question from one already seen. */
  at: number;
}

export interface ToastView {
  sessionId: string;
  project: string;
  title?: string;
  /** The first line of Claude's last message in that turn. */
  message: string;
  at: number;
}

export interface IslandState {
  sessions: SessionView[];
  /** Oldest first: the first one is the card on top. */
  requests: RequestView[];
  /** Open questions you haven't gone to VS Code for yet, oldest first. Their cards come after the requests'. */
  questions: QuestionView[];
  /** The most recent "finished", until you dismiss it. */
  toast: ToastView | null;
  /** Whether Mochi's hooks are in Claude Code's settings. */
  connected: boolean;
  soundOn: boolean;
  /** Whether Mochi opens by itself when you sign in to Windows. */
  startsWithWindows: boolean;
}

/** A rectangle in the window, in CSS pixels from its top-left corner. */
export interface IslandBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the window may ask of the app. Defined once so both sides agree. */
export interface Bridge {
  onState(listener: (state: IslandState) => void): void;
  onOpenOverview(listener: () => void): void;
  /**
   * "always" allows and saves Claude Code's own suggested rule; "vscode" hands the
   * request back to VS Code and brings that window forward.
   */
  answer(requestId: string, choice: "allow" | "always" | "deny" | "vscode"): void;
  /** Brings forward that session's VS Code window and its Claude tab. */
  focusWindow(sessionId: string): void;
  /**
   * «برو به VS Code» on a question's card: brings that window forward and closes the card.
   * The window stays "waiting" on Mochi until the question is answered.
   */
  goToQuestion(sessionId: string): void;
  /** The × on a window's tile: takes it off Mochi until it does something again. */
  forgetSession(sessionId: string): void;
  dismissToast(): void;
  /** While the pointer is over the island, clicks land on it; elsewhere they pass through. */
  setInteractive(on: boolean): void;
  /** Where the island is, each time its size changes; the app checks the pointer against it too (main.ts, watchPointer). */
  setIslandBox(box: IslandBox): void;
  connect(): void;
  setStartWithWindows(on: boolean): void;
  /** Closes Mochi. Any open card goes back to VS Code first (main.ts → before-quit). */
  quit(): void;
  setTrayIcon(pngDataUrl: string): void;
}
