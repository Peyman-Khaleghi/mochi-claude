# mochi-claude

Mochi sits at the top of your screen and tells you which Claude Code window needs you.

With several VS Code windows each running Claude Code, it is easy to miss the one that
stopped to ask for permission, or the one that finished ten minutes ago. Mochi gathers
them in one place:

- **A permission request** opens a card: which window, what Claude wants to run, the
  exact command, and **Accept** / **Cancel**. VS Code asks at the same time; answer
  wherever you are, and the other one closes by itself.
- **A finished turn** shows Claude's last line, with a button that brings that window
  forward.
- **Click Mochi** to see every window and what it is doing. A working window shows the
  step it is on, in a few words: `Read island.ts`, `Grep startsWithWindows`,
  `Bash Run the tests`, or that it is thinking. A new Claude tab that is still empty
  is left out until it has a message or a name, so opening a tab just to pick an
  earlier conversation doesn't add a second, nameless window.
- The rest of the time Mochi tucks into the top edge of the screen: one coloured dot per
  window. Blue is working, orange is waiting for you, green finished, grey idle.

Mochi itself (the character, its animations and its sounds) is from
[Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé, under the MIT licence;
see `src/renderer/mochi/LICENSE`. This app is otherwise its own: Windows only, built
for several sessions at once, and without Coucou's chat, file drop and integrations.

## Installing

You need Node. Double-click **`install.cmd`**. It builds Mochi into a real program
(`mochi-claude.exe`) and installs it for your Windows user only, with no administrator
rights:

| What | Where |
|---|---|
| the program | `%LOCALAPPDATA%\Programs\Mochi Claude\` |
| Start menu entry | "Mochi Claude" |
| starting with Windows | turned on by the installer |

Run `install.cmd` again after changing the code: it closes the running Mochi and
replaces the installed copy. `uninstall.cmd` removes all of it (see below).

The first time, Mochi asks to connect to Claude Code (see below).

## Starting and stopping

- **Stop it:** click Mochi, then **خروج** under the count. Or the tray icon (next to
  the clock; Windows 11 may hide it behind the **^**) → **خروج**. Nothing breaks: with
  Mochi closed, Claude Code asks in VS Code as it always did (see the next section).
- **Start it again:** Start menu → **Mochi Claude**. Starting it while it is already
  running puts its window back at the top of the screen and opens the list of windows,
  so it is also the cure for a missing island.
- **If it misbehaves:** `%APPDATA%\mochi-claude\mochi.log` lists each step of every start
  (pipe, window, page loaded, shown, where) and what Windows did to the window after
  (sleep, lock, screen changes, and each time the island had to be made clickable because
  Windows stopped passing it the pointer). Nothing from Claude Code is written there.
- **Starting with Windows:** the switch **با ویندوز باز بشه** under the count, or the
  same item in the tray menu. It adds Mochi to your user's "Run" list
  (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), which Windows reads when
  you sign in. Settings → Apps → Startup lists it too, and can turn it off.
- **Remove it completely:** `uninstall.cmd`. It takes Mochi's hooks out of Claude
  Code's settings (with a backup), stops it starting with Windows, and deletes the
  program. This source folder is left as it is.

To run it from source instead, without installing: `pnpm install`, then `pnpm start`.

## Connecting to Claude Code

Connecting adds five hooks to your **user** settings, `%USERPROFILE%\.claude\settings.json`,
so they apply to every folder and window. You see exactly what will change before
anything is written, a dated backup is saved next to the file first, your own hooks and
settings are left alone, and disconnecting removes only Mochi's entries.

All five run the same small program, the *relay*, copied to
`%LOCALAPPDATA%\mochi-claude\hook.js` each time Mochi starts:

| Hook | What Mochi does with it | Makes Claude Code wait? |
|---|---|---|
| `SessionStart` | a new window appears | no (`async`) |
| `UserPromptSubmit` | that window is working | no |
| `PermissionRequest` | the card with Accept / Cancel | **yes**, until you answer |
| `Stop` | that window finished; the green card | no |
| `SessionEnd` | the window disappears | no |

**If Mochi is closed, nothing changes for Claude Code.** The relay gives up after 300 ms,
prints nothing, and Claude Code carries on as if Mochi did not exist.

## How it works

```
Claude Code ──runs──▶ relay (dist/hook.js) ──named pipe──▶ app (dist/main.js) ──▶ window (island)
             ◀─prints Accept/Cancel─┘                 ◀─answer───┘                 ◀─your click─┘
```

| File | Its job |
|---|---|
| `src/hook/relay.ts` | What Claude Code runs. Reads the event, passes it on, prints your answer. |
| `src/main/pipe.ts` | The app's end of the pipe. One connection per event. |
| `src/main/sessions.ts` | What Mochi knows about each window, and how each event changes it. |
| `src/main/transcript.ts` | Reading Claude Code's transcripts: a session's name, and finding a tool call. |
| `src/main/activity.ts` | The step a working window is on ("Read island.ts"), and whether Claude is asking you a question, from its transcript. |
| `src/main/answered-elsewhere.ts` | Notices when you answered in VS Code, so the card closes. |
| `src/main/claude-settings.ts` | Connecting and disconnecting: the careful edit of settings.json. |
| `src/main/vscode.ts` | «برو به VS Code»: brings the right window forward. |
| `src/main/main.ts` | Ties it together: the window, the tray, the dialogs. |
| `src/main/log.ts` | `mochi.log`: how Mochi started and what happened to its window. |
| `src/main/preload.ts` | The only door between the window and the app. |
| `src/renderer/island.ts` | What you see. Draws from the state the app sends. |
| `src/renderer/mochi/engine.ts` | Mochi, exactly as Coucou wrote it. Do not edit; replace it whole. |

## Commands

| Command | What it does |
|---|---|
| `pnpm start` | builds, then runs Mochi from source |
| `pnpm build` | builds into `dist/` |
| `pnpm run package` | builds the program into `release\Mochi Claude-win32-x64\` (`install.cmd` runs this) |
| `pnpm typecheck` | checks the TypeScript |
| `pnpm test` | runs the tests (`src/**/*.test.ts`) |
| `pnpm fake ask` | pretends to be Claude Code asking for permission; also `start`, `prompt`, `stop`, `end`, and a second word `shop` for another window |

To look at the island without Electron, run `pnpm build` and open
`dist/renderer/index.html#request` in a browser (or `#pill`, `#two`, `#toast`,
`#overview`, `#few`, `#empty`, `#long`, `#question`).

## Decisions

These were made on purpose; change them knowingly.

- **Electron and TypeScript**, not C#. Mochi's drawing (about 1,150 lines of
  animation maths) is TypeScript; this way it runs unchanged instead of being rewritten.
- **The buttons read Accept and Cancel**, in English. **Always allow** appears only
  when Claude Code itself offers a rule with the request, and the card shows that exact
  rule and where it is saved. Coucou's "Always" could save a broader permission than the
  card showed; this one can only save what you read.
- **The activity comes from the transcript, not from a hook.** A `PreToolUse` hook
  would make Claude Code start a program for every single tool call, in every window;
  the transcript already has each step, and reading it costs Claude Code nothing. The
  price: the transcript's format is Claude Code's own and not a promise, so if it
  changes, the tile quietly goes back to «داره کار می‌کنه».
- **A question from Claude (AskUserQuestion) gets a card with one button, «برو به VS Code».**
  The card doesn't show the question; it only says the window has one, since the answer
  can only be given in VS Code. The tool needs no permission, so no hook announces it:
  Mochi sees it in the transcript, like the activity, up to a second late.
- **No card for file edits.** These sessions don't ask permission to edit files; any
  other tool gets a generic card showing what it touches.
- **Every request stays on its own connection.** One window's request can never replace
  or answer another's.
- **Text from Claude is never treated as HTML or a link.** It is shown as plain text.
- **A card waits two minutes** (`HAND_BACK_AFTER_MS` in `main.ts`), then closes and leaves
  the question to VS Code, which asks at the same time anyway.
- **The app checks where the pointer is, ten times a second.** Mochi's window lets clicks
  through except on the island, and the island knows the pointer arrived only because
  Windows passes it the pointer's moves, through a mouse hook. Windows can drop that hook
  without a word, and then every click would fall through the island to VS Code. The
  app's own check (`watchPointer` in `main.ts`) makes the island clickable anyway.

## Not yet checked in real use

- Whether a window that was already open picks up the hooks without starting a new
  conversation in it.
- Whether «برو به VS Code» brings the window to the front, or only flashes it in the
  taskbar. Windows limits which programs may pull a window forward.

## Licence

MIT, see `LICENSE`. Two parts come from elsewhere and keep their own licences, next to
them: Mochi itself (`src/renderer/mochi/`, Coucou's, MIT) and the Vazirmatn font
(`src/renderer/fonts/`, SIL Open Font License).
