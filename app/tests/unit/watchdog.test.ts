import { describe, expect, it } from 'vitest';
import { WATCHDOG, Watchdog } from '../../src/core/watchdog';

function setup() {
  const calls: string[] = [];
  const dog = new Watchdog({
    reset: () => calls.push('reset'),
    reload: (r) => calls.push(`reload:${r}`),
    onStall: (s) => calls.push(s ? 'stall' : 'recover'),
  });
  return { dog, calls };
}

describe('Watchdog', () => {
  it('resets on an error, reloads on the third within a minute', () => {
    const { dog, calls } = setup();
    dog.error('a', 0);
    dog.error('b', 10_000);
    expect(calls).toEqual(['reset', 'reset']);
    dog.error('c', 20_000);
    expect(calls.at(-1)).toMatch(/^reload:3 errors/);
  });

  it('forgets errors older than the window', () => {
    const { dog, calls } = setup();
    dog.error('a', 0);
    dog.error('b', 1000);
    dog.error('c', WATCHDOG.errorWindowMs + 2000);
    expect(calls).toEqual(['reset', 'reset', 'reset']);
  });

  it('flags a silent perception pipeline, clears it on the next frame', () => {
    const { dog, calls } = setup();
    dog.check(100_000); // never had a frame: nothing to watch
    dog.frame(0);
    dog.check(WATCHDOG.stallMs);
    expect(calls).toEqual([]);
    dog.check(WATCHDOG.stallMs + 1);
    expect(calls).toEqual(['stall']);
    expect(dog.stalled).toBe(true);
    dog.frame(5000);
    expect(calls).toEqual(['stall', 'recover']);
  });

  it('reloads once if perception stays silent', () => {
    const { dog, calls } = setup();
    dog.frame(0);
    dog.check(3000);
    dog.check(3000 + WATCHDOG.stallReloadMs + 1);
    dog.check(3000 + WATCHDOG.stallReloadMs + 2);
    expect(calls.filter((c) => c.startsWith('reload'))).toEqual(['reload:perception silent']);
  });

  it('reloads at idle only when the heap is too big', () => {
    const { dog, calls } = setup();
    dog.idle(null);
    dog.idle(200 * 1024 ** 2);
    expect(calls).toEqual([]);
    dog.idle(2 * 1024 ** 3);
    expect(calls).toEqual(['reload:heap 2048 MB']);
  });
});
