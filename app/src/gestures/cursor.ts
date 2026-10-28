import { gestureConfig, type CursorConfig } from '../config/gestures';
import type { Hand } from '../input/intents';
import { Landmark } from '../perception/landmarks';
import { LANDMARK_STRIDE } from '../perception/protocol';

export interface CursorState {
  visible: boolean;
  hand: Hand;
  /** Screen position in [0, 1]. */
  x: number;
  y: number;
}

const HANDS = {
  right: {
    wrist: Landmark.RIGHT_WRIST,
    elbow: Landmark.RIGHT_ELBOW,
    shoulder: Landmark.RIGHT_SHOULDER,
  },
  left: {
    wrist: Landmark.LEFT_WRIST,
    elbow: Landmark.LEFT_ELBOW,
    shoulder: Landmark.LEFT_SHOULDER,
  },
} as const;

/**
 * Maps the pointing hand to a screen position. A hand counts as pointing only while raised
 * above the waist with the arm extended, so touching the face or scratching the head does not
 * move the cursor. Stays on the current hand while it keeps pointing (no flicker between hands).
 */
export class CursorTracker {
  readonly #config: CursorConfig;
  #hand: Hand | null = null;
  /** Hand that started pointing but has not held long enough yet, and since when. */
  #pending: { hand: Hand; since: number } | null = null;
  #state: CursorState = { visible: false, hand: 'right', x: 0.5, y: 0.5 };

  constructor(config: CursorConfig = gestureConfig.cursor) {
    this.#config = config;
  }

  /** `body` is the player in body space, or `null` when no player is visible. */
  update(body: Float32Array | null, tMs: number): CursorState {
    if (!body) {
      this.#hand = null;
      this.#pending = null;
      return this.#hide();
    }

    if (this.#hand && !this.#pointing(body, this.#hand, false)) this.#hand = null;
    if (!this.#hand) {
      const candidates = (['right', 'left'] as const).filter((h) => this.#pointing(body, h, true));
      // Prefer the higher hand when both point.
      candidates.sort((a, b) => y(body, HANDS[a].wrist) - y(body, HANDS[b].wrist));
      const hand = candidates[0];
      if (!hand) {
        this.#pending = null;
      } else if (this.#pending?.hand !== hand) {
        this.#pending = { hand, since: tMs };
      } else if (tMs - this.#pending.since >= this.#config.activateAfterMs) {
        this.#hand = hand;
        this.#pending = null;
      }
    }
    if (!this.#hand) return this.#hide();

    const { box } = this.#config;
    const mirror = this.#hand === 'left' ? -1 : 1;
    const wx = x(body, HANDS[this.#hand].wrist) * mirror;
    let sx = (wx - box.x0) / (box.x1 - box.x0);
    if (mirror < 0) sx = 1 - sx;
    const sy = (y(body, HANDS[this.#hand].wrist) - box.y0) / (box.y1 - box.y0);
    this.#state = { visible: true, hand: this.#hand, x: clamp01(sx), y: clamp01(sy) };
    return this.#state;
  }

  #pointing(body: Float32Array, hand: Hand, activating: boolean): boolean {
    const c = this.#config;
    const { wrist, elbow, shoulder } = HANDS[hand];
    if (vis(body, wrist) < c.minVisibility) return false;
    const hipY = (y(body, Landmark.LEFT_HIP) + y(body, Landmark.RIGHT_HIP)) / 2;
    const above = hipY - y(body, wrist);
    const extension = dist(body, wrist, shoulder);
    // Straight arm: shoulder–wrist distance over the arm's length along the elbow. Unchanged by
    // pointing toward the camera (a straight arm stays a straight line); low for crossed arms.
    const elbowSeen = vis(body, elbow) >= c.minVisibility;
    const straightness = elbowSeen
      ? extension / Math.max(dist(body, shoulder, elbow) + dist(body, elbow, wrist), 1e-6)
      : null;
    return activating
      ? above >= c.activateAboveHips &&
          extension >= c.activateExtension &&
          straightness !== null &&
          straightness >= c.activateStraightness
      : (c.keepWhileAboveHips !== null && above >= c.keepWhileAboveHips) ||
          (above >= c.releaseAboveHips &&
            (straightness === null || straightness >= c.releaseStraightness) &&
            (extension >= c.deactivateExtension ||
              // Pointing straight at the camera: the arm looks short but stays a straight line.
              (straightness !== null &&
                straightness >= c.foreshortenedStraightness &&
                extension >= c.foreshortenedMinExtension)));
  }

  #hide(): CursorState {
    this.#state = { ...this.#state, visible: false };
    return this.#state;
  }
}

function x(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE] ?? 0;
}

function y(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 1] ?? 0;
}

function vis(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 3] ?? 0;
}

function dist(body: Float32Array, a: number, b: number): number {
  return Math.hypot(x(body, a) - x(body, b), y(body, a) - y(body, b));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
