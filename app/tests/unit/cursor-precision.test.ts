import { describe, expect, it } from 'vitest';
import { gestureConfig } from '../../src/config/gestures';
import type { CursorState } from '../../src/gestures/cursor';
import { CursorPrecision } from '../../src/gestures/cursor-precision';

const FRAME = 1000 / 30;
const at = (x: number, y = 0.5, visible = true, hand: 'left' | 'right' = 'right'): CursorState => ({
  x,
  y,
  visible,
  hand,
});

/** Moves the hand from x0 to x1 at a steady speed (screen widths per second); returns the cursor. */
function move(p: CursorPrecision, x0: number, x1: number, widthsPerSec: number, t0 = 0) {
  const frames = Math.max(1, Math.round((Math.abs(x1 - x0) / widthsPerSec) * 30));
  let out = at(x0);
  for (let i = 0; i <= frames; i++)
    out = p.update(at(x0 + ((x1 - x0) * i) / frames), t0 + i * FRAME);
  return { out, t: t0 + frames * FRAME };
}

describe('CursorPrecision', () => {
  it('starts on the hand when the cursor appears', () => {
    const p = new CursorPrecision();
    expect(p.update(at(0.3, 0.6), 0)).toMatchObject({ x: 0.3, y: 0.6 });
  });

  it('moves the cursor by only a share of a slow drift', () => {
    const p = new CursorPrecision();
    // 2% of the screen over a second: a held hand swaying
    const { out } = move(p, 0.5, 0.52, 0.02);
    expect(out.x - 0.5).toBeLessThan(0.02 * 0.6);
    expect(out.x - 0.5).toBeGreaterThan(0.02 * 0.25);
  });

  it('follows a fast move all the way and ends on the hand', () => {
    const p = new CursorPrecision();
    p.update(at(0.2), 0);
    const { out, t } = move(p, 0.2, 0.8, 2);
    expect(out.x).toBeGreaterThan(0.75);
    // A moment after stopping, the gap left by the deceleration has mostly closed
    let settled = out;
    for (let i = 1; i <= 30; i++) settled = p.update(at(0.8), t + i * FRAME);
    expect(Math.abs(settled.x - 0.8)).toBeLessThan(0.02);
  });

  it('lets the gap from slow moves close over a couple of seconds', () => {
    const p = new CursorPrecision();
    const { t } = move(p, 0.5, 0.55, 0.05);
    let out = at(0.55);
    for (let i = 1; i <= 150; i++) out = p.update(at(0.55), t + i * FRAME); // 5 s
    expect(Math.abs(out.x - 0.55)).toBeLessThan(0.005);
  });

  it('stays on the screen and restarts on the new hand when hands switch', () => {
    const p = new CursorPrecision();
    move(p, 0.9, 1, 3);
    expect(p.update(at(1), 1000).x).toBeLessThanOrEqual(1);
    expect(p.update(at(0.2, 0.4, true, 'left'), 1033)).toMatchObject({ x: 0.2, y: 0.4 });
    expect(p.update(at(0.2, 0.4, false), 1066).visible).toBe(false);
    expect(p.update(at(0.7, 0.7), 1100)).toMatchObject({ x: 0.7, y: 0.7 });
  });

  it('never trails a slow steady drag by more than maxGap', () => {
    const p = new CursorPrecision();
    // 100 px/s for 3 s: a careful slow drag, slow enough to get the low gain throughout
    let worst = 0;
    p.update(at(0.2), 0);
    for (let i = 1; i <= 90; i++) {
      const t = i * FRAME;
      const hand = 0.2 + (100 / 1920) * (t / 1000);
      const out = p.update(at(hand), t);
      worst = Math.max(worst, (hand - out.x) * (16 / 9));
    }
    expect(worst).toBeLessThanOrEqual(gestureConfig.precision.maxGap + 1e-9);
    expect(worst).toBeGreaterThan(gestureConfig.precision.maxGap * 0.5);
  });

  it('passes the hand straight through when switched off (drawing)', () => {
    const p = new CursorPrecision();
    p.update(at(0.5), 0);
    p.update(at(0.51), FRAME);
    p.enabled = false;
    expect(p.update(at(0.52), 2 * FRAME)).toMatchObject({ x: 0.52 });
    p.enabled = true;
    expect(p.update(at(0.6), 3 * FRAME)).toMatchObject({ x: 0.6 });
  });
});
