/**
 * EPISODE V — "พยากรณ์ 11.11": three years of monthly sales, the forecast the AI builds from them
 * (trend × seasonality, with an uncertainty band), the year that actually happens, and the
 * 11.11 stock order. Months run November to October so each "year" starts with the festival and
 * the forecast's first month is the one that matters most. Every number on screen comes from
 * here (research 021).
 */

/** Months of history and of forecast. */
export const HISTORY = 36;
export const AHEAD = 12;
/** Calendar labels, starting from November (index 0 of each year block). */
export const MONTHS = [
  'พ.ย.',
  'ธ.ค.',
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
] as const;
/** The history starts November 2023; the forecast covers November 2026 – October 2027. */
export const FIRST_YEAR = 2023;

/**
 * Seasonal multipliers by month (Nov first): 11.11 and 12.12 spikes, a January lull, small
 * mid-year sales (6.6, 7.7). Hidden from the AI, which has to find them.
 */
const SEASON = [2.3, 1.55, 0.72, 0.8, 0.88, 0.92, 0.95, 1.05, 1.1, 0.9, 0.88, 0.95] as const;
/** Sales level (pieces per month) at the first month, and growth per month. */
const LEVEL = 9000;
const GROWTH = 120;
/** Month-to-month noise, as a share of the month's sales. */
const NOISE = 0.06;

/** Margin per piece sold, holding cost per piece left over, goodwill lost per piece short (฿). */
export const MONEY = { margin: 40, leftover: 25, short: 10 } as const;
/** One box in the warehouse holds this many pieces. */
export const BOX = 500;

export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function month(t: number, random: () => number): number {
  const base = (LEVEL + GROWTH * t) * (SEASON[t % 12] ?? 1);
  return Math.round(base * (1 + NOISE * gaussian(random)));
}

export interface Series {
  history: number[];
  /** What actually happens over the forecast months (hidden until the reveal). */
  actual: number[];
}

export function sales(seed = 11_11_2023): Series {
  const random = seeded(seed);
  const all = Array.from({ length: HISTORY + AHEAD }, (_, t) => month(t, random));
  return { history: all.slice(0, HISTORY), actual: all.slice(HISTORY) };
}

/** Least-squares line through the history: sales ≈ a + b·t. */
export interface Trend {
  a: number;
  b: number;
}

export function fitTrend(history: readonly number[]): Trend {
  const n = history.length;
  const mt = (n - 1) / 2;
  const my = history.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  history.forEach((v, t) => {
    sxy += (t - mt) * (v - my);
    sxx += (t - mt) ** 2;
  });
  const b = sxy / sxx;
  return { a: my - b * mt, b };
}

export const trendAt = (trend: Trend, t: number) => trend.a + trend.b * t;

/** Seasonal index per month: the average of sales ÷ trend over the years (folding the years). */
export function seasonality(history: readonly number[], trend: Trend): number[] {
  const sum = new Array<number>(12).fill(0);
  const count = new Array<number>(12).fill(0);
  history.forEach((v, t) => {
    const m = t % 12;
    sum[m] = (sum[m] ?? 0) + v / trendAt(trend, t);
    count[m] = (count[m] ?? 0) + 1;
  });
  return sum.map((s, m) => s / Math.max(1, count[m] ?? 1));
}

export interface Forecast {
  trend: Trend;
  season: number[];
  /** AI forecast per month ahead. */
  mean: number[];
  /** 90% band (pieces). */
  low: number[];
  high: number[];
}

/**
 * The AI's forecast: trend × seasonality, band from how far the history strays from its fit.
 * The 11.11 spike opens every year, so a line through the raw sales tilts too flat (research 021:
 * 10% low all year); the fit alternates: season from the trend, then the trend through the sales
 * with the season divided out, until it settles.
 */
export function forecast(history: readonly number[]): Forecast {
  let trend = fitTrend(history);
  let season = seasonality(history, trend);
  for (let pass = 0; pass < 4; pass++) {
    trend = fitTrend(history.map((v, t) => v / (season[t % 12] ?? 1)));
    season = seasonality(history, trend);
  }
  const ratios = history.map((v, t) => v / (trendAt(trend, t) * (season[t % 12] ?? 1)) - 1);
  const sd = Math.sqrt(ratios.reduce((s, r) => s + r * r, 0) / Math.max(1, ratios.length - 1));
  const mean = Array.from(
    { length: AHEAD },
    (_, j) => trendAt(trend, HISTORY + j) * (season[j % 12] ?? 1),
  );
  return {
    trend,
    season,
    mean,
    low: mean.map((v) => v * (1 - 1.645 * sd)),
    high: mean.map((v) => v * (1 + 1.645 * sd)),
  };
}

/**
 * Accuracy as 100 − mean absolute percentage error, clamped to 0..100. Months the player left
 * blank count as their nearest drawn neighbor (or the last history month when nothing is drawn).
 */
export function accuracy(guess: readonly number[], actual: readonly number[]): number {
  const n = Math.min(guess.length, actual.length);
  let err = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i] ?? 1;
    err += Math.abs((guess[i] ?? 0) - a) / a;
  }
  return Math.max(0, Math.min(100, 100 * (1 - err / Math.max(1, n))));
}

/** Fills months the player never drew: hold the nearest drawn value on either side. */
export function completeGuess(drawn: readonly (number | null)[], fallback: number): number[] {
  const out: number[] = [];
  const first = drawn.findIndex((v) => v !== null);
  let last = first >= 0 ? (drawn[first] ?? fallback) : fallback;
  for (let i = 0; i < AHEAD; i++) {
    const v = drawn[i];
    if (v !== null && v !== undefined) last = v;
    out.push(last);
  }
  return out;
}

export interface SaleDay {
  order: number;
  demand: number;
  sold: number;
  /** Demand that found empty shelves. */
  short: number;
  leftover: number;
  profit: number;
  /** Profit had the order matched demand exactly. */
  best: number;
}

export function saleDay(order: number, demand: number): SaleDay {
  const sold = Math.min(order, demand);
  const short = Math.max(0, demand - order);
  const leftover = Math.max(0, order - demand);
  const profit = sold * MONEY.margin - leftover * MONEY.leftover - short * MONEY.short;
  return { order, demand, sold, short, leftover, profit, best: demand * MONEY.margin };
}

/** Order size for a raise level 0..1: from half to 1.7× the AI's 11.11 forecast, in boxes. */
export function orderAt(level: number, aiNovember: number): number {
  const k = 0.5 + Math.min(1, Math.max(0, level)) * 1.2;
  return Math.max(BOX, Math.round((aiNovember * k) / BOX) * BOX);
}
