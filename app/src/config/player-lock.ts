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
  /** Two detections whose torsos are closer than this × shoulder width are one person. */
  duplicateRadiusSW: 0.6,
  /** …and only if their shoulder widths differ by less than this ratio (else it is a second person in front). */
  duplicateMaxSizeRatio: 1.4,
} as const;
