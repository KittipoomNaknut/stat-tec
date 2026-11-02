/**
 * The cursor lab report (research 022): `CURSOR_LAB=1 pnpm exec vitest run cursor-lab --silent=false`
 * prints every stage of the cursor chain on the owner's playground sessions. Skipped otherwise.
 */
import { describe, it } from 'vitest';
import { cursorConfigFor } from '../../src/config/gestures';
import { CursorTracker } from '../../src/gestures/cursor';
import { CursorPrecision } from '../../src/gestures/cursor-precision';
import { CursorSmoother } from '../../src/gestures/cursor-smoother';
import { format, measure, selectDelay, SESSIONS, type CursorVariant } from '../support/cursor-lab';

const stages: [string, CursorVariant][] = [
  [
    'mapped (CursorTracker)',
    () => {
      const c = new CursorTracker(cursorConfigFor('server'));
      return (r, t) => c.update(r.state === 'locked' ? r.body : null, t);
    },
  ],
  [
    '+ smoothed (015)',
    () => {
      const c = new CursorTracker(cursorConfigFor('server'));
      const s = new CursorSmoother();
      return (r, t) => s.update(c.update(r.state === 'locked' ? r.body : null, t), t);
    },
  ],
  [
    '+ precision (022)',
    () => {
      const c = new CursorTracker(cursorConfigFor('server'));
      const s = new CursorSmoother();
      const p = new CursorPrecision();
      return (r, t) => p.update(s.update(c.update(r.state === 'locked' ? r.body : null, t), t), t);
    },
  ],
];

describe.runIf(process.env['CURSOR_LAB'])('cursor lab report', () => {
  it.each(SESSIONS)(
    '$pose',
    async (session) => {
      const results = [];
      for (const [name, variant] of stages)
        results.push([name, await measure(session, variant)] as const);
      const reference = results[1]?.[1];
      console.log(session.pose);
      for (const [name, m] of results) {
        const delay = reference ? selectDelay(m, reference) : 0;
        console.log(`${format(name, m)}  delay ${delay.toFixed(0)}ms`);
      }
    },
    120_000,
  );
});
