/**
 * Research 015: the cursor's own smoothing. Replays the owner's playground sessions and checks
 * that frame-to-frame shake while holding still drops by more than half, without costing a
 * single selection.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cursorConfigFor } from '../../src/config/gestures';
import { perceptionDefaults } from '../../src/config/perception';
import { CursorTracker, type CursorState } from '../../src/gestures/cursor';
import { CursorSmoother } from '../../src/gestures/cursor-smoother';
import { DwellDetector } from '../../src/gestures/dwell';
import { TargetRegistry, type Rect } from '../../src/input/targets';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';

const W = 1920;
const H = 1080;

interface Run {
  /** RMS second difference (px at 1080p) on frames where the hand is nearly still. */
  shake: number;
  selects: number;
}

async function replay(file: string, smooth: boolean): Promise<Run> {
  const log = JSON.parse(
    readFileSync(
      new URL('../fixtures/playground/2026-10-29-adult1-sidezone.attempts.json', import.meta.url),
      'utf8',
    ),
  ) as { targets: Record<string, Rect> };
  const session = await loadSession(file);
  const clip = session.clips[0];
  if (!clip) throw new Error('empty session');
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const cursor = new CursorTracker(cursorConfigFor('server'));
  const smoother = new CursorSmoother();
  const targets = new TargetRegistry();
  for (const [id, rect] of Object.entries(log.targets)) targets.register(id, () => rect);
  const dwell = new DwellDetector();
  dwell.update({ visible: false, hand: 'right', x: 0, y: 0 }, targets, -1);

  let selects = 0;
  let sum = 0;
  let n = 0;
  // Stillness is judged on the unsmoothed cursor so both runs measure the same frames.
  const raws: CursorState[] = [];
  const outs: CursorState[] = [];
  for (const f of clipFrames(clip)) {
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      session.camera.width,
      session.camera.height,
      f.t,
    );
    const raw = cursor.update(r.state === 'locked' ? r.body : null, f.t);
    const c = smooth ? smoother.update(raw, f.t) : raw;
    for (const e of dwell.update(c, targets, f.t)) if (e.type === 'select') selects++;
    if (!c.visible) {
      raws.length = 0;
      outs.length = 0;
      continue;
    }
    raws.push({ ...raw });
    outs.push({ ...c });
    if (raws.length > 9) {
      raws.shift();
      outs.shift();
    }
    if (raws.length < 9) continue;
    const first = raws[0] as CursorState;
    const last = raws[8] as CursorState;
    // "Still": the hand moved less than 4% of the screen over the last ~0.3 s.
    if (Math.hypot(last.x - first.x, last.y - first.y) > 0.04) continue;
    const [a, b, d] = outs.slice(-3) as [CursorState, CursorState, CursorState];
    sum += ((d.x - 2 * b.x + a.x) * W) ** 2 + ((d.y - 2 * b.y + a.y) * H) ** 2;
    n++;
  }
  return { shake: Math.sqrt(sum / Math.max(n, 1)), selects };
}

describe.each([
  '2026-10-29-adult1-playground-sidezone.pose.json.gz',
  '2026-10-28-adult1-playground-rtmpose.pose.json.gz',
])('cursor smoothing on %s', (file) => {
  it('halves the shake while holding still and keeps every selection', async () => {
    const before = await replay(file, false);
    const after = await replay(file, true);
    expect(after.shake).toBeLessThan(before.shake * 0.5);
    expect(after.selects).toBeGreaterThanOrEqual(before.selects);
  });
});
