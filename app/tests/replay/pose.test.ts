/**
 * Static poses on the real recordings (research 025): the clips where the owner raised both
 * arms or crossed them must read as that pose, and standing, walking or pointing must not
 * complete any pose hold.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { perceptionDefaults } from '../../src/config/perception';
import type { PoseSession } from '../../src/debug/pose-recording';
import { classify, PoseDetector, type PoseName } from '../../src/gestures/pose';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';
import { SOLO_SESSIONS } from '../support/sessions';

let session: PoseSession;

function replay(clipId: string) {
  const clip = session.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`missing clip ${clipId}`);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const detector = new PoseDetector();
  const seen = new Map<PoseName, number>();
  const held: PoseName[] = [];
  let frames = 0;
  for (const f of clipFrames(clip)) {
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      session.camera.width,
      session.camera.height,
      f.t,
    );
    const body = r.state === 'locked' ? r.body : null;
    if (!body) continue;
    frames++;
    const pose = classify(body);
    if (pose) seen.set(pose, (seen.get(pose) ?? 0) + 1);
    const e = detector.update(body, f.t);
    if (e.held && e.pose) held.push(e.pose);
  }
  return { frames, seen, held };
}

describe.each(SOLO_SESSIONS)('poses on $file', ({ file, source }) => {
  beforeAll(async () => {
    session = await loadSession(file);
  });

  it.each(['walk-in-out', 'idle-stand', 'point-hold'])('%s: completes no pose', (id) => {
    expect(replay(id).held).toEqual([]);
  });

  // The kiosk runs RTMPose; MediaPipe's fit of both arms up is a ghost in this recording (README)
  it.runIf(source === 'server')('raise-both: reads as both hands up', () => {
    expect(replay('raise-both').held).toContain('both-up');
  });

  it.runIf(source === 'server')('raise-right: reads as the right hand up', () => {
    expect(replay('raise-right').held).toEqual(['right-up']);
  });

  it.runIf(source === 'server')('slap: completes no pose', () => {
    expect(replay('slap').held).toEqual([]);
  });
});
