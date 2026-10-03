// VS Code shows its own permission prompt at the same time as Mochi's card. When you
// answer there, Mochi's card has to close by itself, or a stale card stays on screen.
//
// Claude Code doesn't tell the hook: the relay is left waiting. And a PermissionRequest
// carries no id for the call. So Mochi reads the session's transcript instead:
//   1. find the call itself, by its tool and input (transcript.ts → findToolUseId);
//   2. wait for that call's result to be appended. A result is written whether you
//      allowed it, refused it, or pressed Esc.
//
// It reads only what was appended since the last look, once a second, and only while
// the card is open.

import { findToolUseId, isTranscript, readRange, readTail, sizeOf } from "./transcript";

const POLL_MS = 1000;
/** How far back to look for the call. It was written moments before the request. */
const SEARCH_BYTES = 512_000;

/** Starts watching; returns a function that stops. Does nothing for a path it doesn't trust. */
export function watchForAnswer(
  transcriptPath: string | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  onAnswered: () => void,
): () => void {
  if (!isTranscript(transcriptPath)) return () => {};
  const file = transcriptPath;

  let id: string | undefined;
  let offset = 0;
  let carry = ""; // the end of the previous read, in case the needle was cut in half

  function answered(): boolean {
    if (id === undefined) {
      // findToolUseId skips calls that already have a result, so a found call is still open.
      const { text, end } = readTail(file, SEARCH_BYTES);
      id = findToolUseId(text, toolName, toolInput);
      offset = end;
      return false;
    }
    const size = sizeOf(file);
    if (size <= offset) return false;
    const needle = `"tool_use_id":"${id}"`;
    const text = carry + readRange(file, offset, size);
    offset = size;
    if (text.includes(needle)) return true;
    carry = text.slice(-needle.length);
    return false;
  }

  answered();
  const timer = setInterval(() => {
    if (!answered()) return;
    clearInterval(timer);
    onAnswered();
  }, POLL_MS);
  return () => clearInterval(timer);
}
