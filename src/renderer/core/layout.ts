// The two type names mochi/engine.ts imports from Coucou's core/layout.ts. Coucou's
// file holds much more (its own island layout); only these are needed, copied exactly,
// so engine.ts can stay byte-for-byte as Coucou wrote it.

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";
