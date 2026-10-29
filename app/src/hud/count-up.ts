/** A number that glides to its target (expo-out), for profit counters. Frame-stepped. */
export class CountUp {
  #from = 0;
  #to = 0;
  #t = 1;
  readonly #durationMs: number;

  constructor(durationMs = 1600) {
    this.#durationMs = durationMs;
  }

  get target(): number {
    return this.#to;
  }

  set(value: number, animate = true): void {
    this.#from = animate ? this.value : value;
    this.#to = value;
    this.#t = animate ? 0 : 1;
  }

  get value(): number {
    const e = this.#t >= 1 ? 1 : 1 - 2 ** (-10 * this.#t);
    return this.#from + (this.#to - this.#from) * e;
  }

  get done(): boolean {
    return this.#t >= 1;
  }

  update(dtMs: number): void {
    this.#t = Math.min(1, this.#t + dtMs / this.#durationMs);
  }
}

const BAHT = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

export function baht(value: number): string {
  return `฿${BAHT.format(Math.round(value))}`;
}
