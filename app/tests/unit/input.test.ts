import { describe, expect, it, vi } from 'vitest';
import { IntentBus } from '../../src/input/intent-bus';
import type { Intent } from '../../src/input/intents';
import { MouseAdapter } from '../../src/input/mouse-adapter';
import { TargetRegistry } from '../../src/input/targets';

const meta = { t: 0, source: 'replay' as const };

describe('IntentBus', () => {
  it('delivers intents to subscribers of that type and to onAny', () => {
    const bus = new IntentBus();
    const selects: string[] = [];
    const all: string[] = [];
    bus.on('select', (i) => selects.push(i.targetId));
    bus.onAny((i) => all.push(i.type));
    bus.emit({ type: 'select', targetId: 'ok', ...meta });
    bus.emit({ type: 'zoom', scale: 2, ...meta });
    expect(selects).toEqual(['ok']);
    expect(all).toEqual(['select', 'zoom']);
  });

  it('unsubscribes', () => {
    const bus = new IntentBus();
    let count = 0;
    const off = bus.on('zoom', () => count++);
    bus.emit({ type: 'zoom', scale: 2, ...meta });
    off();
    bus.emit({ type: 'zoom', scale: 2, ...meta });
    expect(count).toBe(1);
  });
});

describe('TargetRegistry', () => {
  it('hit-tests with padding and prefers the topmost target', () => {
    const targets = new TargetRegistry();
    targets.register('back', () => ({ x: 0, y: 0, w: 1, h: 1 }));
    targets.register('button', () => ({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }));
    expect(targets.hitTest(0.5, 0.5)).toBe('button');
    expect(targets.hitTest(0.1, 0.1)).toBe('back');
    expect(targets.hitTest(1.05, 0.5)).toBeNull();
    expect(targets.hitTest(1.05, 0.5, 0.1)).toBe('back');
  });

  it('skips hidden targets and forgets unregistered ones', () => {
    const targets = new TargetRegistry();
    const off = targets.register('a', () => ({ x: 0, y: 0, w: 1, h: 1 }));
    targets.register('hidden', () => null);
    off();
    expect(targets.hitTest(0.5, 0.5)).toBeNull();
  });
});

describe('MouseAdapter', () => {
  function setup() {
    const source = new EventTarget();
    const bus = new IntentBus();
    const targets = new TargetRegistry();
    targets.register('start', () => ({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }));
    const adapter = new MouseAdapter(source, bus, targets, {
      width: () => 1000,
      height: () => 500,
    });
    const seen: Intent[] = [];
    bus.onAny((i) => seen.push(i));
    const fire = (type: string, props: Record<string, number | string>) =>
      source.dispatchEvent(Object.assign(new Event(type), props));
    return { adapter, seen, fire };
  }

  it('does nothing until enabled', () => {
    const { seen, fire } = setup();
    fire('mousemove', { clientX: 500, clientY: 250 });
    expect(seen).toEqual([]);
  });

  it('turns moves into cursor intents and clicks into hit-tested selects', () => {
    const { adapter, seen, fire } = setup();
    adapter.enabled = true;
    fire('mousemove', { clientX: 500, clientY: 250 });
    fire('mousedown', { clientX: 500, clientY: 250, button: 0 });
    fire('mouseup', { clientX: 500, clientY: 250, button: 0 });
    expect(seen[0]).toMatchObject({
      type: 'cursor',
      x: 0.5,
      y: 0.5,
      visible: true,
      source: 'mouse',
    });
    expect(seen.at(-1)).toMatchObject({ type: 'select', targetId: 'start' });
  });

  it('turns a drag into draw start/move/end instead of a select', () => {
    const { adapter, seen, fire } = setup();
    adapter.enabled = true;
    fire('mousedown', { clientX: 100, clientY: 100, button: 0 });
    fire('mousemove', { clientX: 200, clientY: 100 });
    fire('mouseup', { clientX: 200, clientY: 100, button: 0 });
    const draws = seen.flatMap((i) => (i.type === 'draw' ? [i.phase] : []));
    expect(draws).toEqual(['start', 'move', 'end']);
    expect(seen.some((i) => i.type === 'select')).toBe(false);
  });

  it('slaps on a fast flick, not on a normal move', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const { adapter, seen, fire } = setup();
      adapter.enabled = true;
      const move = (widthsPerSec: number) => {
        for (let i = 0; i < 6; i++) {
          fire('mousemove', { clientX: 100 + widthsPerSec * 1000 * i * 0.033, clientY: 250 });
          vi.advanceTimersByTime(33);
        }
      };
      move(0.5);
      expect(seen.some((i) => i.type === 'slap')).toBe(false);
      vi.advanceTimersByTime(500);
      move(3);
      expect(seen.filter((i) => i.type === 'slap').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps the wheel to zoom and arrows to swipe, and hides the cursor when disabled', () => {
    const { adapter, seen, fire } = setup();
    adapter.enabled = true;
    fire('wheel', { deltaY: -100 });
    fire('keydown', { key: 'ArrowLeft' });
    adapter.enabled = false;
    expect(seen[0]).toMatchObject({ type: 'zoom', scale: 1.1 });
    expect(seen[1]).toMatchObject({ type: 'swipe', dir: 'left' });
    expect(seen[2]).toMatchObject({ type: 'cursor', visible: false });
  });
});
