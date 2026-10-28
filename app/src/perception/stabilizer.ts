import { stabilityConfig } from '../config/tracking';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

/**
 * Stops landmarks flickering on and off. Recordings showed the non-pointing arm and the hips
 * crossing visibility 0.5 up to 76 times per clip while their positions were fine.
 *
 * - smooths each landmark's visibility over time (written back into the visibility channel)
 * - decides shown/hidden with hysteresis (`showAt` / `hideBelow`)
 * - while the model is unsure of a landmark, holds its last confident position briefly
 *   instead of using the model's jumpy guess
 */
export class LandmarkStabilizer {
  readonly #config: typeof stabilityConfig;
  readonly #visibility = new Float32Array(LANDMARK_COUNT);
  readonly #shown = new Uint8Array(LANDMARK_COUNT);
  readonly #held = new Float32Array(LANDMARK_COUNT * 3);
  readonly #heldAt = new Float64Array(LANDMARK_COUNT).fill(-Infinity);
  #lastT = -1;

  constructor(config: typeof stabilityConfig = stabilityConfig) {
    this.#config = config;
  }

  reset(): void {
    this.#lastT = -1;
    this.#shown.fill(0);
    this.#heldAt.fill(-Infinity);
  }

  /** Updates one pose (`LANDMARK_COUNT × LANDMARK_STRIDE`) in place; returns the shown mask. */
  apply(pose: Float32Array, tMs: number): Uint8Array {
    const c = this.#config;
    const first = this.#lastT < 0;
    const a = first ? 1 : 1 - Math.exp(-(tMs - this.#lastT) / c.visibilitySmoothingMs);
    this.#lastT = tMs;

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const k = i * LANDMARK_STRIDE;
      const raw = pose[k + 3] ?? 0;

      if (raw >= c.confidentAt) {
        this.#held.set(pose.subarray(k, k + 3), i * 3);
        this.#heldAt[i] = tMs;
      } else if (tMs - (this.#heldAt[i] ?? -Infinity) <= c.holdMs) {
        pose.set(this.#held.subarray(i * 3, i * 3 + 3), k);
      }

      const prev = this.#visibility[i] ?? 0;
      const v = prev + (raw - prev) * a;
      this.#visibility[i] = v;
      pose[k + 3] = v;

      if (this.#shown[i] && v < c.hideBelow) this.#shown[i] = 0;
      else if (!this.#shown[i] && v >= c.showAt) this.#shown[i] = 1;
    }
    return this.#shown.slice();
  }
}
