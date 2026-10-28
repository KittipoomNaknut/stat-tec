/**
 * Gesture thresholds in body units (SW = shoulder width, from body space; +y is down).
 * Defaults come from the first recorded session (tests/fixtures/poses) — see docs/ARCHITECTURE.md §7.
 */
import type { PerceptionSource } from '../perception/protocol';

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
    /**
     * Arm straightness (shoulder-wrist / (shoulder-elbow + elbow-wrist)) to start pointing and to
     * keep pointing. Separates crossed arms and head-scratching from pointing — see the replay
     * tests; extension alone failed on crossed arms in the RTMPose session.
     */
    activateStraightness: 0.8, // RTMPose; see cursorConfigFor() for MediaPipe
    releaseStraightness: 0.5,
    /**
     * Keep pointing with a short-looking arm (pointing at the camera: 0.28-0.53 SW measured) as
     * long as it stays straight (0.68-0.83 measured); head-scratching is bent (0.23-0.40).
     */
    foreshortenedStraightness: 0.65,
    foreshortenedMinExtension: 0.25,
    /**
     * Once pointing, keep it while the wrist stays this far above the hips (SW), whatever the arm
     * shape. Research 010: recovered both failed holds in the playground replay (22 → 24 of 24)
     * with no cursor during fidgeting or standing. Starting still needs the strict rules above.
     */
    keepWhileAboveHips: 1.0 as number | null,
    /** Pointing must hold this long before the cursor appears — hides brief fidget flickers. */
    activateAfterMs: 100,
    minVisibility: 0.5,
    /**
     * Interaction zone mapped to the whole screen, for the right hand (mirrored for the left), in
     * body space: x outward from the body's center line, y down. Research 010: a zone across the
     * whole body (old: x −1.4…1.7) put the screen center where the arm points at the camera and
     * collapses in 2D (button 5 never selected). This zone sits beside and above the shoulder
     * (0.5, 0): the screen center needs the wrist ~0.55 SW outside the shoulder. Measured reach of
     * straight raised arms: outward 1.4–1.5 SW typical, arm length ~1.5 SW (98%: 2.0).
     */
    box: { x0: 0.4, x1: 1.7, y0: -1.2, y1: 0.3 },
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

/**
 * Per pose source: each model's errors differ, so thresholds are calibrated on recordings of each
 * (tests/replay). RTMPose reports crossed arms with straightness up to ~0.76, so it needs 0.8;
 * MediaPipe's elbows are rougher (left-hand pointing 0.46-0.78), which 0.8 would cut in half.
 */
type Widen<T> = { readonly [K in keyof T]: T[K] extends number ? number : Widen<T[K]> };
/** Cursor thresholds with plain number types (the literals above are only the defaults). */
export type CursorConfig = Widen<typeof gestureConfig.cursor>;

const CURSOR_BY_SOURCE: Record<PerceptionSource, Partial<CursorConfig>> = {
  server: {},
  mediapipe: { activateStraightness: 0.7 },
};

export function cursorConfigFor(source: PerceptionSource): CursorConfig {
  return { ...gestureConfig.cursor, ...CURSOR_BY_SOURCE[source] };
}
