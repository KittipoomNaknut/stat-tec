import { gestureConfig } from '../config/gestures';
import type { TargetRegistry } from '../input/targets';
import type { CursorState } from './cursor';

export type DwellEvent =
  { type: 'dwell'; targetId: string; progress: number } | { type: 'select'; targetId: string };

/**
 * Hover-to-click: keeping the cursor on a target for `holdMs` selects it. Brief slips off the
 * target (< `graceMs`) are forgiven; a selected target rests for `cooldownMs`.
 * Emits progress 0 when a dwell is abandoned so the UI can clear its ring.
 */
export class DwellDetector {
  readonly #config: typeof gestureConfig.dwell;
  #target: string | null = null;
  #start = 0;
  #lastOn = 0;
  readonly #cooldownUntil = new Map<string, number>();
  /** Targets shown last update. */
  #known = new Set<string>();
  /**
   * Targets that appeared under the cursor: not selectable until the cursor leaves them once.
   * Otherwise a button popping up under a hand still raised from the last choice selects itself
   * (found by the E2E test, research 014).
   */
  readonly #disarmed = new Set<string>();

  constructor(config: typeof gestureConfig.dwell = gestureConfig.dwell) {
    this.#config = config;
  }

  update(cursor: CursorState, targets: TargetRegistry, tMs: number): DwellEvent[] {
    const c = this.#config;
    this.#arm(cursor, targets);
    const raw = cursor.visible ? targets.hitTest(cursor.x, cursor.y, c.padding) : null;
    const hit = raw !== null && this.#disarmed.has(raw) ? null : raw;
    const resting = hit !== null && (this.#cooldownUntil.get(hit) ?? 0) > tMs;
    const events: DwellEvent[] = [];

    if (hit !== null && !resting) {
      if (hit !== this.#target) {
        if (this.#target !== null) events.push(this.#abandon());
        this.#target = hit;
        this.#start = tMs;
      }
      this.#lastOn = tMs;
      const progress = Math.min((tMs - this.#start) / c.holdMs, 1);
      events.push({ type: 'dwell', targetId: hit, progress });
      if (progress >= 1) {
        events.push({ type: 'select', targetId: hit });
        this.#cooldownUntil.set(hit, tMs + c.cooldownMs);
        this.#target = null;
      }
    } else if (this.#target !== null && tMs - this.#lastOn > c.graceMs) {
      events.push(this.#abandon());
    }
    return events;
  }

  #arm(cursor: CursorState, targets: TargetRegistry): void {
    const shown = new Set(targets.visibleIds());
    for (const id of shown) {
      if (!this.#known.has(id) && cursor.visible && this.#under(cursor, targets, id)) {
        this.#disarmed.add(id);
      }
    }
    for (const id of this.#disarmed) {
      if (!shown.has(id) || !cursor.visible || !this.#under(cursor, targets, id)) {
        this.#disarmed.delete(id);
      }
    }
    this.#known = shown;
  }

  #under(cursor: CursorState, targets: TargetRegistry, id: string): boolean {
    const r = targets.rectOf(id);
    const p = this.#config.padding;
    return (
      r !== null &&
      cursor.x >= r.x - p &&
      cursor.x <= r.x + r.w + p &&
      cursor.y >= r.y - p &&
      cursor.y <= r.y + r.h + p
    );
  }

  #abandon(): DwellEvent {
    const targetId = this.#target ?? '';
    this.#target = null;
    return { type: 'dwell', targetId, progress: 0 };
  }
}
