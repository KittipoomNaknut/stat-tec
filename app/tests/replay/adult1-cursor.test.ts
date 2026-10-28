/**
 * Cursor and dwell on the real recording: pointing must move the cursor across the screen and
 * dwell must select; standing still or fidgeting (scratching head, touching face) must not.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { perceptionDefaults } from '../../src/config/perception';
import type { PoseSession } from '../../src/debug/pose-recording';
import { CursorTracker, type CursorState } from '../../src/gestures/cursor';
import { DwellDetector } from '../../src/gestures/dwell';
import { TargetRegistry } from '../../src/input/targets';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';

const FILE = '2026-10-28-adult1-2m-indoor.pose.json.gz';

let session: PoseSession;
beforeAll(async () => {
  session = await loadSession(FILE);
});

function cursorTrack(clipId: string) {
  const clip = session.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`missing clip ${clipId}`);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const cursor = new CursorTracker();
  const out: (CursorState & { t: number; locked: boolean })[] = [];
  for (const f of clipFrames(clip)) {
    const r = tracker.process(
      f.landmarks,
      f.poseCount,
      session.camera.width,
      session.camera.height,
      f.t,
    );
    const locked = r.state === 'locked';
    out.push({ ...cursor.update(locked ? r.body : null, f.t), t: f.t, locked });
  }
  return out;
}

/**
 * Share of frames with a visible cursor, counted from when the player starts pointing — clips
 * begin with a couple of seconds of reaction time with the hands still down.
 */
const visibleShare = (track: ReturnType<typeof cursorTrack>) => {
  const start = track.findIndex((f) => f.visible);
  const active = track.slice(Math.max(start, 0)).filter((f) => f.locked);
  return active.filter((f) => f.visible).length / Math.max(active.length, 1);
};

const span = (values: number[]) => Math.max(...values) - Math.min(...values);

describe(`cursor replay ${FILE}`, () => {
  it.each(['idle-stand', 'idle-fidget'])('%s: cursor never appears', (id) => {
    const shown = cursorTrack(id)
      .filter((f) => f.visible)
      .map((f) => f.t.toFixed(0));
    expect(shown).toEqual([]);
  });

  it.each([
    ['point-right-sweep', 'right'],
    ['point-left-sweep', 'left'],
  ] as const)('%s: cursor follows the %s hand across most of the screen', (id, hand) => {
    const track = cursorTrack(id);
    const shown = track.filter((f) => f.visible);
    expect(visibleShare(track)).toBeGreaterThan(0.85);
    expect(shown.filter((f) => f.hand === hand).length / shown.length).toBeGreaterThan(0.9);
    expect(span(shown.map((f) => f.x))).toBeGreaterThan(0.7);
    expect(span(shown.map((f) => f.y))).toBeGreaterThan(0.4);
  });

  it('point-hold: holding on a button selects it once per hold', () => {
    const track = cursorTrack('point-hold');
    const shown = track.filter((f) => f.visible);
    const mid = shown[Math.floor(shown.length / 2)];
    if (!mid) throw new Error('cursor never visible');
    // A button roughly where the player was pointing — about the size of a large kiosk button.
    const targets = new TargetRegistry();
    targets.register('button', () => ({ x: mid.x - 0.1, y: mid.y - 0.1, w: 0.2, h: 0.2 }));
    const dwell = new DwellDetector();
    const selects = track
      .flatMap((f) => dwell.update(f, targets, f.t))
      .filter((e) => e.type === 'select');
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(selects.length).toBeLessThanOrEqual(2);
  });

  it('idle-fidget: a screen-filling button is never selected', () => {
    const targets = new TargetRegistry();
    targets.register('everything', () => ({ x: 0, y: 0, w: 1, h: 1 }));
    const dwell = new DwellDetector();
    const selects = cursorTrack('idle-fidget')
      .flatMap((f) => dwell.update(f, targets, f.t))
      .filter((e) => e.type === 'select');
    expect(selects).toEqual([]);
  });
});
