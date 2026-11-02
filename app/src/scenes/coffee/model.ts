/**
 * "Data Café" (EPISODE II): the demand data behind the coffee chapter, and the regression the
 * AI runs on it. Everything shown on screen is computed here — the fitted line, every attempt
 * of the search and its error, the revenue curve and its peak — nothing is hand-drawn.
 */

export interface Day {
  /** Price per cup that day (฿). */
  price: number;
  /** Cups sold that day. */
  cups: number;
}

export interface Line {
  /** cups = intercept + slope × price */
  intercept: number;
  slope: number;
}

/** True demand the café faces (unknown to the player): about 4 fewer cups per extra baht. */
export const TRUE_DEMAND: Line = { intercept: 520, slope: -3.6 };
export const PRICE_RANGE = { min: 30, max: 120 } as const;
export const START_PRICE = 60;

/** Deterministic pseudo-random numbers (Park–Miller), so every visitor sees the same data. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Thirteen past days at varied prices, with day-to-day noise (weather, holidays…). */
export function pastDays(seed = 20261111): Day[] {
  const random = seeded(seed);
  const prices = [40, 45, 50, 55, 60, 65, 70, 80, 85, 90, 100, 105, 110];
  return prices.map((price) => {
    // Sum of uniforms ≈ normal, σ ≈ 17 cups
    const noise = (random() + random() + random() - 1.5) * 34;
    return { price, cups: Math.round(cupsAt(TRUE_DEMAND, price) + noise) };
  });
}

export function cupsAt(line: Line, price: number): number {
  return Math.max(0, line.intercept + line.slope * price);
}

/** Sum of squared errors: how far the line misses every day, squared and added up. */
export function sse(line: Line, days: readonly Day[]): number {
  return days.reduce((sum, d) => sum + (d.cups - (line.intercept + line.slope * d.price)) ** 2, 0);
}

/** Ordinary least squares: the line with the smallest possible SSE. */
export function fit(days: readonly Day[]): Line {
  const n = days.length;
  const mx = days.reduce((s, d) => s + d.price, 0) / n;
  const my = days.reduce((s, d) => s + d.cups, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const d of days) {
    sxy += (d.price - mx) * (d.cups - my);
    sxx += (d.price - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

export interface Attempt {
  line: Line;
  sse: number;
}

/**
 * How the AI searches for the line: gradient descent from a flat guess at the average,
 * on centered prices (so slope and level learn at the same pace). Returns a few attempts
 * spaced so each one visibly improves, ending exactly on the least-squares line.
 */
export function searchAttempts(days: readonly Day[], shown = 6): Attempt[] {
  const n = days.length;
  const mx = days.reduce((s, d) => s + d.price, 0) / n;
  const my = days.reduce((s, d) => s + d.cups, 0) / n;
  // Model in centered form: cups = level + slope × (price − mx)
  let level = my * 0.55; // a poor first guess: too low and flat
  let slope = 0;
  const vx = days.reduce((s, d) => s + (d.price - mx) ** 2, 0) / n;
  const rate = 0.35;
  const steps: Attempt[] = [];
  for (let i = 0; i < 40; i++) {
    const line = { intercept: level - slope * mx, slope };
    steps.push({ line, sse: sse(line, days) });
    let gLevel = 0;
    let gSlope = 0;
    for (const d of days) {
      const err = level + slope * (d.price - mx) - d.cups;
      gLevel += err / n;
      gSlope += (err * (d.price - mx)) / n;
    }
    level -= rate * gLevel;
    slope -= (rate * gSlope) / vx;
  }
  // Pick attempts on a log scale of steps: big jumps first, fine-tuning last.
  const best = fit(days);
  const picks = [0, 1, 2, 4, 8, 16].slice(0, shown - 1).map((i) => steps[i] ?? steps[0]);
  return [
    ...picks.filter((p): p is Attempt => p !== undefined),
    { line: best, sse: sse(best, days) },
  ];
}

/** Revenue per day at a price, under a demand line. */
export function revenueAt(line: Line, price: number): number {
  return price * cupsAt(line, price);
}

/** The price that maximizes revenue: p × (a + b·p) peaks at p = −a / 2b. */
export function bestPrice(line: Line): number {
  const p = -line.intercept / (2 * line.slope);
  return Math.min(PRICE_RANGE.max, Math.max(PRICE_RANGE.min, Math.round(p)));
}
