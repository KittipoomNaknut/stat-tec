import { describe, expect, it } from 'vitest';
import { gestureConfig } from '../../src/config/gestures';
import { CursorTracker } from '../../src/gestures/cursor';
import { DwellDetector } from '../../src/gestures/dwell';
import { GestureEngine } from '../../src/gestures/engine';
import { IntentBus } from '../../src/input/intent-bus';
import type { Intent } from '../../src/input/intents';
import { TargetRegistry } from '../../src/input/targets';
import { Landmark } from '../../src/perception/landmarks';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../../src/perception/protocol';

type Point = [number, number];

/**
 * Body-space pose: shoulders ±0.5, hips at y=1.5, wrists where asked (x is screen-right).
 * Elbows sit halfway along each arm (a straight arm) unless given.
 */
function body(
  right: Point | null,
  left: Point | null = null,
  elbows: { right?: Point; left?: Point } = {},
) {
  const b = new Float32Array(LANDMARK_COUNT * LANDMARK_STRIDE);
  const set = (i: number, x: number, y: number, v = 1) => {
    b.set([x, y, 0, v], i * LANDMARK_STRIDE);
  };
  set(Landmark.RIGHT_SHOULDER, 0.5, 0);
  set(Landmark.LEFT_SHOULDER, -0.5, 0);
  set(Landmark.RIGHT_HIP, 0.4, 1.5);
  set(Landmark.LEFT_HIP, -0.4, 1.5);
  set(Landmark.NOSE, 0, -0.8);
  const rw: Point = right ?? [0.6, 1.5];
  const lw: Point = left ?? [-0.6, 1.5];
  set(Landmark.RIGHT_WRIST, ...rw);
  set(Landmark.LEFT_WRIST, ...lw);
  set(Landmark.RIGHT_ELBOW, ...(elbows.right ?? [(0.5 + rw[0]) / 2, rw[1] / 2]));
  set(Landmark.LEFT_ELBOW, ...(elbows.left ?? [(-0.5 + lw[0]) / 2, lw[1] / 2]));
  return b;
}

/** Holds the pose long enough for the cursor to activate, then returns the state. */
function point(c: CursorTracker, b: Float32Array, t0 = 0) {
  c.update(b, t0);
  return c.update(b, t0 + 200);
}

describe('CursorTracker', () => {
  it('stays hidden with hands down', () => {
    expect(point(new CursorTracker(), body(null)).visible).toBe(false);
  });

  it('ignores a raised but bent arm (touching the face)', () => {
    // Elbow out to the side and low: the forearm folds back up to the face.
    const face = body([0.3, -0.5], null, { right: [1.1, 0.6] });
    expect(point(new CursorTracker(), face).visible).toBe(false);
  });

  it('ignores crossed arms even when the wrist is far from its shoulder', () => {
    // Right wrist across the chest near the left side: 1.1 SW from its shoulder, elbow bent.
    const crossed = body([-0.6, -0.2], null, { right: [0.2, 0.7] });
    expect(point(new CursorTracker(), crossed).visible).toBe(false);
  });

  it('keeps pointing with a foreshortened but straight arm (pointing at the camera)', () => {
    const c = new CursorTracker();
    expect(point(c, body([1.4, -1.0])).visible).toBe(true);
    // Arm now looks 0.35 SW long but is still a straight line.
    expect(c.update(body([0.75, -0.25]), 300).visible).toBe(true);
  });

  it('maps the interaction zone beside the shoulder onto the screen', () => {
    const { box } = gestureConfig.cursor;
    const c = new CursorTracker();
    // Outer top corner of the right hand's zone = screen top-right.
    const corner = point(c, body([box.x1, box.y0]));
    expect(corner).toMatchObject({ visible: true, hand: 'right' });
    expect(corner.x).toBeCloseTo(1, 5);
    expect(corner.y).toBeCloseTo(0, 5);
    // Middle of the zone = middle of the screen; the arm reaches out, not toward the camera.
    const mid = c.update(body([(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2]), 300);
    expect(mid.x).toBeCloseTo(0.5, 4);
    expect(mid.y).toBeCloseTo(0.5, 4);
  });

  it('keeps the screen center away from the arm-toward-camera pose', () => {
    // Research 010: a wrist on its own shoulder (arm pointing at the camera) must not map to the
    // middle of the screen.
    const { box } = gestureConfig.cursor;
    const shoulderX = (0.5 - box.x0) / (box.x1 - box.x0);
    const shoulderY = (0 - box.y0) / (box.y1 - box.y0);
    expect(Math.hypot(shoulderX - 0.5, shoulderY - 0.5)).toBeGreaterThan(0.4);
  });

  it('mirrors the zone for the left hand', () => {
    const { box } = gestureConfig.cursor;
    const c = new CursorTracker();
    // The left hand's outer top corner = screen top-left.
    const corner = point(c, body(null, [-box.x1, box.y0]));
    expect(corner.hand).toBe('left');
    expect(corner.x).toBeCloseTo(0, 5);
    expect(corner.y).toBeCloseTo(0, 5);
  });

  it('waits 100 ms of pointing before showing the cursor', () => {
    const c = new CursorTracker();
    expect(c.update(body([1.4, -1.0]), 0).visible).toBe(false);
    expect(c.update(body([1.4, -1.0]), 50).visible).toBe(false);
    expect(c.update(body([1.4, -1.0]), 120).visible).toBe(true);
  });

  it('keeps the current hand while it still points', () => {
    const c = new CursorTracker();
    point(c, body([1.4, -0.5]));
    expect(c.update(body([1.4, -0.5], [-1.2, -1.2]), 300).hand).toBe('right');
  });
});

describe('DwellDetector', () => {
  const targets = new TargetRegistry();
  targets.register('ok', () => ({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }));
  const on = { visible: true, hand: 'right' as const, x: 0.5, y: 0.5 };
  const off = { ...on, x: 0.9 };
  /** A detector that has already seen the target on screen (cursor elsewhere). */
  const primed = () => {
    const d = new DwellDetector();
    d.update(off, targets, -100);
    return d;
  };

  it('selects after holding 1.2 s, then rests', () => {
    const d = primed();
    const events = [];
    for (let t = 0; t <= 2000; t += 33) events.push(...d.update(on, targets, t));
    const selects = events.filter((e) => e.type === 'select');
    expect(selects).toHaveLength(1);
  });

  it('forgives a short slip but resets after a long one', () => {
    const d = primed();
    d.update(on, targets, 0);
    d.update(on, targets, 600);
    d.update(off, targets, 700);
    expect(d.update(on, targets, 1250).at(-1)).toMatchObject({ type: 'select' });

    const e = primed();
    e.update(on, targets, 0);
    e.update(on, targets, 600);
    expect(e.update(off, targets, 900)).toEqual([{ type: 'dwell', targetId: 'ok', progress: 0 }]);
    expect(e.update(on, targets, 1250).some((x) => x.type === 'select')).toBe(false);
  });

  it('ignores a target that appears under the cursor until the cursor leaves it', () => {
    const local = new TargetRegistry();
    let shown = false;
    local.register('new', () => (shown ? { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } : null));
    const d = new DwellDetector();
    d.update(on, local, 0);
    shown = true; // pops up right under a hand still raised from the last choice
    const events = [];
    for (let t = 33; t <= 2000; t += 33) events.push(...d.update(on, local, t));
    expect(events).toEqual([]);
    // leave and come back: now it is a deliberate dwell
    d.update(off, local, 2100);
    for (let t = 2133; t <= 3500; t += 33) events.push(...d.update(on, local, t));
    expect(events.filter((e) => e.type === 'select')).toHaveLength(1);
  });

  it('never selects while the cursor is hidden', () => {
    const d = new DwellDetector();
    const events = [];
    for (let t = 0; t <= 2000; t += 33)
      events.push(...d.update({ ...on, visible: false }, targets, t));
    expect(events).toEqual([]);
  });
});

describe('GestureEngine presence', () => {
  it('emits enter, lost, return and leave on lock transitions', () => {
    const bus = new IntentBus();
    const seen: string[] = [];
    bus.on('presence', (i: Extract<Intent, { type: 'presence' }>) => seen.push(i.state));
    const engine = new GestureEngine(bus, new TargetRegistry(), 'replay');
    const steps = [
      ['candidate', 0],
      ['locked', 1],
      ['lost', 1],
      ['locked', 1],
      ['lost', 1],
      ['searching', 1],
      ['locked', 2],
    ] as const;
    steps.forEach(([lock, playerId], t) => {
      engine.update({ lock, playerId, body: null }, t);
    });
    expect(seen).toEqual(['enter', 'lost', 'return', 'lost', 'leave', 'enter']);
  });
});
