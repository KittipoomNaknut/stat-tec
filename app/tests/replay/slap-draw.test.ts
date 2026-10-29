/**
 * Research 019: slap and draw read off the smoothed cursor. Replays the owner's recorded clips
 * through the same chain as the engine (tracker → cursor → smoother → detector).
 */
import { describe, expect, it } from 'vitest';
import { cursorConfigFor } from '../../src/config/gestures';
import { perceptionDefaults } from '../../src/config/perception';
import { CursorTracker } from '../../src/gestures/cursor';
import { CursorSmoother } from '../../src/gestures/cursor-smoother';
import { DrawDetector } from '../../src/gestures/draw';
import { SlapDetector } from '../../src/gestures/slap';
import { PoseTracker } from '../../src/perception/tracker';
import { clipById, clipFrames, loadSession } from '../support/pose-session';

const RTMPOSE = '2026-10-28-adult1-2m-rtmpose.pose.json.gz';
const PLAYGROUND = '2026-10-29-adult1-playground-sidezone.pose.json.gz';

/** Slaps counted as separate runs of active frames, and pen-down strokes. */
async function replay(file: string, clipId: string): Promise<{ slaps: number; strokes: number }> {
  const session = await loadSession(file);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const cursor = new CursorTracker(cursorConfigFor('server'));
  const smoother = new CursorSmoother();
  const slap = new SlapDetector();
  const draw = new DrawDetector();
  let slaps = 0;
  let strokes = 0;
  let active = false;
  for (const f of clipFrames(clipById(session, clipId))) {
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      session.camera.width,
      session.camera.height,
      f.t,
    );
    const c = smoother.update(cursor.update(r.state === 'locked' ? r.body : null, f.t), f.t);
    const hit = slap.update(c, f.t) !== null;
    if (hit && !active) slaps++;
    active = hit;
    for (const e of draw.update(c)) if (e.phase === 'start') strokes++;
  }
  return { slaps, strokes };
}

describe('slap on recorded clips', () => {
  it('catches most of the six sweeps in the swipe clip', async () => {
    expect((await replay(RTMPOSE, 'swipe')).slaps).toBeGreaterThanOrEqual(5);
  });

  it.each(['walk-in-out', 'idle-stand', 'idle-fidget', 'point-right-sweep', 'raise-right'])(
    'never slaps in %s',
    async (clip) => {
      expect((await replay(RTMPOSE, clip)).slaps).toBe(0);
    },
  );

  it('stays rare while pointing at buttons (≤ 2 in a minute of playground)', async () => {
    expect((await replay(PLAYGROUND, 'playground')).slaps).toBeLessThanOrEqual(2);
  });
});

describe('draw on recorded clips', () => {
  it('draws the draw clip as one unbroken stroke', async () => {
    expect((await replay(RTMPOSE, 'draw')).strokes).toBe(1);
  });

  it('never puts the pen down while standing or fidgeting', async () => {
    for (const clip of ['walk-in-out', 'idle-stand', 'idle-fidget']) {
      expect((await replay(RTMPOSE, clip)).strokes).toBe(0);
    }
  });
});
