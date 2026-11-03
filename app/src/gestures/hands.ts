import { gestureConfig } from '../config/gestures';
import { Landmark } from '../perception/landmarks';
import { LANDMARK_STRIDE } from '../perception/protocol';

export interface HandsState {
  count: 0 | 1 | 2;
  /** −1..1: raised hands to the player's left … right. */
  x: number;
  /** −1..1: raised hands low … high. */
  y: number;
  /** 0..1 with both hands up (together … wide apart), else null. */
  spread: number | null;
}

/**
 * Raised hands as a joystick for a 3D chart (research 030): move them sideways to turn, up and
 * down to tilt, spread them apart to zoom in. Reads body space, so a child and an adult get the
 * same range. Raw values; the scene smooths what it drives.
 */
export class HandsDetector {
  readonly #c: typeof gestureConfig.hands;

  constructor(config: typeof gestureConfig.hands = gestureConfig.hands) {
    this.#c = config;
  }

  update(body: Float32Array | null): HandsState | null {
    if (!body) return null;
    const c = this.#c;
    const hipY = (at(body, Landmark.LEFT_HIP, 1) + at(body, Landmark.RIGHT_HIP, 1)) / 2;
    const hands: { x: number; y: number; side: 1 | -1 }[] = [];
    for (const [i, side] of [
      [Landmark.RIGHT_WRIST, 1],
      [Landmark.LEFT_WRIST, -1],
    ] as const) {
      const y = at(body, i, 1);
      if (at(body, i, 3) < c.minVisibility || hipY - y < c.raisedAbove) continue;
      hands.push({ x: at(body, i, 0), y, side });
    }
    const count = hands.length as 0 | 1 | 2;
    if (count === 0) return { count, x: 0, y: 0, spread: null };
    const mean = (f: (h: (typeof hands)[number]) => number) =>
      hands.reduce((s, h) => s + f(h), 0) / count;
    const x = clamp(mean((h) => h.x - h.side * c.restOut) / c.reach);
    const y = clamp((c.levelY - mean((h) => h.y)) / c.rise);
    const [a, b] = hands;
    const spread =
      a && b
        ? Math.min(
            1,
            Math.max(0, (Math.abs(a.x - b.x) - c.spreadMin) / (c.spreadMax - c.spreadMin)),
          )
        : null;
    return { count, x, y, spread };
  }
}

function at(body: Float32Array, i: number, k: number): number {
  return body[i * LANDMARK_STRIDE + k] ?? 0;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
