import { gestureConfig } from '../config/gestures';
import type { CursorState } from './cursor';

export type SlapConfig = typeof gestureConfig.slap;

export interface SlapEvent {
  type: 'slap';
  x: number;
  y: number;
  /** Screen heights per second over the last `windowMs`. */
  speed: number;
}

/**
 * A fast sweep of the cursor (EPISODE IV: slap the fraud away). Built on the cursor rather than the
 * raw wrist so it hits exactly where the player sees their hand, and so the mouse (F2) and the
 * body behave the same. Speed is the displacement over a short window, not frame to frame: single
 * frames are too noisy (research 019). Starts above `startSpeed`, holds above `keepSpeed`, and
 * emits one event per update while active so a scene can hit-test the path between them.
 */
export class SlapDetector {
  readonly #c: SlapConfig;
  readonly #hist: { x: number; y: number; t: number; hand: string }[] = [];
  #active = false;

  constructor(config: SlapConfig = gestureConfig.slap) {
    this.#c = config;
  }

  update(cursor: CursorState, tMs: number): SlapEvent | null {
    const h = this.#hist;
    if (!cursor.visible || (h.length > 0 && h[h.length - 1]?.hand !== cursor.hand)) {
      h.length = 0;
      this.#active = false;
      if (!cursor.visible) return null;
    }
    h.push({ x: cursor.x, y: cursor.y, t: tMs, hand: cursor.hand });
    while (h.length > 1 && tMs - (h[0]?.t ?? tMs) > this.#c.windowMs) h.shift();
    const first = h[0];
    const dt = first ? (tMs - first.t) / 1000 : 0;
    if (!first || dt < this.#c.minSpanMs / 1000) return null;

    const speed = Math.hypot((cursor.x - first.x) * this.#c.aspect, cursor.y - first.y) / dt;
    this.#active = speed >= (this.#active ? this.#c.keepSpeed : this.#c.startSpeed);
    return this.#active ? { type: 'slap', x: cursor.x, y: cursor.y, speed } : null;
  }
}
