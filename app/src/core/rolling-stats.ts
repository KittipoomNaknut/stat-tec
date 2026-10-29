/** Fixed-size window of recent samples; no allocation when pushing. */
export class RollingWindow {
  readonly #values: Float64Array;
  #next = 0;
  #count = 0;

  constructor(capacity: number) {
    this.#values = new Float64Array(capacity);
  }

  get count(): number {
    return this.#count;
  }

  push(value: number): void {
    this.#values[this.#next] = value;
    this.#next = (this.#next + 1) % this.#values.length;
    this.#count = Math.min(this.#count + 1, this.#values.length);
  }

  clear(): void {
    this.#next = 0;
    this.#count = 0;
  }

  mean(): number {
    if (this.#count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.#count; i++) sum += this.#values[i] ?? 0;
    return sum / this.#count;
  }

  /** Nearest-rank percentile, `p` in [0, 100]. Allocates; meant for periodic readouts. */
  percentile(p: number): number {
    if (this.#count === 0) return 0;
    const sorted = this.#values.slice(0, this.#count).sort();
    const rank = Math.ceil((p / 100) * this.#count) - 1;
    return sorted[Math.min(Math.max(rank, 0), this.#count - 1)] ?? 0;
  }
}

/** Events per second over the most recent `capacity` events; no allocation when ticking. */
export class RateMeter {
  readonly #stamps: Float64Array;
  #seen = 0;

  constructor(capacity: number) {
    this.#stamps = new Float64Array(capacity);
  }

  tick(timeMs: number): void {
    this.#stamps[this.#seen % this.#stamps.length] = timeMs;
    this.#seen++;
  }

  /** Rate at `nowMs`; drops to 0 once events stop for longer than the window spans. */
  rate(nowMs: number): number {
    const capacity = this.#stamps.length;
    const events = Math.min(this.#seen, capacity);
    if (events < 2) return 0;
    const first = this.#stamps[this.#seen > capacity ? this.#seen % capacity : 0] ?? 0;
    const last = this.#stamps[(this.#seen - 1) % capacity] ?? 0;
    const span = last - first;
    if (span <= 0 || nowMs - last > span) return 0;
    return ((events - 1) * 1000) / span;
  }
}
