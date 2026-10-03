// A stand-in for window.mochi, so the island can be opened in an ordinary browser and
// looked at without Claude Code or Electron: open dist/renderer/index.html#request
// (or #pill, #two, #toast, #overview, #few, #empty, #long, #question). Clicks are logged,
// nothing else happens.
//
// Used only when window.mochi is missing, which in the real app it never is.

import type { Bridge, IslandState } from "../shared/view";

const minute = 60 * 1000;

function state(scene: string): IslandState {
  const now = Date.now();
  // Two sessions share the my-website folder, so each shows its own name too.
  const sessions: IslandState["sessions"] = [
    { id: "a", project: "my-website", title: "صفحه‌ی پرداخت", state: "waiting", since: now },
    { id: "b", project: "my-api", state: "working", since: now - 3 * minute, activity: { kind: "tool", tool: "Bash", target: "Run the test suite" } },
    { id: "c", project: "mochi-claude", state: "finished", since: now - 2 * minute },
    // A long folder name: it must be cut with "…", never stick out of its tile.
    { id: "d", project: "my-company-engineering-backend-api", state: "idle", since: now - 60 * minute },
    { id: "e", project: "my-website", title: "fix cart bug", state: "working", since: now - 5 * minute, activity: { kind: "tool", tool: "Read", target: "CartController.cs" } },
  ];
  const first = {
    id: "r1",
    sessionId: "a",
    project: "my-website",
    title: "صفحه‌ی پرداخت",
    cwd: "C:\\Projects\\my-website",
    tool: "Bash",
    description: "Inspect the repo: remote, unpushed commits, untracked files",
    command: 'echo "=== branch" && git status -sb | head -3 && git fetch --quiet origin; git log --oneline origin/main..HEAD',
    always: { rules: ["git fetch *", "git log *"], where: "projectSettings" as const },
  };
  // A very long command: in the queue row it must be cut with "…", not widen the island.
  const second = {
    id: "r2",
    sessionId: "b",
    project: "my-api",
    cwd: "C:\\Projects\\my-api",
    tool: "Bash",
    description: "Inspect the backend repo",
    command:
      'cd /c/Projects/my-api && echo "=== branch/remote" && git status -sb | head -8 && git remote -v && echo "=== unpushed commits" && git fetch --quiet origin 2>&1; git log --oneline origin/main..HEAD; echo "=== behind?"',
  };
  // Everything long at once: the card must stay inside the island, cutting the name and
  // the "Always allow" rule with "…" (both shown whole on hover) and wrapping the rest.
  const long = {
    id: "r3",
    sessionId: "d",
    project: "my-company-engineering-backend-api",
    title: "a session whose name is far too long for the card",
    cwd: "C:\\Projects\\my-company-engineering-backend-api\\services\\payments\\integration-tests",
    tool: "Bash",
    description: "Run two copies of a test app to see what the second one does while the first still holds the lock",
    command: 'node "C:\\Users\\me\\AppData\\Local\\Temp\\scratchpad\\d02ec460-99e2-4803-8cb2-33facf9ad877\\lock-test\\run.mjs" $electron',
    always: {
      rules: ['node "C:\\Users\\me\\AppData\\Local\\Temp\\scratchpad\\d02ec460-99e2-4803-8cb2-33facf9ad877\\lock-test\\run.mjs" $electron'],
      where: "localSettings" as const,
    },
  };
  const base: IslandState = { sessions, requests: [], questions: [], toast: null, connected: true, soundOn: false, startsWithWindows: true };
  switch (scene) {
    case "request":
      return { ...base, requests: [first] };
    case "long":
      return { ...base, requests: [long] };
    case "question":
      // Two windows asking: the first gets the card, the second waits in a row under it.
      return {
        ...base,
        sessions: sessions.map((s) => (s.id === "e" ? { ...s, state: "waiting" } : s)),
        questions: [
          { sessionId: "a", project: "my-website", title: "صفحه‌ی پرداخت", at: now - minute },
          { sessionId: "e", project: "my-website", title: "fix cart bug", at: now },
        ],
      };
    case "two":
      return { ...base, sessions: sessions.map((s) => (s.id === "b" ? { ...s, state: "waiting" } : s)), requests: [first, second] };
    case "toast":
      return {
        ...base,
        sessions: sessions.map((s) => (s.id === "a" ? { ...s, state: "finished" } : s)),
        toast: { sessionId: "e", project: "my-website", title: "fix cart bug", message: "سه تا فایل رو درست کردم و تست‌ها همه پاس شدن. commit هم کردم؛ push با خودته.", at: now },
      };
    case "empty":
      return { ...base, sessions: [], connected: false };
    case "few":
      return { ...base, sessions: sessions.filter((s) => s.id === "b" || s.id === "d") };
    default:
      return base;
  }
}

export function demoBridge(): Bridge {
  const scene = location.hash.replace("#", "") || "pill";
  const log = (...args: unknown[]) => console.log("[demo]", ...args);
  return {
    onState: (listener) => setTimeout(() => listener(state(scene)), 0),
    onOpenOverview: (listener) => {
      if (scene === "overview" || scene === "few" || scene === "empty") setTimeout(listener, 10);
    },
    answer: (id, choice) => log("answer", id, choice),
    focusWindow: (id) => log("focus", id),
    goToQuestion: (id) => log("go to question", id),
    forgetSession: (id) => log("forget", id),
    dismissToast: () => log("dismiss toast"),
    setInteractive: () => {},
    setIslandBox: () => {},
    reportHealth: () => {},
    connect: () => log("connect"),
    setStartWithWindows: (on) => log("start with windows", on),
    quit: () => log("quit"),
    setTrayIcon: () => {},
  };
}
