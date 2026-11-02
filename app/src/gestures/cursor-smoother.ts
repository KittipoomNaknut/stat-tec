import { gestureConfig } from '../config/gestures';
import type { CursorState } from './cursor';

export type CursorSmoothing = typeof gestureConfig.smoothing;

/**
 * Screen-space smoothing for the cursor (research 015). The wrist→screen mapping amplifies
 * landmark noise ~7× (1 camera px ≈ 6.7 screen px), so the cursor needs its own filter:
 * a 2D One Euro filter (cutoff rises with the speed *magnitude*, so diagonal moves behave like
 * straight ones) followed by a soft deadband that swallows the last pixels of tremor while
 * holding on a button.
 */
export class CursorSmoother {
  readonly #c: CursorSmoothing;
  #last = -1;
  #x = 0;
  #y = 0;
  #dx = 0;
  #dy = 0;
  /** Deadband anchor. */
  #ax = 0;
  #ay = 0;

  constructor(config: CursorSmoothing = gestureConfig.smoothing) {
    this.#c = config;
  }

  update(cursor: CursorState, tMs: number): CursorState {
    if (!cursor.visible) {
      this.#last = -1;
      return cursor;
    }
    if (this.#last < 0 || tMs <= this.#last) {
      this.#last = tMs;
      this.#x = this.#ax = cursor.x;
      this.#y = this.#ay = cursor.y;
      this.#dx = this.#dy = 0;
      return cursor;
    }
    const dt = (tMs - this.#last) / 1000;
    this.#last = tMs;
    const { minCutoff, beta, dCutoff, deadband } = this.#c;
    const ad = alpha(dCutoff, dt);
    this.#dx += ((cursor.x - this.#x) / dt - this.#dx) * ad;
    this.#dy += ((cursor.y - this.#y) / dt - this.#dy) * ad;
    const a = alpha(minCutoff + beta * Math.hypot(this.#dx, this.#dy), dt);
    this.#x += (cursor.x - this.#x) * a;
    this.#y += (cursor.y - this.#y) * a;

    const ox = this.#x - this.#ax;
    const oy = this.#y - this.#ay;
    const d = Math.hypot(ox, oy);
    if (d > deadband) {
      const k = (d - deadband) / d;
      this.#ax += ox * k;
      this.#ay += oy * k;
    }
    return { ...cursor, x: this.#ax, y: this.#ay };
  }
}

function alpha(cutoffHz: number, dtSeconds: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoffHz) / dtSeconds);
}
