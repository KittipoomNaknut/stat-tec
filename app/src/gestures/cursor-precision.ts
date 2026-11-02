import { gestureConfig } from '../config/gestures';
import type { CursorState } from './cursor';

export type CursorPrecisionConfig = typeof gestureConfig.precision;

/**
 * Precision for a held hand (research 022): after smoothing, what is left while holding still
 * is slow drift — the arm swaying and the pose model wandering — which no frequency filter can
 * remove without lagging the cursor. Like PRISM (Frees et al. 2007), slow hand movement moves
 * the cursor only by a share of itself (`minGain`), rising to 1:1 at `fastSpeed`; the gap this
 * opens between the cursor and the hand closes quickly while the hand moves fast (where the eye
 * does not notice) and slowly otherwise, so it never builds up, and never exceeds `maxGap`.
 * Speeds are in screen heights per second over `windowMs`, with x scaled by the screen's aspect.
 * Drawing needs the pen exactly on the hand, so `enabled = false` passes the hand through.
 */
export class CursorPrecision {
  readonly #c: CursorPrecisionConfig;
  readonly #hist: { x: number; y: number; t: number }[] = [];
  #last = -1;
  /** Last hand position (input) and the cursor shown (output). */
  #inX = 0;
  #inY = 0;
  #x = 0;
  #y = 0;
  #hand = '';
  /** Off: the cursor is the hand (drawing). Turning it back on starts again on the hand. */
  enabled = true;

  constructor(config: CursorPrecisionConfig = gestureConfig.precision) {
    this.#c = config;
  }

  update(cursor: CursorState, tMs: number): CursorState {
    if (!cursor.visible || !this.enabled) {
      this.#last = -1;
      this.#hist.length = 0;
      return cursor;
    }
    const h = this.#hist;
    if (this.#last < 0 || tMs <= this.#last || cursor.hand !== this.#hand) {
      // Appearing (or switching hands): start right on the hand
      this.#last = tMs;
      this.#hand = cursor.hand;
      this.#x = this.#inX = cursor.x;
      this.#y = this.#inY = cursor.y;
      h.length = 0;
      h.push({ x: cursor.x, y: cursor.y, t: tMs });
      return cursor;
    }
    const c = this.#c;
    const dt = tMs - this.#last;
    this.#last = tMs;
    const dx = cursor.x - this.#inX;
    const dy = cursor.y - this.#inY;
    this.#inX = cursor.x;
    this.#inY = cursor.y;

    h.push({ x: cursor.x, y: cursor.y, t: tMs });
    while (h.length > 1 && tMs - (h[0]?.t ?? tMs) > c.windowMs) h.shift();
    const first = h[0] ?? { x: cursor.x, y: cursor.y, t: tMs };
    const span = (tMs - first.t) / 1000;
    const speed =
      span > 0 ? Math.hypot((cursor.x - first.x) * c.aspect, cursor.y - first.y) / span : 0;

    const k =
      speed <= c.slowSpeed
        ? c.minGain
        : speed >= c.fastSpeed
          ? 1
          : c.minGain + ((1 - c.minGain) * (speed - c.slowSpeed)) / (c.fastSpeed - c.slowSpeed);
    this.#x += dx * k;
    this.#y += dy * k;
    const pull = 1 - Math.exp(-dt / (speed >= c.fastSpeed ? c.recoverFastMs : c.recoverSlowMs));
    this.#x += (cursor.x - this.#x) * pull;
    this.#y += (cursor.y - this.#y) * pull;
    // Never trail the hand by more than `maxGap` (a slow steady drag is not drift)
    const gx = (this.#x - cursor.x) * c.aspect;
    const gy = this.#y - cursor.y;
    const gap = Math.hypot(gx, gy);
    if (gap > c.maxGap) {
      this.#x = cursor.x + (gx * c.maxGap) / gap / c.aspect;
      this.#y = cursor.y + (gy * c.maxGap) / gap;
    }
    this.#x = clamp01(this.#x);
    this.#y = clamp01(this.#y);
    return { ...cursor, x: this.#x, y: this.#y };
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
