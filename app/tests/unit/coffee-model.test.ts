import { describe, expect, it } from 'vitest';
import {
  bestPrice,
  fit,
  pastDays,
  revenueAt,
  searchAttempts,
  sse,
  TRUE_DEMAND,
} from '../../src/scenes/coffee/model';

describe('coffee model', () => {
  const days = pastDays();

  it('gives every visitor the same 13 noisy days', () => {
    expect(days).toHaveLength(13);
    expect(pastDays()).toEqual(days);
    // noisy, not a straight line
    expect(sse(TRUE_DEMAND, days)).toBeGreaterThan(1000);
  });

  it('fits close to the true demand', () => {
    const line = fit(days);
    expect(line.slope).toBeCloseTo(TRUE_DEMAND.slope, 0);
    expect(Math.abs(line.intercept - TRUE_DEMAND.intercept)).toBeLessThan(40);
  });

  it('least squares has the smallest SSE of nearby lines', () => {
    const best = fit(days);
    const base = sse(best, days);
    for (const [da, db] of [
      [5, 0],
      [-5, 0],
      [0, 0.1],
      [0, -0.1],
    ] as const) {
      expect(sse({ intercept: best.intercept + da, slope: best.slope + db }, days)).toBeGreaterThan(
        base,
      );
    }
  });

  it('search attempts improve every time and end on the best line', () => {
    const attempts = searchAttempts(days);
    expect(attempts.length).toBe(6);
    for (let i = 1; i < attempts.length; i++) {
      expect(attempts[i]?.sse).toBeLessThan(attempts[i - 1]?.sse ?? Infinity);
    }
    // the first guess is bad enough to be worth showing
    expect(attempts[0]?.sse).toBeGreaterThan((attempts.at(-1)?.sse ?? 0) * 10);
    expect(attempts.at(-1)?.line).toEqual(fit(days));
  });

  it('finds the revenue peak at -a / 2b', () => {
    const line = fit(days);
    const p = bestPrice(line);
    expect(p).toBeGreaterThan(55);
    expect(p).toBeLessThan(90);
    expect(revenueAt(line, p)).toBeGreaterThanOrEqual(revenueAt(line, p - 5));
    expect(revenueAt(line, p)).toBeGreaterThanOrEqual(revenueAt(line, p + 5));
  });
});
