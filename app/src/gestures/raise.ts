import { gestureConfig } from '../config/gestures';
import type { Hand } from '../input/intents';
import { Landmark } from '../perception/landmarks';
import { LANDMARK_STRIDE } from '../perception/protocol';

export interface RaiseState {
  /** 0 = hands down, 1 = a hand overhead. */
  level: number;
  hand: Hand | 'both';
}

/**
 * How high the player holds their higher hand, as a smooth 0..1 level (EPISODE II: price up and
 * down). Measured from the hips in body space, so it is the same for a child and an adult.
 */
export class RaiseDetector {
  readonly #c: typeof gestureConfig.raise;
  #level = 0;
  #last = -1;

  constructor(config: typeof gestureConfig.raise = gestureConfig.raise) {
    this.#c = config;
  }

  /** `body` in body space, or `null` without a player (the level holds). */
  update(body: Float32Array | null, tMs: number): RaiseState | null {
    if (!body) {
      this.#last = -1;
      return null;
    }
    const hipY = (y(body, Landmark.LEFT_HIP) + y(body, Landmark.RIGHT_HIP)) / 2;
    const above = (i: number) =>
      vis(body, i) >= this.#c.minVisibility ? hipY - y(body, i) : -Infinity;
    const right = above(Landmark.RIGHT_WRIST);
    const left = above(Landmark.LEFT_WRIST);
    const top = Math.max(right, left);
    if (!Number.isFinite(top)) return null;
    const target = clamp01((top - this.#c.lowAbove) / (this.#c.highAbove - this.#c.lowAbove));
    if (this.#last < 0) {
      this.#level = target;
    } else {
      const k = 1 - Math.exp(-(tMs - this.#last) / this.#c.smoothingMs);
      this.#level += (target - this.#level) * k;
    }
    this.#last = tMs;
    const hand: Hand | 'both' =
      Math.abs(right - left) < 0.3 ? 'both' : right > left ? 'right' : 'left';
    return { level: this.#level, hand };
  }
}

function y(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 1] ?? 0;
}

function vis(body: Float32Array, i: number): number {
  return body[i * LANDMARK_STRIDE + 3] ?? 0;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
