/**
 * Gesture thresholds in body units (SW = shoulder width, from body space; +y is down).
 * Defaults come from the first recorded session (tests/fixtures/poses) — see docs/ARCHITECTURE.md §7.
 */
export const gestureConfig = {
  cursor: {
    /**
     * A hand drives the cursor when it is raised above the waist and the arm is extended.
     * Pointing measured 0.9–1.7 SW wrist-to-shoulder; scratching head / touching face 0.3–0.7.
     */
    activateExtension: 0.9,
    /** Pointing toward the camera foreshortens the arm (0.7 measured pointing at the top). */
    deactivateExtension: 0.6,
    /**
     * Wrist must be this far above the hips (SW) to start pointing, but may then sink to
     * `releaseAboveHips` to reach the bottom of the screen. The wide gap stops a loosely
     * hanging hand (≈0.7 above hips in recordings) from stealing the cursor.
     */
    activateAboveHips: 0.8,
    releaseAboveHips: 0.3,
    /** Pointing must hold this long before the cursor appears — hides brief fidget flickers. */
    activateAfterMs: 100,
    minVisibility: 0.5,
    /**
     * Reach box mapped to the whole screen, for the right hand (mirrored for the left).
     * Pointing sweeps measured x −1.4…1.7, y −1.1…0.9 SW.
     */
    box: { x0: -1.4, x1: 1.7, y0: -1.3, y1: 0.5 },
  },
  dwell: {
    holdMs: 1200,
    /** Leaving the target for less than this keeps the progress. */
    graceMs: 150,
    /** After a select, the same target cannot fire again for this long. */
    cooldownMs: 800,
    /** Extra hit area around targets, in screen units. */
    padding: 0.02,
  },
} as const;
