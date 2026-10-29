/** Caption pacing (ARCHITECTURE §9.2). */
export const narrativeConfig = {
  /** Typewriter speed, in grapheme clusters (a Thai letter with its marks counts once). */
  charsPerSec: 35,
  /** A typed line stays this long at least… */
  holdMinMs: 1800,
  /** …or this long per character, whichever is longer. */
  holdPerCharMs: 60,
  /** A cue line with no text gives the scene this long to animate. */
  cueMs: 1500,
};
