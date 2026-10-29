import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, DEFAULT_ADAPTIVE } from '../../src/render/adaptive-resolution';

/** Feeds `seconds` of frames at a fixed interval; returns the scale after each change. */
function run(ar: AdaptiveResolution, intervalMs: number, seconds: number, start = 0): number {
  let t = start;
  while (t < start + seconds * 1000) {
    t += intervalMs;
    ar.update(intervalMs, t);
  }
  return t;
}

describe('AdaptiveResolution', () => {
  it('stays at full scale while frames keep up', () => {
    const ar = new AdaptiveResolution();
    run(ar, 16.7, 20);
    expect(ar.scale).toBe(1);
  });

  it('steps down 10% per slow window and stops at the minimum', () => {
    const ar = new AdaptiveResolution();
    const t = run(ar, 33, 2.1);
    expect(ar.scale).toBe(0.9);
    run(ar, 33, 30, t);
    expect(ar.scale).toBe(DEFAULT_ADAPTIVE.min);
  });

  it('a few slow frames (under 5%) do not trigger a step', () => {
    const ar = new AdaptiveResolution();
    let t = 0;
    for (let i = 0; i < 240; i++) {
      const dt = i % 40 === 0 ? 50 : 16.7;
      t += dt;
      ar.update(dt, t);
    }
    expect(ar.scale).toBe(1);
  });

  it('scales back up after headroom, waiting longer after each drop (no ping-pong)', () => {
    const ar = new AdaptiveResolution();
    let t = run(ar, 33, 2.1); // → 0.9, recovery now needs 4 fast windows
    t = run(ar, 16.7, 6, t);
    expect(ar.scale).toBe(0.9);
    run(ar, 16.7, 4, t);
    expect(ar.scale).toBe(1);
  });
});
