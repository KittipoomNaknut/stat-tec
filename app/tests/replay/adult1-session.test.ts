/**
 * Replays a real recorded session (one adult, alone, ~2 m, built-in 720p webcam) through the
 * production pipeline. Guards against regressions found in that recording: duplicate "ghost"
 * fits counted as other people, and body-space coordinates exploding when the player turns.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { perceptionDefaults } from '../../src/config/perception';
import type { PoseSession } from '../../src/debug/pose-recording';
import { Landmark } from '../../src/perception/landmarks';
import { LANDMARK_STRIDE } from '../../src/perception/protocol';
import { PoseTracker, type TrackedFrame } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';
import { SOLO_SESSIONS } from '../support/sessions';

const LOCK_WITHIN_MS = 700;
/** Arms fully extended reach ~3 SW from mid-shoulder; anything past this is a scale bug. */
const MAX_BODY_COORD = 5;

let session: PoseSession;

function replay(clipId: string) {
  const clip = session.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`missing clip ${clipId}`);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const frames: (TrackedFrame & { t: number })[] = [];
  for (const f of clipFrames(clip)) {
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      session.camera.width,
      session.camera.height,
      f.t,
    );
    frames.push({ ...r, t: f.t });
  }
  return frames;
}

const CLIPS = [
  'idle-stand',
  'idle-fidget',
  'point-right-sweep',
  'point-left-sweep',
  'point-hold',
  'raise-right',
  'raise-both',
  'throw',
  'slap',
  'draw',
  'swipe',
];

describe.each(SOLO_SESSIONS)('replay $file', ({ file: FILE }) => {
  beforeAll(async () => {
    session = await loadSession(FILE);
  });

  it.each(CLIPS)('%s: locks quickly once eligible and keeps one player id', (id) => {
    const frames = replay(id);
    // Measured from when the person becomes a candidate (centered enough): in the RTMPose
    // session the owner was still walking back to the middle when some clips started.
    const candidate = frames.find((f) => f.state === 'candidate');
    const firstLock = frames.find((f) => f.state === 'locked');
    expect((firstLock?.t ?? Infinity) - (candidate?.t ?? 0)).toBeLessThan(LOCK_WITHIN_MS);
    expect(new Set(frames.map((f) => f.playerId).filter((p) => p > 0))).toEqual(new Set([1]));
  });

  it.each([...CLIPS, 'walk-in-out'])(
    '%s: never reports another person while a player is present (recorded alone)',
    (id) => {
      // Before a lock, a lone person at the frame edge is simply "not the player yet".
      const withOthers = replay(id).filter(
        (f) => (f.state === 'locked' || f.state === 'lost') && f.otherIndices.length > 0,
      );
      expect(withOthers.map((f) => f.t)).toEqual([]);
    },
  );

  it.each(CLIPS)('%s: body-space wrists stay in a plausible range', (id) => {
    const bad: string[] = [];
    for (const f of replay(id)) {
      if (!f.body) continue;
      for (const w of [Landmark.LEFT_WRIST, Landmark.RIGHT_WRIST]) {
        const k = w * LANDMARK_STRIDE;
        if ((f.body[k + 3] ?? 0) < 0.5) continue;
        const x = f.body[k] ?? 0;
        const y = f.body[k + 1] ?? 0;
        if (Math.abs(x) > MAX_BODY_COORD || Math.abs(y) > MAX_BODY_COORD) {
          bad.push(`t=${f.t.toFixed(0)} (${x.toFixed(1)}, ${y.toFixed(1)})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('walk-in-out: locks, loses the player as they leave, then forgets them', () => {
    const states = replay('walk-in-out').map((f) => f.state);
    const order = states.filter((s, i) => s !== states[i - 1]);
    // The person is already in view on the first frame, so it starts as a candidate.
    expect(order.slice(0, 4)).toEqual(['candidate', 'locked', 'lost', 'searching']);
    // In the RTMPose session the owner came back before the clip ended: someone returning after
    // being forgotten is a new player.
    const ids = replay('walk-in-out').map((f) => f.playerId);
    expect(Math.max(...ids)).toBe(order.length > 4 ? 2 : 1);
  });
});
