// Mochi's sounds. mochi/engine.ts calls Sound.play(name) at a few of its own moments
// (a greeting, a slap); island.ts calls it when a card appears or you answer one.
//
// Coucou fetches and decodes its WAVs through WebAudio. A page loaded from disk is not
// allowed to fetch, so these play through <audio> instead. Only the files copied into
// assets/sounds exist; any other name is silently ignored.

const AVAILABLE = new Set(["greet", "approval", "approve", "finish", "peek", "open", "close", "pop"]);

/**
 * Coucou's default is 0.12 and its volume slider stops at 0.2. A sound whose whole job
 * is to pull you away from another window sits at the top of that range.
 */
const VOLUME = 0.2;

class SoundPlayer {
  enabled = true;
  private players = new Map<string, HTMLAudioElement>();

  play(name: string): void {
    if (!this.enabled || !AVAILABLE.has(name)) return;
    let audio = this.players.get(name);
    if (!audio) {
      audio = new Audio(`sounds/${name}.wav`);
      audio.volume = VOLUME;
      this.players.set(name, audio);
    }
    audio.currentTime = 0;
    audio.play().catch(() => {
      /* a sound that cannot play must never break the island */
    });
  }
}

export const Sound = new SoundPlayer();
