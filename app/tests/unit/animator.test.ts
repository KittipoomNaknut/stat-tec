import { describe, expect, it } from 'vitest';
import { Animator, ease } from '../../src/viz/animator';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Animator', () => {
  it('advances only with update() and lands exactly on 1', async () => {
    const a = new Animator();
    const seen: number[] = [];
    let done = false;
    void a.tween(100, (t) => seen.push(t), { ease: ease.linear }).then(() => (done = true));
    a.update(50);
    expect(seen.at(-1)).toBeCloseTo(0.5);
    a.update(80);
    await flush();
    expect(seen.at(-1)).toBe(1);
    expect(done).toBe(true);
  });

  it('runs choreography in order and honours delays', async () => {
    const a = new Animator();
    const log: string[] = [];
    const run = (async () => {
      await a.tween(100, () => undefined);
      log.push('first');
      await a.tween(100, () => undefined, { delay: 50 });
      log.push('second');
    })();
    for (let i = 0; i < 10; i++) {
      a.update(50);
      await flush();
    }
    await run;
    expect(log).toEqual(['first', 'second']);
  });

  it('cancel stops all work', async () => {
    const a = new Animator();
    let calls = 0;
    void a.tween(100, () => calls++);
    a.cancel();
    a.update(200);
    await flush();
    expect(calls).toBe(0);
  });
});
