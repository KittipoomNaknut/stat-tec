import { describe, expect, it } from 'vitest';
import { baht, CountUp } from '../../src/hud/count-up';

describe('CountUp', () => {
  it('glides to the target and lands exactly on it', () => {
    const c = new CountUp(1000);
    c.set(1_000_000);
    c.update(100);
    const early = c.value;
    expect(early).toBeGreaterThan(300_000); // expo-out: most of the way early
    expect(early).toBeLessThan(1_000_000);
    c.update(900);
    expect(c.value).toBe(1_000_000);
    expect(c.done).toBe(true);
  });

  it('continues from where it is when retargeted, or jumps without animation', () => {
    const c = new CountUp(1000);
    c.set(100);
    c.update(500);
    const mid = c.value;
    c.set(200);
    expect(c.value).toBeCloseTo(mid);
    c.set(5, false);
    expect(c.value).toBe(5);
  });

  it('formats baht with separators', () => {
    expect(baht(1_288_000.4)).toBe('฿1,288,000');
  });
});
