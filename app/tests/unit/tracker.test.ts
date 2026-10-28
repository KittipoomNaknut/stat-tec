import { describe, expect, it } from 'vitest';
import { Landmark } from '../../src/perception/landmarks';
import { LANDMARK_STRIDE } from '../../src/perception/protocol';
import { PoseTracker } from '../../src/perception/tracker';
import { syntheticPoses, type SyntheticPose } from './pose-fixtures';

const FRAME_MS = 1000 / 30;
const FILTER = { minCutoff: 0.8, beta: 3, dCutoff: 1 };

function feed(tracker: PoseTracker, pose: SyntheticPose | null, t0: number, ms: number) {
  const { data, width, height, poseCount } = syntheticPoses(pose ? [pose] : []);
  let t = t0;
  let last = tracker.process(data, poseCount, width, height, t);
  for (t += FRAME_MS; t <= t0 + ms; t += FRAME_MS) {
    last = tracker.process(data, poseCount, width, height, t);
  }
  return { last, t, data };
}

describe('PoseTracker', () => {
  it('outputs nothing until a player is locked', () => {
    const { last } = feed(new PoseTracker(FILTER), { cx: 0.5, cy: 0.5, sw: 0.14 }, 0, 200);
    expect(last).toMatchObject({ state: 'candidate', player: null, body: null });
  });

  it('outputs the locked player in image and body space', () => {
    const { last } = feed(new PoseTracker(FILTER), { cx: 0.5, cy: 0.5, sw: 0.14 }, 0, 1000);
    expect(last.state).toBe('locked');
    const shoulder = Landmark.RIGHT_SHOULDER * LANDMARK_STRIDE;
    expect(last.body?.[shoulder]).toBeCloseTo(0.5, 3);
  });

  it("does not carry the previous player's motion into a new player", () => {
    const tracker = new PoseTracker(FILTER);
    let { t } = feed(tracker, { cx: 0.35, cy: 0.5, sw: 0.14 }, 0, 1000);
    ({ t } = feed(tracker, null, t + FRAME_MS, 2000));
    const next = { cx: 0.65, cy: 0.5, sw: 0.14 };
    const { last, data } = feed(tracker, next, t + FRAME_MS, 600);
    expect(last).toMatchObject({ state: 'locked', playerId: 2 });
    // First filtered frame of the new player starts from its raw position, so no drift remains.
    const x = Landmark.NOSE * LANDMARK_STRIDE;
    expect(last.player?.[x]).toBeCloseTo(data[x] ?? NaN, 4);
  });
});
