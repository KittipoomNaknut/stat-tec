import { cursorConfigFor } from '../config/gestures';
import type { IntentBus } from '../input/intent-bus';
import type { IntentSource } from '../input/intents';
import type { TargetRegistry } from '../input/targets';
import type { LockState } from '../perception/player-lock';
import type { PerceptionSource } from '../perception/protocol';
import { CursorTracker } from './cursor';
import { CursorSmoother } from './cursor-smoother';
import { DwellDetector } from './dwell';
import { RaiseDetector } from './raise';

/** What the engine needs from each perception frame. */
export interface GestureInput {
  lock: LockState;
  playerId: number;
  body: Float32Array | null;
}

/**
 * Turns tracked poses into intents: presence changes, cursor, dwell progress and selects.
 * Detectors for other gestures (raise, throw, slap, draw…) join here in later PRs.
 */
export class GestureEngine {
  readonly #bus: IntentBus;
  readonly #targets: TargetRegistry;
  readonly #source: IntentSource;
  #cursor = new CursorTracker(cursorConfigFor('server'));
  readonly #smoother = new CursorSmoother();
  readonly #dwell = new DwellDetector();
  readonly #raise = new RaiseDetector();
  #lock: LockState = 'searching';
  #playerId = 0;
  /** Lets the mouse take over without the body fighting it. */
  enabled = true;

  constructor(bus: IntentBus, targets: TargetRegistry, source: IntentSource = 'pose') {
    this.#bus = bus;
    this.#targets = targets;
    this.#source = source;
  }

  /** Use thresholds calibrated for the pose source actually in use. */
  setPoseSource(source: PerceptionSource): void {
    this.#cursor = new CursorTracker(cursorConfigFor(source));
  }

  update(input: GestureInput, tMs: number): void {
    const meta = { t: tMs, source: this.#source };
    this.#presence(input, meta);
    if (!this.enabled) return;

    const cursor = this.#smoother.update(
      this.#cursor.update(input.lock === 'locked' ? input.body : null, tMs),
      tMs,
    );
    this.#bus.emit({ type: 'cursor', ...cursor, ...meta });
    for (const event of this.#dwell.update(cursor, this.#targets, tMs)) {
      this.#bus.emit({ ...event, ...meta });
    }
    const raise = this.#raise.update(input.lock === 'locked' ? input.body : null, tMs);
    if (raise) this.#bus.emit({ type: 'raise', ...raise, ...meta });
  }

  #presence(input: GestureInput, meta: { t: number; source: IntentSource }): void {
    const prev = this.#lock;
    this.#lock = input.lock;
    if (input.lock === prev && input.playerId === this.#playerId) return;

    if (input.lock === 'locked' && input.playerId !== this.#playerId) {
      this.#bus.emit({ type: 'presence', state: 'enter', ...meta });
    } else if (input.lock === 'locked' && prev === 'lost') {
      this.#bus.emit({ type: 'presence', state: 'return', ...meta });
    } else if (input.lock === 'lost' && prev === 'locked') {
      this.#bus.emit({ type: 'presence', state: 'lost', ...meta });
    } else if (input.lock === 'searching' && prev === 'lost') {
      this.#bus.emit({ type: 'presence', state: 'leave', ...meta });
    }
    this.#playerId = input.playerId;
  }
}
