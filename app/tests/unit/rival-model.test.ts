import { describe, expect, it } from 'vitest';
import {
  baseline,
  bestStrategy,
  CUP_COST,
  evaluate,
  RIVAL_PRICE,
  STRATEGIES,
} from '../../src/scenes/rival/model';

describe('rival model (EP II)', () => {
  it('discounting only the price-sensitive group keeps the most profit at any fair price', () => {
    for (let price = 59; price <= 120; price++)
      expect(bestStrategy(price), String(price)).toBe('target');
  });

  it('keeps everyone when everyone gets the rival price, at a thinner margin', () => {
    const all = evaluate('all', 71);
    expect(Object.values(all.leaves)).toEqual([0, 0, 0]);
    expect(all.kept).toBeCloseTo((RIVAL_PRICE - CUP_COST) / (71 - CUP_COST), 6);
  });

  it('loses the price-sensitive customers when nobody gets a discount', () => {
    const none = evaluate('none', 71);
    expect(none.leaves.promo).toBeGreaterThan(0.5);
    expect(none.leaves['big-spender']).toBe(0);
    expect(none.profit).toBeLessThan(baseline(71));
  });

  it('offers three choices with distinct results', () => {
    const kept = STRATEGIES.map((s) => Math.round(evaluate(s.id, 71).kept * 100));
    expect(new Set(kept).size).toBe(3);
  });
});
