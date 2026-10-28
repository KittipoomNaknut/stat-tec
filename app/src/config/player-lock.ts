/** PlayerLock tuning — see docs/ARCHITECTURE.md §5.3. Distances are fractions of frame width. */
export const playerLockConfig = {
  /** A torso must be inside this horizontal band to become the player. */
  zoneMinX: 0.25,
  zoneMaxX: 0.75,
  /** score = centerWeight · centeredness + (1 − centerWeight) · closeness */
  centerWeight: 0.6,
  /** Shoulder width (fraction of frame width) that counts as fully close. */
  closeShoulderWidth: 0.25,
  minScore: 0.6,
  /** Mean visibility of shoulders and hips needed to consider a pose at all. */
  minConfidence: 0.5,
  /** How long a candidate must hold before it is locked. */
  lockAfterMs: 500,
  /** Locked player missing this long → `lost`. Shorter gaps keep the lock silently. */
  lostAfterMs: 300,
  /** A lost player who returns within this time keeps their id. */
  forgetAfterMs: 1500,
  /** Max torso movement between frames to still be the same person. */
  trackRadius: 0.15,
  /** Wider radius when matching a lost player who comes back. */
  returnRadius: 0.25,
  /**
   * Two detections are one person when the smaller one's box lies at least this much inside
   * the larger. MediaPipe sometimes adds a degenerate second fit of the same person.
   */
  duplicateContainment: 0.85,
  /** A match may differ from the player's (smoothed) body scale by at most this factor. */
  maxScaleChange: 1.7,
  /** Per-match weight of the newest scale in the player's smoothed scale (~0.3 s at 30 fps). */
  scaleSmoothing: 0.1,
} as const;
