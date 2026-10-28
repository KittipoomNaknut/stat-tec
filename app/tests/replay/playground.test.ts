/**
 * Research 010: the owner's playground session with the side interaction zone, replayed with the
 * same buttons. The replay reproduced the live log exactly (23 selects, per button), so it guards
 * the whole pipeline: no button may get fewer selections than the owner achieved live.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cursorConfigFor } from '../../src/config/gestures';
import { perceptionDefaults } from '../../src/config/perception';
import { CursorTracker } from '../../src/gestures/cursor';
import { DwellDetector } from '../../src/gestures/dwell';
import { TargetRegistry, type Rect } from '../../src/input/targets';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';

interface AttemptLog {
  targets: Record<string, Rect>;
  attempts: { targetId: string; outcome: string }[];
}

function readLog(file: string): AttemptLog {
  const url = new URL(`../fixtures/playground/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as AttemptLog;
}

function count(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

describe('playground replay 2026-10-29 (side interaction zone, RTMPose)', () => {
  it('selects every button at least as often as the owner did live', async () => {
    const log = readLog('2026-10-29-adult1-sidezone.attempts.json');
    const session = await loadSession('2026-10-29-adult1-playground-sidezone.pose.json.gz');
    const clip = session.clips[0];
    if (!clip) throw new Error('empty session');

    const targets = new TargetRegistry();
    for (const [id, rect] of Object.entries(log.targets)) targets.register(id, () => rect);
    const tracker = new PoseTracker(perceptionDefaults.filter);
    const cursor = new CursorTracker(cursorConfigFor('server'));
    const dwell = new DwellDetector();
    const selected: string[] = [];
    for (const f of clipFrames(clip)) {
      const r = tracker.process(
        f.landmarks,
        f.poseCount,
        session.camera.width,
        session.camera.height,
        f.t,
      );
      const c = cursor.update(r.state === 'locked' ? r.body : null, f.t);
      for (const e of dwell.update(c, targets, f.t))
        if (e.type === 'select') selected.push(e.targetId);
    }

    const live = count(log.attempts.filter((a) => a.outcome === 'selected').map((a) => a.targetId));
    const replay = count(selected);
    for (const [id, n] of Object.entries(live))
      expect(replay[id] ?? 0, id).toBeGreaterThanOrEqual(n);
    // The button in front of the body was never selected before the side zone (round 1).
    expect(replay['button-5'] ?? 0).toBeGreaterThanOrEqual(3);
  });
});
