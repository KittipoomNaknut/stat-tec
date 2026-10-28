import { describe, expect, it } from 'vitest';
import { clamp } from '../../src/core/math';

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('limits values outside the range', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(3, 0, 1)).toBe(1);
  });
});
