import { describe, expect, it } from 'vitest';
import {
  assign,
  bestKmeans,
  BLIND_START,
  customers,
  elbow,
  kmeans,
  matchSegment,
  SEGMENTS,
} from '../../src/scenes/segments/model';

describe('segments model', () => {
  const { points, truth } = customers();

  it('has 600 customers, the same for every visitor, inside the plot', () => {
    expect(points).toHaveLength(600);
    expect(customers().points).toEqual(points);
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });

  it('K-means from a blind start improves every step and settles', () => {
    const steps = kmeans(points, BLIND_START);
    expect(steps.length).toBeGreaterThanOrEqual(4); // worth animating
    expect(steps.length).toBeLessThan(21);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]?.sse).toBeLessThanOrEqual((steps[i - 1]?.sse ?? 0) + 1e-9);
    }
    expect(steps[0]?.sse).toBeGreaterThan((steps.at(-1)?.sse ?? 0) * 3);
  });

  it('finds the three hidden groups', () => {
    const end = kmeans(points, BLIND_START).at(-1);
    if (!end) throw new Error('no result');
    const names = end.centers.map((c) => matchSegment(c).id).sort();
    expect(names).toEqual(SEGMENTS.map((s) => s.id).sort());
    // nearly every customer lands with their true group
    const labels = assign(points, end.centers);
    const map = end.centers.map((c) => SEGMENTS.indexOf(matchSegment(c)));
    const agree = labels.filter((l, i) => map[l] === truth[i]).length / points.length;
    expect(agree).toBeGreaterThan(0.95);
  });

  it('the elbow is at k = 3', () => {
    const { sse, k } = elbow(points);
    expect(k).toBe(3);
    for (let i = 1; i < sse.length; i++) expect(sse[i]).toBeLessThan(sse[i - 1] ?? Infinity);
  });

  it('best k-means is deterministic', () => {
    expect(bestKmeans(points, 3).sse).toBe(bestKmeans(points, 3).sse);
  });
});
