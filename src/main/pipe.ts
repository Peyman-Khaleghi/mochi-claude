// The app's end of the named pipe (see shared/pipe.ts for the conversation itself).
//
// Every connection is one hook event. An "event" connection says its line and hangs
// up. An "ask" connection stays open until the request is answered; if it closes first,
// Claude Code gave up on the hook (most likely you answered in VS Code), and onGone runs.
//
// Who can connect: Windows gives a named pipe's creator, administrators and SYSTEM full
// access, and everyone else read-only, which is not enough to send a request. A program
// running as *you* can connect, but such a program could just as well edit Claude Code's
// settings directly, so the pipe is not the weak point. Each request is answered only on
// its own connection: a new connection can never replace or answer someone else's.

import net from "node:net";
import { isHookInput, type HookInput } from "../shared/hook-input";
import { MAX_LINE_BYTES, pipePath, type AppReply, type Decision } from "../shared/pipe";

export interface Ask {
  input: HookInput;
  /**
   * Sends the answer and hangs up. Safe to call more than once; only the first counts.
   * `updatedPermissions` goes with "allow" only: the rule to save ("Always allow").
   */
  reply(decision: Decision | null, updatedPermissions?: unknown[]): void;
  /** Runs if the relay hangs up before an answer was sent. */
  onGone(listener: () => void): void;
}

export interface PipeHandlers {
  event(input: HookInput): void;
  ask(ask: Ask): void;
}

export function startPipe(handlers: PipeHandlers): Promise<net.Server> {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;

    socket.on("error", () => socket.destroy());
    socket.on("data", (text: string) => {
      if (handled) return; // one message per connection; anything after it is ignored
      buffer += text;
      if (buffer.length > MAX_LINE_BYTES) return socket.destroy();
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      handled = true;

      let message: { kind?: unknown; input?: unknown };
      try {
        message = JSON.parse(buffer.slice(0, end));
      } catch {
        return socket.destroy();
      }
      if (!isHookInput(message.input)) return socket.destroy();

      if (message.kind === "event") {
        socket.end();
        handlers.event(message.input);
      } else if (message.kind === "ask") {
        handlers.ask(makeAsk(socket, message.input));
      } else {
        socket.destroy();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipePath(), () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function makeAsk(socket: net.Socket, input: HookInput): Ask {
  let done = false;
  const goneListeners: Array<() => void> = [];

  socket.on("close", () => {
    if (done) return;
    done = true;
    goneListeners.forEach((listener) => listener());
  });

  return {
    input,
    reply(decision, updatedPermissions) {
      if (done) return;
      done = true;
      const reply: AppReply = decision === "allow" && updatedPermissions ? { decision, updatedPermissions } : { decision };
      socket.end(JSON.stringify(reply) + "\n");
    },
    onGone(listener) {
      goneListeners.push(listener);
    },
  };
}
