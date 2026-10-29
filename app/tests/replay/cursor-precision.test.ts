/**
 * Research 022: CursorPrecision on the owner's playground sessions, measured with the cursor lab
 * against the shipped chain without it. Locks in the gains without paying for them in selects,
 * timing or reach.
 */
import { describe, expect, it } from 'vitest';
import { cursorConfigFor } from '../../src/config/gestures';
import { CursorTracker } from '../../src/gestures/cursor';
import { CursorPrecision } from '../../src/gestures/cursor-precision';
import { CursorSmoother } from '../../src/gestures/cursor-smoother';
import { measure, selectDelay, SESSIONS, type CursorVariant } from '../support/cursor-lab';

const smoothed: CursorVariant = () => {
  const c = new CursorTracker(cursorConfigFor('server'));
  const s = new CursorSmoother();
  return (r, t) => s.update(c.update(r.state === 'locked' ? r.body : null, t), t);
};

const precise: CursorVariant = () => {
  const c = new CursorTracker(cursorConfigFor('server'));
  const s = new CursorSmoother();
  const p = new CursorPrecision();
  return (r, t) => p.update(s.update(c.update(r.state === 'locked' ? r.body : null, t), t), t);
};

describe.each(SESSIONS)('cursor precision on $pose', (session) => {
  it('steadies the held cursor without costing selects, timing or reach', async () => {
    const before = await measure(session, smoothed);
    const after = await measure(session, precise);
    expect(after.shake).toBeLessThan(before.shake * 0.7);
    expect(after.steady).toBeLessThan(before.steady * 0.75);
    expect(after.selects).toBeGreaterThanOrEqual(before.selects);
    expect(Math.abs(selectDelay(after, before))).toBeLessThan(50);
    expect(after.edge).toBeGreaterThanOrEqual(0.99);
    // The cursor may stray from the hand a little while it holds, never far
    expect(after.offset).toBeLessThan(45);
  });
});
