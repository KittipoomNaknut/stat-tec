/**
 * Cursor and dwell on the real recording: pointing must move the cursor across the screen and
 * dwell must select; standing still or fidgeting (scratching head, touching face) must not.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { perceptionDefaults } from '../../src/config/perception';
import type { PoseSession } from '../../src/debug/pose-recording';
import { cursorConfigFor } from '../../src/config/gestures';
import { CursorTracker, type CursorState } from '../../src/gestures/cursor';
import type { PerceptionSource } from '../../src/perception/protocol';
import { DwellDetector } from '../../src/gestures/dwell';
import { TargetRegistry } from '../../src/input/targets';
import { PoseTracker } from '../../src/perception/tracker';
import { clipFrames, loadSession } from '../support/pose-session';
import { SOLO_SESSIONS } from '../support/sessions';

let session: PoseSession;

function cursorTrack(clipId: string, source: PerceptionSource) {
  const clip = session.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`missing clip ${clipId}`);
  const tracker = new PoseTracker(perceptionDefaults.filter);
  const cursor = new CursorTracker(cursorConfigFor(source));
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

describe.each(SOLO_SESSIONS)('cursor replay $file', ({ file: FILE, source }) => {
  beforeAll(async () => {
    session = await loadSession(FILE);
  });

  it.each(['idle-stand', 'idle-fidget'])('%s: cursor never appears', (id) => {
    const shown = cursorTrack(id, source)
      .filter((f) => f.visible)
      .map((f) => f.t.toFixed(0));
    expect(shown).toEqual([]);
  });

  it.each([
    ['point-right-sweep', 'right'],
    ['point-left-sweep', 'left'],
  ] as const)('%s: cursor follows the %s hand across most of the screen', (id, hand) => {
    const track = cursorTrack(id, source);
    const shown = track.filter((f) => f.visible);
    // MediaPipe session 0.97/0.94; RTMPose 0.77/0.95 — in the RTMPose right sweep the owner
    // dropped the hand to hip level (below the screen's bottom edge), which releases the cursor
    // by design: releasing any lower would keep it on when the arm hangs (wrist 0.03 SW from hips).
    expect(visibleShare(track)).toBeGreaterThan(0.75);
    expect(shown.filter((f) => f.hand === hand).length / shown.length).toBeGreaterThan(0.9);
    expect(span(shown.map((f) => f.x))).toBeGreaterThan(0.7);
    expect(span(shown.map((f) => f.y))).toBeGreaterThan(0.4);
  });

  it('point-hold: holding on a button selects it once per hold', () => {
    const track = cursorTrack('point-hold', source);
    // Put the button where the player held steadiest: the longest run of visible frames staying
    // within ±0.1 of its start. (The middle of all visible frames can land on a moving hand.)
    let hold = { start: -1, length: 0 };
    for (let i = 0; i < track.length; i++) {
      const a = track[i];
      if (!a?.visible) continue;
      let j = i;
      for (
        let f = track[j];
        f?.visible && Math.abs(f.x - a.x) < 0.1 && Math.abs(f.y - a.y) < 0.1;
        f = track[++j]
      );
      if (j - i > hold.length) hold = { start: i, length: j - i };
    }
    const held = track.slice(hold.start, hold.start + hold.length);
    expect(held.length / 30).toBeGreaterThan(1.2); // the recording really contains a 1.2 s hold
    const cx = held.reduce((sum, f) => sum + f.x, 0) / held.length;
    const cy = held.reduce((sum, f) => sum + f.y, 0) / held.length;
    // About the size of a large kiosk button.
    const targets = new TargetRegistry();
    targets.register('button', () => ({ x: cx - 0.1, y: cy - 0.1, w: 0.2, h: 0.2 }));
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
    const selects = cursorTrack('idle-fidget', source)
      .flatMap((f) => dwell.update(f, targets, f.t))
      .filter((e) => e.type === 'select');
    expect(selects).toEqual([]);
  });
});
