import { describe, expect, it } from 'vitest';
import { PlayerLock, type LockResult } from '../../src/perception/player-lock';
import { syntheticPoses, type SyntheticPose } from './pose-fixtures';

const FRAME_MS = 1000 / 30;
const CENTER: SyntheticPose = { cx: 0.5, cy: 0.5, sw: 0.14 };

/** Feeds the same scene for `ms` milliseconds starting at `t0`; returns the last result. */
function run(lock: PlayerLock, poses: readonly SyntheticPose[], t0: number, ms: number) {
  const { data, width, height } = syntheticPoses(poses);
  let result: LockResult | undefined;
  let t = t0;
  for (; t <= t0 + ms; t += FRAME_MS) result = lock.update(data, poses.length, width, height, t);
  if (!result) throw new Error('no frames');
  return { result, t };
}

describe('PlayerLock', () => {
  it('locks a centered person after holding for 500 ms', () => {
    const lock = new PlayerLock();
    expect(run(lock, [CENTER], 0, 300).result.state).toBe('candidate');
    const { result } = run(lock, [CENTER], 334, 300);
    expect(result).toMatchObject({ state: 'locked', playerId: 1, playerIndex: 0 });
  });

  it('ignores someone standing at the edge of the frame', () => {
    const lock = new PlayerLock();
    const { result } = run(lock, [{ cx: 0.1, cy: 0.5, sw: 0.14 }], 0, 2000);
    expect(result).toMatchObject({ state: 'searching', playerIndex: -1, otherIndices: [0] });
  });

  it('ignores a distant person below the score threshold', () => {
    const lock = new PlayerLock();
    const { result } = run(lock, [{ cx: 0.7, cy: 0.5, sw: 0.02 }], 0, 2000);
    expect(result.state).toBe('searching');
  });

  it('merges two detections of the same person', () => {
    const lock = new PlayerLock();
    const twin = { ...CENTER, cx: CENTER.cx + 0.02, visibility: 0.8 };
    const { result } = run(lock, [twin, CENTER], 0, 1000);
    expect(result.state).toBe('locked');
    expect(result.playerIndex).toBe(1); // the more confident detection wins
    expect(result.otherIndices).toEqual([]);
  });

  it('keeps the player when someone better placed walks in', () => {
    const lock = new PlayerLock();
    const player = { cx: 0.4, cy: 0.5, sw: 0.12 };
    const { t } = run(lock, [player], 0, 1000);
    // Closer to the camera and overlapping the player in the image — a second person, not a duplicate.
    const intruder = { cx: 0.5, cy: 0.5, sw: 0.25 };
    const { result } = run(lock, [intruder, player], t, 1000);
    expect(result).toMatchObject({ state: 'locked', playerId: 1, playerIndex: 1 });
    expect(result.otherIndices).toEqual([0]);
  });

  it('rides out a short dropout without changing state', () => {
    const lock = new PlayerLock();
    const { t } = run(lock, [CENTER], 0, 1000);
    const { result } = run(lock, [], t, 200);
    expect(result).toMatchObject({ state: 'locked', playerIndex: -1 });
  });

  it('gives a returning player their id back within 1.5 s', () => {
    const lock = new PlayerLock();
    let { t } = run(lock, [CENTER], 0, 1000);
    ({ t } = run(lock, [], t, 1000));
    expect(run(lock, [], t, 0).result.state).toBe('lost');
    const { result } = run(lock, [{ ...CENTER, cx: 0.55 }], t + FRAME_MS, 0);
    expect(result).toMatchObject({ state: 'locked', playerId: 1, playerIndex: 0 });
  });

  it('forgets a player gone for longer than 1.5 s and locks the next one with a new id', () => {
    const lock = new PlayerLock();
    let { t } = run(lock, [CENTER], 0, 1000);
    ({ t } = run(lock, [], t, 2500));
    expect(run(lock, [], t, 0).result.state).toBe('searching');
    const { result } = run(lock, [CENTER], t + FRAME_MS, 1000);
    expect(result).toMatchObject({ state: 'locked', playerId: 2 });
  });

  it('skips poses with low confidence', () => {
    const lock = new PlayerLock();
    const { result } = run(lock, [{ ...CENTER, visibility: 0.2 }], 0, 1000);
    expect(result).toMatchObject({ state: 'searching', otherIndices: [] });
  });
});
