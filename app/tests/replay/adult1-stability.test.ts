/**
 * Landmark stability on the real recording. Before LandmarkStabilizer the hanging arm and the
 * hips crossed visibility 0.5 up to 76 times per clip, so their lines flickered on and off.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { perceptionDefaults } from '../../src/config/perception';
import type { PoseSession } from '../../src/debug/pose-recording';
import { Landmark } from '../../src/perception/landmarks';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';
import { SOLO_SESSIONS } from '../support/sessions';

/** At most this many show/hide changes per landmark per clip (was up to 76). */
const MAX_FLIPS = 6;
const WATCHED = {
  'left elbow': Landmark.LEFT_ELBOW,
  'right elbow': Landmark.RIGHT_ELBOW,
  'left wrist': Landmark.LEFT_WRIST,
  'right wrist': Landmark.RIGHT_WRIST,
  'left hip': Landmark.LEFT_HIP,
  'right hip': Landmark.RIGHT_HIP,
};

let session: PoseSession;

describe.each(SOLO_SESSIONS)('stability replay $file', ({ file: FILE }) => {
  beforeAll(async () => {
    session = await loadSession(FILE);
  });

  it.each([
    'idle-fidget',
    'point-right-sweep',
    'point-left-sweep',
    'point-hold',
    'raise-both',
    'draw',
    'swipe',
  ])('%s: arms and hips do not flicker', (id) => {
    const clip = session.clips.find((c) => c.id === id);
    if (!clip) throw new Error(`missing clip ${id}`);
    const tracker = new PoseTracker(perceptionDefaults.filter);
    const flips = Object.fromEntries(Object.keys(WATCHED).map((k) => [k, 0]));
    let prev: Uint8Array | null = null;
    for (const f of clipFrames(clip)) {
      const { shown } = tracker.process(
        f.landmarks,
        f.poseCount,
        session.camera.width,
        session.camera.height,
        f.t,
      );
      if (!shown) continue;
      if (prev) {
        for (const [name, i] of Object.entries(WATCHED)) {
          if (prev[i] !== shown[i]) flips[name] = (flips[name] ?? 0) + 1;
        }
      }
      prev = shown;
    }
    const tooMany = Object.entries(flips).filter(([, n]) => n > MAX_FLIPS);
    expect(tooMany).toEqual([]);
  });
});
