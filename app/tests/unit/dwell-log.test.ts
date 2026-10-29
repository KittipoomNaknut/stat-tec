import { describe, expect, it } from 'vitest';
import { DwellAttemptLog, distanceOutside } from '../../src/debug/dwell-log';
import { DwellDetector } from '../../src/gestures/dwell';
import { IntentBus } from '../../src/input/intent-bus';
import { TargetRegistry } from '../../src/input/targets';

const FRAME = 33;
const ON = { visible: true, hand: 'right' as const, x: 0.5, y: 0.5 };

/** Runs the real DwellDetector over a cursor script and feeds the log through the bus. */
function run(script: { cursor: typeof ON; frames: number }[]) {
  const bus = new IntentBus();
  const targets = new TargetRegistry();
  targets.register('button', () => ({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }));
  const log = new DwellAttemptLog(bus, targets);
  const dwell = new DwellDetector();
  // The button is already on screen before the script starts (not popping up under the cursor).
  dwell.update({ ...ON, visible: false }, targets, -FRAME);
  let t = 0;
  for (const step of script) {
    for (let i = 0; i < step.frames; i++, t += FRAME) {
      const meta = { t, source: 'replay' as const };
      bus.emit({ type: 'cursor', ...step.cursor, ...meta });
      for (const e of dwell.update(step.cursor, targets, t)) bus.emit({ ...e, ...meta });
    }
  }
  return log;
}

describe('DwellAttemptLog', () => {
  it('records a successful hold', () => {
    const log = run([{ cursor: ON, frames: 45 }]);
    expect(log.attempts).toHaveLength(1);
    expect(log.attempts[0]).toMatchObject({ outcome: 'selected', breakOff: null });
  });

  it('classifies drifting off the button, with how far it went', () => {
    const log = run([
      { cursor: ON, frames: 20 },
      { cursor: { ...ON, x: 0.7 }, frames: 10 },
    ]);
    expect(log.attempts[0]).toMatchObject({ outcome: 'left-target' });
    expect(log.attempts[0]?.breakOff?.outside).toBeCloseTo(0.1);
  });

  it('classifies the cursor disappearing mid-hold', () => {
    const log = run([
      { cursor: ON, frames: 20 },
      { cursor: { ...ON, visible: false }, frames: 10 },
    ]);
    expect(log.attempts[0]).toMatchObject({ outcome: 'cursor-hidden' });
  });

  it('treats a brief pass over a button as passing by, not a failure', () => {
    const log = run([
      { cursor: ON, frames: 5 },
      { cursor: { ...ON, x: 0.9 }, frames: 10 },
    ]);
    expect(log.summary()).toMatchObject({ 'passed-by': 1, 'left-target': 0 });
  });

  it('measures distance outside a rect', () => {
    const r = { x: 0, y: 0, w: 1, h: 1 };
    expect(distanceOutside(r, 0.5, 0.5)).toBe(0);
    expect(distanceOutside(r, 1.3, 1.4)).toBeCloseTo(0.5);
  });
});
