import type { IntentBus } from '../input/intent-bus';
import type { IntentSource } from '../input/intents';
import type { TargetRegistry } from '../input/targets';
import type { LockState } from '../perception/player-lock';
import { CursorTracker } from './cursor';
import { DwellDetector } from './dwell';

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
  readonly #cursor = new CursorTracker();
  readonly #dwell = new DwellDetector();
  #lock: LockState = 'searching';
  #playerId = 0;
  /** Lets the mouse take over without the body fighting it. */
  enabled = true;

  constructor(bus: IntentBus, targets: TargetRegistry, source: IntentSource = 'pose') {
    this.#bus = bus;
    this.#targets = targets;
    this.#source = source;
  }

  update(input: GestureInput, tMs: number): void {
    const meta = { t: tMs, source: this.#source };
    this.#presence(input, meta);
    if (!this.enabled) return;

    const cursor = this.#cursor.update(input.lock === 'locked' ? input.body : null, tMs);
    this.#bus.emit({ type: 'cursor', ...cursor, ...meta });
    for (const event of this.#dwell.update(cursor, this.#targets, tMs)) {
      this.#bus.emit({ ...event, ...meta });
    }
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
