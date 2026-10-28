import { describe, expect, it } from 'vitest';
import { RateMeter, RollingWindow } from '../../src/core/rolling-stats';

describe('RollingWindow', () => {
  it('is empty-safe', () => {
    const w = new RollingWindow(4);
    expect(w.mean()).toBe(0);
    expect(w.percentile(95)).toBe(0);
  });

  it('keeps only the most recent samples', () => {
    const w = new RollingWindow(3);
    [1, 2, 3, 4, 5].forEach((v) => {
      w.push(v);
    });
    expect(w.count).toBe(3);
    expect(w.mean()).toBe(4);
  });

  it('computes nearest-rank percentiles numerically', () => {
    const w = new RollingWindow(100);
    for (let v = 1; v <= 100; v++) w.push(v);
    expect(w.percentile(50)).toBe(50);
    expect(w.percentile(95)).toBe(95);
    expect(w.percentile(100)).toBe(100);
  });
});

describe('RateMeter', () => {
  it('measures a steady rate', () => {
    const m = new RateMeter(30);
    for (let i = 0; i < 90; i++) m.tick(i * (1000 / 30));
    expect(m.rate(89 * (1000 / 30))).toBeCloseTo(30, 5);
  });

  it('needs two events', () => {
    const m = new RateMeter(10);
    m.tick(0);
    expect(m.rate(0)).toBe(0);
  });

  it('drops to zero when events stop', () => {
    const m = new RateMeter(10);
    for (let i = 0; i < 10; i++) m.tick(i * 100);
    expect(m.rate(950)).toBeGreaterThan(0);
    expect(m.rate(5000)).toBe(0);
  });
});
