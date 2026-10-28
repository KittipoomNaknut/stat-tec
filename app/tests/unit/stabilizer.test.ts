import { describe, expect, it } from 'vitest';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../../src/perception/protocol';
import { LandmarkStabilizer } from '../../src/perception/stabilizer';

const FRAME_MS = 1000 / 30;

/** One pose where every landmark is at (x, 0.5) with the given visibility. */
function pose(x: number, visibility: number) {
  const p = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  for (let i = 0; i < LANDMARK_COUNT; i++) p.set([x, 0.5, 0, visibility], i * LANDMARK_STRIDE);
  return p;
}

describe('LandmarkStabilizer', () => {
  it('does not flicker when visibility hovers around 0.5', () => {
    const s = new LandmarkStabilizer();
    let flips = 0;
    let prev = s.apply(pose(0.5, 0.9), 0)[0];
    for (let i = 1; i < 90; i++) {
      const shown = s.apply(pose(0.5, i % 2 ? 0.45 : 0.55), i * FRAME_MS)[0];
      if (shown !== prev) flips++;
      prev = shown;
    }
    expect(flips).toBe(0);
  });

  it('hides a landmark that is really gone, and shows it again when it returns', () => {
    const s = new LandmarkStabilizer();
    s.apply(pose(0.5, 0.9), 0);
    let t = 0;
    let shown = 1;
    for (; t < 1000 && shown; t += FRAME_MS) shown = s.apply(pose(0.5, 0.05), t)[0] ?? 0;
    expect(shown).toBe(0);
    for (; t < 3000 && !shown; t += FRAME_MS) shown = s.apply(pose(0.5, 0.95), t)[0] ?? 0;
    expect(shown).toBe(1);
  });

  it('holds the last confident position briefly instead of the guess', () => {
    const s = new LandmarkStabilizer();
    s.apply(pose(0.3, 0.9), 0);
    const unsure = pose(0.8, 0.2);
    s.apply(unsure, 100);
    expect(unsure[0]).toBeCloseTo(0.3);
    const later = pose(0.8, 0.2);
    s.apply(later, 400);
    expect(later[0]).toBeCloseTo(0.8);
  });

  it('writes smoothed visibility back into the pose', () => {
    const s = new LandmarkStabilizer();
    s.apply(pose(0.5, 1), 0);
    const p = pose(0.5, 0);
    s.apply(p, FRAME_MS);
    expect(p[3]).toBeGreaterThan(0.5);
    expect(p[3]).toBeLessThan(1);
  });
});
