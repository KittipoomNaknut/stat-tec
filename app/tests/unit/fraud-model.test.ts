import { describe, expect, it } from 'vitest';
import {
  atRing,
  bestRing,
  bigSet,
  density,
  distance,
  emptySet,
  fillSet,
  fitNormal,
  outcomes,
  playStream,
  ring,
  RING,
  ringAt,
  scoreAll,
} from '../../src/scenes/fraud/model';

// A smaller set keeps the suite fast; the shape of the trade-off is the same.
const N = 200_000;
const data = bigSet(N);
const normal = fitNormal(data);
const scores = scoreAll(data, normal);
const result = outcomes(data, scores);

describe('EPISODE IV fraud model', () => {
  it('has about 1% fraud, all inside the plot', () => {
    expect(data.frauds / N).toBeGreaterThan(0.008);
    expect(data.frauds / N).toBeLessThan(0.012);
    for (let i = 0; i < N; i += 997) {
      expect(data.x[i]).toBeGreaterThan(0);
      expect(data.x[i]).toBeLessThan(1);
      expect(data.y[i]).toBeGreaterThan(0);
      expect(data.y[i]).toBeLessThan(1);
    }
  });

  it('fills the set in slices that add up to the same data', () => {
    const sliced = emptySet(20_000);
    const job = fillSet(sliced, 3000);
    let slices = 0;
    while (!job.next().done) slices++;
    const whole = bigSet(20_000);
    expect(slices).toBe(6);
    expect(sliced.frauds).toBe(whole.frauds);
    expect(Array.from(sliced.x.slice(0, 50))).toEqual(Array.from(whole.x.slice(0, 50)));
  });

  it('scores every point by its distance from normal', () => {
    for (const i of [0, 17, 4242, N - 1]) {
      expect(scores[i]).toBeCloseTo(distance(normal, data.x[i] ?? 0, data.y[i] ?? 0), 4);
    }
  });

  it('draws the ring where the distance equals r', () => {
    for (const p of ring(normal, 3, 24)) expect(distance(normal, p.x, p.y)).toBeCloseTo(3, 4);
  });

  it('trades fraud let through against good customers blocked as the ring grows', () => {
    const small = atRing(result, 2);
    const large = atRing(result, 4);
    expect(small.recall).toBeGreaterThan(large.recall);
    expect(small.blocked).toBeGreaterThan(large.blocked);
    expect(small.caught + small.missed).toBe(data.frauds);
  });

  it('has its least damage inside the range the hand can reach (a U, not an edge)', () => {
    const best = bestRing(result);
    expect(best.r).toBeGreaterThan(RING.min + 0.3);
    expect(best.r).toBeLessThan(RING.max - 0.3);
    expect(atRing(result, RING.min).damage).toBeGreaterThan(best.damage * 2);
    expect(atRing(result, RING.max).damage).toBeGreaterThan(best.damage * 1.5);
    // Reachable without stretching: the best ring sits in the lower-middle of a raise
    const level = (best.r - RING.min) / (RING.max - RING.min);
    expect(ringAt(level)).toBeCloseTo(best.r, 6);
    expect(level).toBeGreaterThan(0.2);
    expect(level).toBeLessThan(0.6);
  });

  it('counts every point once in the density grid', () => {
    const grid = density(data, 96, 54);
    let total = 0;
    for (let k = 0; k < grid.normal.length; k++)
      total += (grid.normal[k] ?? 0) + (grid.fraud[k] ?? 0);
    expect(total).toBe(N);
  });

  it('gives the player a stream with plenty of fraud to slap', () => {
    const stream = playStream(160);
    const share = stream.filter((t) => t.fraud).length / stream.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.5);
  });
});
