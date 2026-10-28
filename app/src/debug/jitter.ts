import { RollingWindow } from '../core/rolling-stats';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../perception/protocol';

const WINDOW = 120;
const MIN_VISIBILITY = 0.5;
/** Nose, shoulders, wrists: what the gestures will depend on. */
const JITTER_LANDMARKS = [0, 11, 12, 15, 16] as const;

/** Mean frame-to-frame movement (source pixels) of key landmarks; equals jitter when still. */
export class JitterMeter {
  readonly #window: RollingWindow;
  readonly #prev = new Float64Array(JITTER_LANDMARKS.length * 2);
  #hasPrev = false;

  constructor(capacity = WINDOW) {
    this.#window = new RollingWindow(capacity);
  }

  reset(): void {
    this.#hasPrev = false;
  }

  mean(): number {
    return this.#window.mean();
  }

  /** Reads pose `pose` of `data`. */
  add(data: Float32Array, width: number, height: number, pose = 0): void {
    const base = pose * LANDMARK_COUNT * LANDMARK_STRIDE;
    let sum = 0;
    let visible = true;
    for (let k = 0; k < JITTER_LANDMARKS.length; k++) {
      const i = base + (JITTER_LANDMARKS[k] ?? 0) * LANDMARK_STRIDE;
      if ((data[i + 3] ?? 0) < MIN_VISIBILITY) visible = false;
      const x = (data[i] ?? 0) * width;
      const y = (data[i + 1] ?? 0) * height;
      sum += Math.hypot(x - (this.#prev[k * 2] ?? 0), y - (this.#prev[k * 2 + 1] ?? 0));
      this.#prev[k * 2] = x;
      this.#prev[k * 2 + 1] = y;
    }
    if (this.#hasPrev && visible) this.#window.push(sum / JITTER_LANDMARKS.length);
    this.#hasPrev = true;
  }
}
