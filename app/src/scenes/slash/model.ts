/**
 * EP II — "ศึก 11.11 ฟันป้ายราคา" (Dynamic Pricing). Demand is EP I's line with its intercept
 * scaled by how busy the shop is: cups = 520·busy − 3.6·price. A busier hour moves the best
 * price up, which is the whole point of pricing by the hour. Tag colors and every profit shown
 * come from here.
 */
import { TRUE_DEMAND } from '../coffee/model';
/** Cost to make one cup (฿): the margin is price − cost. */
export const CUP_COST = 25;

/** Price tags fly with prices in this range (฿). */
export const TAG_RANGE = { min: 9, max: 220 } as const;
/** A tag is gold when its profit is at least this share of the best at that moment. */
export const GOLD_SHARE = 0.75;
/** Profit of one slashed tag = profit per hour at that price ÷ this (one batch of customers). */
export const BATCH = 12;

export function cups(price: number, busy: number): number {
  return Math.max(0, TRUE_DEMAND.intercept * busy + TRUE_DEMAND.slope * price);
}

export function profit(price: number, busy: number): number {
  return (price - CUP_COST) * cups(price, busy);
}

/** The price with the most profit when the shop is this busy: d/dp (p − c)(A − b p) = 0. */
export function bestPrice(busy: number): number {
  const b = -TRUE_DEMAND.slope;
  return (TRUE_DEMAND.intercept * busy) / b / 2 + CUP_COST / 2;
}

/** The price at which nobody buys any more. */
export function chokePrice(busy: number): number {
  return (TRUE_DEMAND.intercept * busy) / -TRUE_DEMAND.slope;
}

/** Prices whose profit is at least `GOLD_SHARE` of the best (a band around the best price). */
export function goldBand(busy: number): { low: number; high: number } {
  const b = -TRUE_DEMAND.slope;
  const best = bestPrice(busy);
  // profit(p) = b (p − c)(choke − p) is a parabola: share s of the peak lies within
  // ±half·√(1 − s) of the best, half = (choke − c) / 2
  const choke = (TRUE_DEMAND.intercept * busy) / b;
  const half = ((choke - CUP_COST) / 2) * Math.sqrt(1 - GOLD_SHARE);
  return { low: best - half, high: best + half };
}

export type TagKind = 'gold' | 'loss' | 'pricey' | 'cheap';

/**
 * Gold: near the best now · loss: at or below cost · pricey: so dear customers walk away ·
 * cheap: profitable but leaves money on the table (`tagPrice` never makes these, so a tag is
 * always one of the three colors the player is taught).
 */
export function classify(price: number, busy: number): TagKind {
  if (price <= CUP_COST) return 'loss';
  const { low, high } = goldBand(busy);
  if (price >= low && price <= high) return 'gold';
  return price > high ? 'pricey' : 'cheap';
}

/**
 * How busy the shop is through the 20 s of play (0..1 of play time): a calm start, the 11.11
 * flash-sale rush in the middle, then calm again.
 */
export function busyAt(t: number): number {
  const rush = Math.exp(-(((t - 0.55) / 0.16) ** 2));
  return 0.7 + 0.6 * rush;
}

/** Opening hours shown in the reveal. */
export const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i);

/** Customers by hour on 11.11 (busy factor): morning coffee, lunch, and the 20:00 flash sale. */
export function busyByHour(hour: number): number {
  const bump = (h: number, w: number, a: number) => a * Math.exp(-(((hour - h) / w) ** 2));
  return 0.55 + bump(8, 1.2, 0.45) + bump(12.5, 1.2, 0.35) + bump(20, 1.1, 1.0);
}

export interface DayPlan {
  /** Price per hour. */
  prices: number[];
  profit: number;
}

/** The AI: the best price for each hour's crowd. */
export function dynamicPlan(): DayPlan {
  const prices = HOURS.map((h) => Math.round(bestPrice(busyByHour(h))));
  return {
    prices,
    profit: HOURS.reduce((s, h, i) => s + profit(prices[i] ?? 0, busyByHour(h)), 0),
  };
}

/** One price all day: the best single price (searched in whole baht). */
export function flatPlan(): DayPlan {
  let best = { price: 0, profit: -Infinity };
  for (let p = CUP_COST; p <= TAG_RANGE.max; p++) {
    const total = HOURS.reduce((s, h) => s + profit(p, busyByHour(h)), 0);
    if (total > best.profit) best = { price: p, profit: total };
  }
  return { prices: HOURS.map(() => best.price), profit: best.profit };
}

/** Deterministic pseudo-random numbers (Park–Miller). */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * A tag's price for the given moment: about half gold, the rest split between below cost and
 * so dear that nobody buys, so the color (not reading the number fast) is what the player acts on.
 */
export function tagPrice(busy: number, random: () => number): number {
  const r = random();
  const { low, high } = goldBand(busy);
  let price: number;
  if (r < 0.5) price = low + (high - low) * (0.1 + 0.8 * random());
  else if (r < 0.72) price = TAG_RANGE.min + (CUP_COST - 3 - TAG_RANGE.min) * random();
  else {
    // Above the choke price nobody buys at all
    const from = chokePrice(busy) + 5;
    price = from + Math.max(0, TAG_RANGE.max - from) * random();
  }
  return Math.round(price);
}

/** What one slashed tag earns (฿, negative below cost, 0 when nobody buys). */
export function slashProfit(price: number, busy: number): number {
  return Math.round(profit(price, busy) / BATCH);
}
