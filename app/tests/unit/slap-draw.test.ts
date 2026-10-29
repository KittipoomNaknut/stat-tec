import { describe, expect, it } from 'vitest';
import type { CursorState } from '../../src/gestures/cursor';
import { DrawDetector } from '../../src/gestures/draw';
import { SlapDetector } from '../../src/gestures/slap';

const FRAME = 1000 / 30;

function at(x: number, y = 0.5, visible = true, hand: 'left' | 'right' = 'right'): CursorState {
  return { x, y, visible, hand };
}

/** Feeds a cursor moving sideways at `widthsPerSec`; returns how many frames slapped. */
function sweep(d: SlapDetector, widthsPerSec: number, frames = 15, t0 = 0): number {
  let hits = 0;
  for (let i = 0; i < frames; i++) {
    const x = 0.1 + (widthsPerSec * i * FRAME) / 1000;
    if (d.update(at(x), t0 + i * FRAME)) hits++;
  }
  return hits;
}

describe('SlapDetector', () => {
  it('ignores a cursor moving at button-pointing speed', () => {
    // 1 screen width/s ≈ 1.8 heights/s: a quick move to a button.
    expect(sweep(new SlapDetector(), 1)).toBe(0);
  });

  it('fires on every frame of a fast sweep once the window fills', () => {
    // 3 widths/s ≈ 5.3 heights/s: a deliberate swipe.
    const d = new SlapDetector();
    const hits = sweep(d, 3);
    expect(hits).toBeGreaterThanOrEqual(12);
    const e = d.update(at(0.1 + (3 * 15 * FRAME) / 1000), 15 * FRAME);
    expect(e?.speed).toBeCloseTo(3 * (16 / 9), 1);
  });

  it('keeps slapping while the sweep slows a little (hysteresis)', () => {
    const d = new SlapDetector();
    sweep(d, 3, 10);
    // 1.6 widths/s ≈ 2.8 heights/s: below start (3.5), above keep (2.5).
    let x = 0.1 + (3 * 9 * FRAME) / 1000;
    let kept = 0;
    for (let i = 10; i < 20; i++) {
      x += (1.6 * FRAME) / 1000;
      if (d.update(at(x), i * FRAME)) kept++;
    }
    expect(kept).toBeGreaterThanOrEqual(8);
  });

  it('does not slap from a jump when the cursor reappears or changes hand', () => {
    const d = new SlapDetector();
    d.update(at(0.1), 0);
    d.update(at(0.1, 0.5, false), FRAME);
    expect(d.update(at(0.9), 2 * FRAME)).toBeNull();
    expect(d.update(at(0.9), 3 * FRAME)).toBeNull();
    expect(d.update(at(0.1, 0.5, true, 'left'), 4 * FRAME)).toBeNull();
    expect(d.update(at(0.1, 0.5, true, 'left'), 5 * FRAME)).toBeNull();
  });
});

describe('DrawDetector', () => {
  it('draws while the cursor shows and lifts the pen when it hides', () => {
    const d = new DrawDetector();
    expect(d.update(at(0.2, 0.3, false))).toEqual([]);
    expect(d.update(at(0.2, 0.3)).map((e) => e.phase)).toEqual(['start', 'move']);
    expect(d.update(at(0.3, 0.4)).map((e) => e.phase)).toEqual(['move']);
    const end = d.update(at(0, 0, false));
    expect(end).toEqual([{ type: 'draw', phase: 'end', x: 0.3, y: 0.4 }]);
  });

  it('starts a new stroke when the other hand takes over', () => {
    const d = new DrawDetector();
    d.update(at(0.2));
    const phases = d.update(at(0.7, 0.5, true, 'left')).map((e) => e.phase);
    expect(phases).toEqual(['end', 'start', 'move']);
  });
});
