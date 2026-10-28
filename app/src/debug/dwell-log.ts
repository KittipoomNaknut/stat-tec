import type { IntentBus } from '../input/intent-bus';
import type { IntentOf } from '../input/intents';
import type { Rect, TargetRegistry } from '../input/targets';

export type AttemptOutcome = 'selected' | 'left-target' | 'cursor-hidden' | 'passed-by';

export interface DwellAttempt {
  targetId: string;
  /** Intent times (ms). */
  start: number;
  end: number;
  /** Highest dwell progress reached, 0..1. */
  maxProgress: number;
  outcome: AttemptOutcome;
  /**
   * Where the cursor was when it first broke off the target: hidden, or how far outside the
   * target's rect (screen units). `null` for selections.
   */
  breakOff: { visible: boolean; outside: number } | null;
}

/**
 * Research 010: records every dwell attempt in the playground and why it ended. Attempts that
 * never reach `passByProgress` count as passing over a button, not as failures.
 */
export class DwellAttemptLog {
  readonly attempts: DwellAttempt[] = [];
  readonly #targets: TargetRegistry;
  readonly #passByProgress: number;
  #active: Omit<DwellAttempt, 'end' | 'outcome'> | null = null;
  #onChange: () => void = () => undefined;

  constructor(bus: IntentBus, targets: TargetRegistry, passByProgress = 0.25) {
    this.#targets = targets;
    this.#passByProgress = passByProgress;
    bus.on('cursor', (c) => {
      this.#onCursor(c);
    });
    bus.on('dwell', (d) => {
      this.#onDwell(d);
    });
    bus.on('select', (s) => {
      if (this.#active?.targetId === s.targetId) this.#close('selected', s.t);
    });
  }

  /** Called after every finished attempt (for a live summary). */
  onChange(listener: () => void): void {
    this.#onChange = listener;
  }

  summary(): Record<AttemptOutcome, number> {
    const counts: Record<AttemptOutcome, number> = {
      selected: 0,
      'left-target': 0,
      'cursor-hidden': 0,
      'passed-by': 0,
    };
    for (const a of this.attempts) counts[a.outcome]++;
    return counts;
  }

  #onDwell(d: IntentOf<'dwell'>): void {
    if (d.progress > 0) {
      if (this.#active && this.#active.targetId !== d.targetId) this.#closeAsFailure(d.t);
      this.#active ??= { targetId: d.targetId, start: d.t, maxProgress: 0, breakOff: null };
      this.#active.maxProgress = Math.max(this.#active.maxProgress, d.progress);
    } else if (this.#active?.targetId === d.targetId) {
      this.#closeAsFailure(d.t);
    }
  }

  #onCursor(c: IntentOf<'cursor'>): void {
    const a = this.#active;
    if (!a) return;
    const rect = this.#rect(a.targetId);
    const outside = c.visible && rect ? distanceOutside(rect, c.x, c.y) : 0;
    const onTarget = c.visible && outside === 0;
    if (onTarget) a.breakOff = null;
    else a.breakOff ??= { visible: c.visible, outside };
  }

  #closeAsFailure(t: number): void {
    const a = this.#active;
    if (!a) return;
    if (a.maxProgress < this.#passByProgress) this.#close('passed-by', t);
    else this.#close(a.breakOff && !a.breakOff.visible ? 'cursor-hidden' : 'left-target', t);
  }

  #close(outcome: AttemptOutcome, t: number): void {
    const a = this.#active;
    if (!a) return;
    this.attempts.push({
      targetId: a.targetId,
      start: a.start,
      end: t,
      maxProgress: a.maxProgress,
      outcome,
      breakOff: outcome === 'selected' ? null : a.breakOff,
    });
    this.#active = null;
    this.#onChange();
  }

  #rect(id: string): Rect | null {
    return this.#targets.rectOf(id);
  }
}

/** 0 inside the rect, otherwise the distance to its nearest edge (screen units). */
export function distanceOutside(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}
