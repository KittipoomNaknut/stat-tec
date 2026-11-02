import { describe, expect, it } from 'vitest';
import {
  bestPrice,
  busyAt,
  chokePrice,
  classify,
  cups,
  CUP_COST,
  dynamicPlan,
  flatPlan,
  goldBand,
  profit,
  seeded,
  slashProfit,
  tagPrice,
} from '../../src/scenes/slash/model';

describe('slash model (EP III)', () => {
  it('finds the true profit peak at every crowd size', () => {
    for (const busy of [0.6, 1, 1.3]) {
      const p = bestPrice(busy);
      expect(profit(p, busy)).toBeGreaterThan(profit(p - 1, busy));
      expect(profit(p, busy)).toBeGreaterThan(profit(p + 1, busy));
    }
  });

  it('moves the best price up when the shop is busier', () => {
    expect(bestPrice(1.3)).toBeGreaterThan(bestPrice(1));
    expect(bestPrice(1)).toBeGreaterThan(bestPrice(0.7));
  });

  it('bounds the gold band where profit is 75% of the peak', () => {
    const { low, high } = goldBand(1);
    const peak = profit(bestPrice(1), 1);
    expect(profit(low, 1) / peak).toBeCloseTo(0.75, 6);
    expect(profit(high, 1) / peak).toBeCloseTo(0.75, 6);
  });

  it('only makes tags of the three colors the player is taught', () => {
    const random = seeded(3);
    const kinds = new Map<string, number>();
    for (let i = 0; i < 3000; i++) {
      const busy = busyAt(i / 3000);
      const price = tagPrice(busy, random);
      const kind = classify(price, busy);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (kind === 'loss') expect(slashProfit(price, busy)).toBeLessThanOrEqual(0);
      if (kind === 'pricey') {
        expect(price).toBeGreaterThan(chokePrice(busy));
        expect(cups(price, busy)).toBe(0);
      }
      if (kind === 'gold') expect(slashProfit(price, busy)).toBeGreaterThan(0);
    }
    expect(kinds.get('cheap') ?? 0).toBe(0);
    expect(kinds.get('gold') ?? 0).toBeGreaterThan(1200);
  });

  it('prices below cost lose money', () => {
    expect(profit(CUP_COST - 5, 1)).toBeLessThan(0);
  });

  it('pricing by the hour beats the best single price', () => {
    const dyn = dynamicPlan();
    const flat = flatPlan();
    expect(dyn.profit).toBeGreaterThan(flat.profit * 1.1);
    expect(new Set(dyn.prices).size).toBeGreaterThan(3);
  });
});
