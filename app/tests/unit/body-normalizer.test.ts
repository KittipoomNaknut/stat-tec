import { describe, expect, it } from 'vitest';
import { toBodySpace } from '../../src/perception/body-normalizer';
import { Landmark } from '../../src/perception/landmarks';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../../src/perception/protocol';
import { syntheticPoses } from './pose-fixtures';

const at = (data: Float32Array, i: number) => ({
  x: data[i * LANDMARK_STRIDE] ?? NaN,
  y: data[i * LANDMARK_STRIDE + 1] ?? NaN,
  v: data[i * LANDMARK_STRIDE + 3] ?? NaN,
});

describe('toBodySpace', () => {
  it('puts the shoulders at ±0.5 around the origin', () => {
    const { data, width, height } = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0.2 }]);
    const out = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    expect(toBodySpace(data, width, height, out)).toBe(true);
    // Mirrored: the person's left shoulder is image-right, so screen-left (−x).
    expect(at(out, Landmark.LEFT_SHOULDER).x).toBeCloseTo(-0.5);
    expect(at(out, Landmark.RIGHT_SHOULDER).x).toBeCloseTo(0.5);
    expect(at(out, Landmark.LEFT_SHOULDER).y).toBeCloseTo(0);
  });

  it('measures in shoulder widths regardless of distance to the camera', () => {
    const near = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0.3 }]);
    const far = syntheticPoses([{ cx: 0.3, cy: 0.4, sw: 0.1 }]);
    const a = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    const b = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    toBodySpace(near.data, near.width, near.height, a);
    toBodySpace(far.data, far.width, far.height, b);
    for (const i of [Landmark.NOSE, Landmark.LEFT_HIP, Landmark.RIGHT_HIP]) {
      expect(at(a, i).x).toBeCloseTo(at(b, i).x, 5);
      expect(at(a, i).y).toBeCloseTo(at(b, i).y, 5);
    }
    // Hips are one shoulder width below the shoulders in the fixture.
    expect(at(a, Landmark.LEFT_HIP).y).toBeCloseTo(1, 5);
  });

  it('reads the requested pose and copies visibility', () => {
    const { data, width, height } = syntheticPoses([
      { cx: 0.2, cy: 0.5, sw: 0.1 },
      { cx: 0.7, cy: 0.5, sw: 0.2, visibility: 0.42 },
    ]);
    const out = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    toBodySpace(data, width, height, out, 1);
    expect(at(out, Landmark.RIGHT_SHOULDER).x).toBeCloseTo(0.5);
    expect(at(out, Landmark.NOSE).v).toBeCloseTo(0.42);
  });

  it('keeps its scale when the person turns sideways', () => {
    const facing = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0.2 }]);
    const sideways = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0.2, shoulderSpread: 0.05 }]);
    const a = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    const b = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
    toBodySpace(facing.data, facing.width, facing.height, a);
    toBodySpace(sideways.data, sideways.width, sideways.height, b);
    // Shoulder width collapsed 20×; the torso keeps the scale within 1.6× instead of exploding.
    const hipY = (out: Float32Array) => at(out, Landmark.LEFT_HIP).y;
    expect(hipY(b) / hipY(a)).toBeGreaterThan(0.9);
    expect(hipY(b) / hipY(a)).toBeLessThan(1.6);
  });

  it('refuses a degenerate pose and leaves the output untouched', () => {
    const { data, width, height } = syntheticPoses([{ cx: 0.5, cy: 0.5, sw: 0 }]);
    const out = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE).fill(7);
    expect(toBodySpace(data, width, height, out)).toBe(false);
    expect(out[0]).toBe(7);
  });
});
