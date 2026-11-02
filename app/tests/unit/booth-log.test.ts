import { afterEach, describe, expect, it } from 'vitest';
import {
  boothLog,
  recentBoothEvents,
  resetBoothLog,
  setBoothContext,
  setBoothSink,
  type BoothEvent,
} from '../../src/core/booth-log';

afterEach(() => {
  resetBoothLog();
});

describe('booth log', () => {
  it('queues events until the service is connected, then sends them in order', () => {
    boothLog('visit-start');
    boothLog('error', { message: 'boom' }, 'error');
    const sent: BoothEvent[] = [];
    setBoothSink((e) => sent.push(e));
    boothLog('chapter');
    expect(sent.map((e) => e.name)).toEqual(['visit-start', 'error', 'chapter']);
    expect(sent[1]).toEqual({ name: 'error', level: 'error', fields: { message: 'boom' } });
  });

  it('keeps only the latest events while nothing listens', () => {
    for (let i = 0; i < 80; i++) boothLog('tick', { i });
    const sent: BoothEvent[] = [];
    setBoothSink((e) => sent.push(e));
    expect(sent).toHaveLength(50);
    expect(sent[0]?.fields['i']).toBe(30);
  });

  it('stamps every event with the visit and chapter it happened in', () => {
    setBoothContext({ visit: 3, chapter: 'rival' });
    boothLog('pose', { pose: 'cross' });
    setBoothContext({});
    boothLog('reset');
    expect(recentBoothEvents().map((e) => e.fields)).toEqual([
      { visit: 3, chapter: 'rival', pose: 'cross' },
      {},
    ]);
  });
});
