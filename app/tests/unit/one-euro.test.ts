import { describe, expect, it } from 'vitest';
import { OneEuroFilterBank } from '../../src/perception/one-euro';

const params = { minCutoff: 1, beta: 0, dCutoff: 1 };
const FRAME_MS = 1000 / 30;

/** Deterministic white-ish noise in [-amp, amp] (classic sin-hash). */
function noise(i: number, amp: number): number {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  return (h - Math.floor(h)) * 2 * amp - amp;
}

describe('OneEuroFilterBank', () => {
  it('passes the first sample through unchanged', () => {
    const f = new OneEuroFilterBank(2, params);
    const v = new Float32Array([0.25, 0.75]);
    f.filter(v, 0);
    expect(Array.from(v)).toEqual([0.25, 0.75]);
  });

  it('reduces jitter of a still point', () => {
    const f = new OneEuroFilterBank(1, params);
    let rawJitter = 0;
    let filteredJitter = 0;
    let prevRaw = 0.5;
    let prevFiltered = 0.5;
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + noise(i, 0.01);
      const v = new Float32Array([raw]);
      f.filter(v, i * FRAME_MS);
      if (i > 30) {
        rawJitter += Math.abs(raw - prevRaw);
        filteredJitter += Math.abs((v[0] ?? 0) - prevFiltered);
      }
      prevRaw = raw;
      prevFiltered = v[0] ?? 0;
    }
    expect(filteredJitter).toBeLessThan(rawJitter * 0.3);
  });

  it('follows fast motion more closely with a higher beta', () => {
    const lagAfterStep = (beta: number) => {
      const f = new OneEuroFilterBank(1, { ...params, beta });
      const v = new Float32Array(1);
      for (let i = 0; i < 30; i++) {
        v[0] = 0;
        f.filter(v, i * FRAME_MS);
      }
      for (let i = 30; i < 35; i++) {
        v[0] = 1;
        f.filter(v, i * FRAME_MS);
      }
      return 1 - (v[0] ?? 0);
    };
    expect(lagAfterStep(5)).toBeLessThan(lagAfterStep(0));
  });

  it('filters strided channels in place and leaves others untouched', () => {
    const f = new OneEuroFilterBank(2, params);
    // two landmarks × [x, visibility]
    const v = new Float32Array([0, 0.9, 0, 0.8]);
    f.filter(v, 0, 2, 0);
    v.set([1, 0.9, 1, 0.8]);
    f.filter(v, FRAME_MS, 2, 0);
    expect(v[0]).toBeGreaterThan(0);
    expect(v[0]).toBeLessThan(1);
    expect(v[1]).toBeCloseTo(0.9);
    expect(v[3]).toBeCloseTo(0.8);
  });

  it('restarts from the raw value after reset', () => {
    const f = new OneEuroFilterBank(1, params);
    const v = new Float32Array([0]);
    f.filter(v, 0);
    f.reset();
    v[0] = 1;
    f.filter(v, FRAME_MS);
    expect(v[0]).toBe(1);
  });
});
