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
  /**
   * Screen-space cursor smoothing (research 015): speeds in screens per second, deadband in
   * screen widths. Measured on the playground sessions: frame-to-frame shake 6.0 → 2.2 px at
   * 1080p, +~20 ms lag on fast sweeps, selections unchanged.
   */
  smoothing: {
    minCutoff: 0.8,
    beta: 8,
    dCutoff: 1,
    deadband: 0.004,
  },
  /**
   * Precision for a held hand (research 022), after smoothing: slow movement moves the cursor by
   * `minGain` of itself, rising to 1:1 at `fastSpeed`; the cursor–hand gap closes with
   * `recoverFastMs` while moving fast, `recoverSlowMs` otherwise. Speeds in screen heights per
   * second (150 and 800 px/s at 1080p). Measured on the playground sessions: shake 1.84 → 1.00
   * px, held still before a select 13.6 → 9.4 px, same selects, edges still reachable.
   * `maxGap` bounds how far the cursor may trail the hand (a slow steady drag would otherwise
   * trail it by ~140 px); scenes where the player draws switch precision off (`cursorPrecise`).
   */
  precision: {
    windowMs: 100,
    maxGap: 60 / 1080,
    minGain: 0.3,
    slowSpeed: 150 / 1080,
    fastSpeed: 800 / 1080,
    recoverFastMs: 60,
    recoverSlowMs: 2000,
    aspect: 16 / 9,
  },
  /**
   * Raise (EPISODE II: set the price with your hand). Level 0 when the higher wrist is this far
   * above the hips (SW), 1 at `highAbove` — a hand overhead. Hanging arms measured ~0 above the
   * hips; raised overhead 2.6–3.0 (research 009/010 recordings).
   */
  raise: {
    lowAbove: 0.3,
    highAbove: 2.6,
    /** Smoothing time constant: steady value, still follows a deliberate move in ~¼ s. */
    smoothingMs: 120,
    minVisibility: 0.5,
  },
  /**
   * Slap (EPISODE IV): a fast sweep of the cursor, speed in screen heights per second over
   * `windowMs` (research 019). Measured on the recordings: button play in the side zone stays
   * under 3 (p99 2.4); deliberate swipes reach 4–7.
   */
  slap: {
    windowMs: 100,
    /** Ignore the first frames after the cursor appears: too short a span to judge speed. */
    minSpanMs: 60,
    startSpeed: 3.5,
    keepSpeed: 2.5,
    /** Screen width / height of the kiosk TV, so a sideways sweep counts like a vertical one. */
    aspect: 16 / 9,
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
