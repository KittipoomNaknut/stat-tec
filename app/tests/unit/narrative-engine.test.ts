import { describe, expect, it } from 'vitest';
import { NarrativeEngine, type NarrativeHost } from '../../src/narrative/engine';
import type { Beat } from '../../src/narrative/schema';
import { plain } from '../../src/narrative/template';
import { story } from '../../src/narrative/story';

const config = { charsPerSec: 10, holdMinMs: 1000, holdPerCharMs: 0, cueMs: 500 };

function host(vars: Record<string, string | number | boolean> = {}, blockCues: string[] = []) {
  const log: string[] = [];
  const h: NarrativeHost = {
    vars: () => vars,
    onBeat: (b) => log.push(`beat:${b.type}`),
    onCue: (c) => {
      log.push(`cue:${c}`);
      return blockCues.includes(c);
    },
    onError: (e) => log.push(`error:${e.message}`),
    onDone: () => log.push('done'),
  };
  return { h, log };
}

/** Runs the engine in 100 ms steps until done or `maxMs`. */
function run(engine: NarrativeEngine, maxMs = 120_000): number {
  let t = 0;
  while (!engine.state.done && t < maxMs) {
    engine.update(100);
    t += 100;
  }
  return t;
}

const current = (e: NarrativeEngine) => {
  const line = e.state.lines.at(-1);
  return line ? plain(line.segments) : null;
};

describe('NarrativeEngine', () => {
  it('types a line out, holds it, then moves on', () => {
    const beats: Beat[] = [{ type: 'mission', lines: ['สวัสดีครับ', 'ไปกันเลย'] }];
    const { h, log } = host();
    const e = new NarrativeEngine(beats, h, config);
    expect(log).toEqual(['beat:mission']);
    // "สวัสดีครับ" = 7 graphemes (marks stay on their letter) → 700 ms typing at 10/s
    expect(e.state.lines[0]?.length).toBe(7);
    e.update(300);
    expect(e.state.lines[0]?.shown).toBe(3);
    e.update(400 + 999);
    expect(current(e)).toBe('สวัสดีครับ');
    e.update(1);
    expect(current(e)).toBe('ไปกันเลย');
    // the previous line stays as context: at most two lines on screen
    expect(e.state.lines).toHaveLength(2);
    run(e);
    expect(log.at(-1)).toBe('done');
  });

  it('fills vars, picks lines by when, and fires cues', () => {
    const beats: Beat[] = [
      {
        type: 'reveal',
        lines: [
          'ราคา ฿{price}',
          { text: 'เกือบเท่า AI', when: 'close' },
          { text: 'ห่างไปนิด', when: '!close' },
          { text: 'ดูนี่', cue: 'curve' },
        ],
      },
    ];
    const { h, log } = host({ price: 75, close: false });
    const e = new NarrativeEngine(beats, h, config);
    const seen = new Set<string>();
    while (!e.state.done) {
      e.update(100);
      const line = current(e);
      if (line) seen.add(line);
    }
    expect([...seen]).toEqual(['ราคา ฿75', 'ห่างไปนิด', 'ดูนี่']);
    expect(log).toContain('cue:curve');
  });

  it('skips a line with a missing var instead of crashing', () => {
    const { h, log } = host();
    const e = new NarrativeEngine([{ type: 'lesson', lines: ['฿{nope}', 'ต่อ'] }], h, config);
    expect(current(e)).toBe('ต่อ');
    expect(log.some((l) => l.startsWith('error:'))).toBe(true);
  });

  it('waits for the tutorial gesture and praises only real success', () => {
    const tutorial: Beat = {
      type: 'tutorial',
      gesture: 'dwell',
      lines: ['ชี้ค้างไว้'],
      success: 'เยี่ยม',
      timeoutSec: 8,
    };
    const { h } = host();
    const e = new NarrativeEngine([tutorial], h, config);
    e.update(3000);
    expect(e.state.waiting).toBe('gesture');
    e.gestureSucceeded();
    e.update(100);
    expect(current(e)).toBe('เยี่ยม');
    run(e);
    expect(e.state.done).toBe(true);

    // timed out: no praise, still moves on after the timeout
    const e2 = new NarrativeEngine([tutorial], host().h, config);
    const seen = new Set<string>();
    let t = 0;
    while (!e2.state.done) {
      e2.update(100);
      t += 100;
      const line = current(e2);
      if (line) seen.add(line);
    }
    expect(seen.has('เยี่ยม')).toBe(false);
    expect(t).toBeGreaterThanOrEqual(8000);
  });

  it('counts down play time, shows hints on time, and ends early when the scene is done', () => {
    const play: Beat = {
      type: 'play',
      durationSec: 10,
      hints: [{ afterSec: 2, text: 'อีก {n} ลูก' }],
    };
    const { h } = host({ n: 3 });
    const e = new NarrativeEngine([play], h, config);
    expect(e.state.remainingSec).toBe(10);
    expect(e.state.skippable).toBe(false);
    e.update(2000);
    expect(current(e)).toBe('อีก 3 ลูก');
    expect(e.state.remainingSec).toBe(8);
    expect(run(new NarrativeEngine([play], h, config))).toBe(10_000);
    e.sceneFinished();
    e.update(16);
    expect(e.state.done).toBe(true);
  });

  it('waits past a time-out while the player is mid-selection', () => {
    const play: Beat = { type: 'play', durationSec: 2, hints: [] };
    const e = new NarrativeEngine([play], host().h, config);
    e.update(1500);
    e.setEngaged(true);
    e.update(5000);
    expect(e.state.done).toBe(false);
    expect(e.state.remainingSec).toBe(0);
    e.setEngaged(false);
    e.update(16);
    expect(e.state.done).toBe(true);

    const tutorial: Beat = { type: 'tutorial', gesture: 'dwell', lines: ['x'], timeoutSec: 1 };
    const t = new NarrativeEngine([tutorial], host().h, config);
    t.update(500);
    t.setEngaged(true);
    t.update(5000);
    expect(t.state.waiting).toBe('gesture');
    t.gestureSucceeded();
    t.update(16);
    t.update(16);
    expect(t.state.done).toBe(true);
  });

  it('skip jumps to the next checkpoint cue, which blocks until the scene continues', () => {
    const beats: Beat[] = [
      { type: 'reveal', lines: ['หนึ่ง', 'สอง', { cue: 'choose' }, 'ผลลัพธ์'] },
      { type: 'lesson', lines: ['บทเรียน'] },
    ];
    const { h, log } = host({}, ['choose']);
    const e = new NarrativeEngine(beats, h, config);
    e.skip();
    expect(log).toContain('cue:choose');
    expect(e.state.waiting).toBe('cue');
    e.update(60_000);
    expect(e.state.beat?.type).toBe('reveal');
    e.continue();
    expect(current(e)).toBe('ผลลัพธ์');
    e.skip();
    expect(e.state.beat?.type).toBe('lesson');
    e.skip();
    expect(e.state.done).toBe(true);
  });

  it('runs every beat of the real story end to end', () => {
    for (const chapter of story.chapters) {
      const vars = Object.fromEntries(chapter.vars.map((v) => [v, 1]));
      const { h, log } = host({ ...vars, aiName: 'AI', codename: 'x' });
      const e = new NarrativeEngine(chapter.beats, h, config);
      run(e, 600_000);
      expect(e.state.done, chapter.id).toBe(true);
      expect(
        log.filter((l) => l.startsWith('error:')),
        chapter.id,
      ).toEqual([]);
    }
  });
});
