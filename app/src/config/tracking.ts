/** Landmark stability settings applied to the player after PlayerLock — see stabilizer.ts. */
export const stabilityConfig = {
  /** Time constant of the visibility low-pass filter. */
  visibilitySmoothingMs: 120,
  /** A landmark appears once smoothed visibility reaches `showAt`, disappears below `hideBelow`. */
  showAt: 0.6,
  hideBelow: 0.3,
  /** Raw visibility at which a landmark's position is trusted. */
  confidentAt: 0.5,
  /** While not trusted, keep the last trusted position this long instead of the model's guess. */
  holdMs: 200,
} as const;
