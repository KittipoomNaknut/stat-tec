import { gestureConfig } from '../config/gestures';
import { Landmark } from '../perception/landmarks';
import { LANDMARK_STRIDE } from '../perception/protocol';

/**
 * Static poses a player holds to answer (research 025). Named from the player's side: in the
 * mirror-like screen their left hand is on the left too.
 */
export const POSES = ['both-up', 'left-up', 'right-up', 'cross', 't-pose'] as const;
export type PoseName = (typeof POSES)[number];

export type PoseConfig = typeof gestureConfig.pose;

export interface PoseEvent {
  /** The pose seen now (after `enterMs`), or null. */
  pose: PoseName | null;
  /** 0..1 of the hold toward a select. */
  progress: number;
  /** Set on the frame the hold completes. */
  held: boolean;
}

/**
 * Reads the player's pose from body space (SW units, +y down, shoulders at y = 0). A pose must
 * be seen for `enterMs` before it counts (no flashes while moving from one to another), then
 * held `holdMs` to select; it fires once per hold and needs a different pose (or none) to fire
 * again.
 */
export class PoseDetector {
  readonly #c: PoseConfig;
  #candidate: PoseName | null = null;
  #since = 0;
  #fired = false;

  constructor(config: PoseConfig = gestureConfig.pose) {
    this.#c = config;
  }

  update(body: Float32Array | null, tMs: number): PoseEvent {
    const pose = body ? classify(body, this.#c) : null;
    if (pose !== this.#candidate) {
      this.#candidate = pose;
      this.#since = tMs;
      this.#fired = false;
    }
    const age = tMs - this.#since;
    if (!pose || age < this.#c.enterMs) return { pose: null, progress: 0, held: false };
    const progress = Math.min(1, (age - this.#c.enterMs) / this.#c.holdMs);
    const held = progress >= 1 && !this.#fired;
    if (held) this.#fired = true;
    return { pose, progress: this.#fired && !held ? 1 : progress, held };
  }
}

/** The pose a body is in, or null. Exported for tests and replays. */
export function classify(body: Float32Array, c: PoseConfig = gestureConfig.pose): PoseName | null {
  const seen = (i: number) => (body[i * LANDMARK_STRIDE + 3] ?? 0) >= c.minVisibility;
  const x = (i: number) => body[i * LANDMARK_STRIDE] ?? 0;
  const y = (i: number) => body[i * LANDMARK_STRIDE + 1] ?? 0;
  const RW = Landmark.RIGHT_WRIST;
  const LW = Landmark.LEFT_WRIST;
  if (!seen(RW) || !seen(LW)) return null;

  // Hand up: wrist well above the shoulders, over the head rather than pointing out sideways
  const up = (w: number) => y(w) <= -c.upAbove && Math.abs(x(w)) <= c.upMaxOut;
  const down = (w: number) => y(w) >= c.downBelow;
  const rUp = up(RW);
  const lUp = up(LW);
  if (rUp && lUp) return 'both-up';
  if (lUp && down(RW)) return 'left-up';
  if (rUp && down(LW)) return 'right-up';

  // T: both arms straight out at shoulder height
  const out = (w: number, side: 1 | -1) =>
    Math.abs(y(w)) <= c.tMaxHeight && x(w) * side >= c.tMinOut;
  if (out(RW, 1) && out(LW, -1)) return 't-pose';

  // Cross: each wrist past the body's center line to the other side, in front of the chest
  const chest = (w: number) => y(w) >= c.crossTop && y(w) <= c.crossBottom;
  if (x(RW) <= -c.crossPast && x(LW) >= c.crossPast && chest(RW) && chest(LW)) return 'cross';
  return null;
}
