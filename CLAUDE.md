# mochi-claude — instructions

How to work in this repository. What the app is and how it works is in `README.md`;
read it first. Its **Decisions** section is the record of choices made on purpose.

## Style

- Prefer boring, conventional code with comments that explain *why*.
- Code, comments and docs are in English; Persian only inside user-facing strings.
- Never introduce something you cannot explain in two sentences.

## Rules

- **Do not `git push`.** The owner pushes, personally, every time.
- Commit messages: lowercase, one short subject line.
- **Never edit `src/renderer/mochi/engine.ts`.** It is Coucou's file, unchanged; update it
  by replacing it whole from github.com/Louis-CFM/coucou (`windows/src/mochi/engine.ts`).
  Its two imports are satisfied by `src/renderer/core/`.
- Anything that writes `%USERPROFILE%\.claude\settings.json` goes through
  `src/main/claude-settings.ts`, with a backup, and is covered by its tests.
- The relay (`src/hook/relay.ts`) must never block or break Claude Code. On any doubt,
  print nothing and exit 0.
- Text that came from Claude Code is shown with `textContent`, never `innerHTML`.
- Don't start long-running or heavy processes the owner didn't ask for. `pnpm start`
  opens a window on their screen; say so before running it.

## Checking your work

```powershell
pnpm typecheck
pnpm test
pnpm build
```

To see the island without Electron, open `dist/renderer/index.html#request` (or `#pill`,
`#two`, `#toast`, `#overview`, `#few`, `#empty`, `#long`, `#question`) in headless Edge and take a screenshot. To
exercise the real app without Claude Code, use `pnpm fake …` (see README).

The approved look is in `docs/mockups/`. A change to how the island looks should still
match it, or be agreed with the owner first.
