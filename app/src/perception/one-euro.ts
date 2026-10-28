export interface OneEuroParams {
  /** Cutoff (Hz) when still: lower = steadier but laggier at slow speeds. */
  minCutoff: number;
  /** How fast the cutoff rises with speed: higher = less lag on fast moves. */
  beta: number;
  /** Cutoff (Hz) for the speed estimate itself. */
  dCutoff: number;
}

/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012) over many independent channels.
 * Allocation-free after construction; filters in place.
 */
export class OneEuroFilterBank {
  params: OneEuroParams;
  readonly #value: Float64Array;
  readonly #speed: Float64Array;
  #lastT = -1;

  constructor(channels: number, params: OneEuroParams) {
    this.params = params;
    this.#value = new Float64Array(channels);
    this.#speed = new Float64Array(channels);
  }

  /** Forget history, e.g. when the tracked person changes. */
  reset(): void {
    this.#lastT = -1;
  }

  /**
   * Filters `values[i * stride + offset]` for each channel `i`, in place.
   * @param scale speeds are divided by this, so `beta` works in body units rather than image units
   */
  filter(values: Float32Array, tMs: number, stride = 1, offset = 0, scale = 1): void {
    const n = this.#value.length;
    if (this.#lastT < 0 || tMs <= this.#lastT) {
      for (let i = 0; i < n; i++) {
        this.#value[i] = values[i * stride + offset] ?? 0;
        this.#speed[i] = 0;
      }
      this.#lastT = tMs;
      return;
    }

    const dt = (tMs - this.#lastT) / 1000;
    this.#lastT = tMs;
    const { minCutoff, beta, dCutoff } = this.params;
    const aSpeed = alpha(dCutoff, dt);
    for (let i = 0; i < n; i++) {
      const k = i * stride + offset;
      const raw = values[k] ?? 0;
      const prev = this.#value[i] ?? raw;
      const speed = lerp(this.#speed[i] ?? 0, (raw - prev) / dt, aSpeed);
      const cutoff = minCutoff + beta * Math.abs(speed / scale);
      const filtered = lerp(prev, raw, alpha(cutoff, dt));
      this.#speed[i] = speed;
      this.#value[i] = filtered;
      values[k] = filtered;
    }
  }
}

function alpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
