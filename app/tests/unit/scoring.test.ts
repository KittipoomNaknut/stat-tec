import { describe, expect, it } from 'vitest';
import { scoringConfig } from '../../src/config/scoring';
import { story } from '../../src/narrative/story';
import { codename } from '../../src/scoring/codename';
import { chapterProfit, totalProfit, type ChapterOutcome } from '../../src/scoring/profit';
import { ceoStyle } from '../../src/scoring/style';
import { Leaderboard, type KeyValueStore } from '../../src/storage/leaderboard';

const outcome = (chapterId: string, score: number | null, style = {}): ChapterOutcome => ({
  chapterId,
  score,
  style,
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

/** Deterministic random in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe('profit', () => {
  it('pays 40% of the base at score 0 and the full base at score 1', () => {
    expect(chapterProfit(outcome('coffee', 0))).toBe(112_000);
    expect(chapterProfit(outcome('coffee', 1))).toBe(280_000);
    expect(chapterProfit(outcome('coffee', 7))).toBe(280_000);
  });

  it('pays the full base for unscored chapters', () => {
    expect(chapterProfit(outcome('data', null))).toBe(120_000);
  });

  it('has a base for every chapter in the story, totalling over a million', () => {
    for (const c of story.chapters)
      expect(scoringConfig.baseByChapter[c.id], c.id).toBeGreaterThan(0);
    const best = totalProfit(story.chapters.map((c) => outcome(c.id, 1)));
    const worst = totalProfit(story.chapters.map((c) => outcome(c.id, 0)));
    expect(best).toBe(1_400_000);
    expect(worst).toBeGreaterThan(500_000);
  });
});

describe('ceoStyle', () => {
  it('picks the style with the most evidence', () => {
    expect(
      ceoStyle([
        outcome('coffee', 1, { 'risk-taker': 0.8 }),
        outcome('fraud', 1, { intuitive: 0.5, 'risk-taker': 0.3 }),
      ]),
    ).toBe('risk-taker');
  });

  it('falls back to analyst on ties and empty sessions', () => {
    expect(ceoStyle([])).toBe('analyst');
    expect(ceoStyle([outcome('coffee', 1, { analyst: 0.5, intuitive: 0.5 })])).toBe('analyst');
  });
});

describe('codename', () => {
  it('combines an animal, a title and a two-digit number', () => {
    const name = codename(story.codename, seeded(1));
    expect(name).toMatch(/^\S+ #\d{2}$/);
    const animal = story.codename.animals.find((a) => name.startsWith(a));
    expect(animal).toBeDefined();
  });

  it('avoids names already used today', () => {
    const first = codename(story.codename, seeded(7));
    expect(codename(story.codename, seeded(7), new Set([first]))).not.toBe(first);
  });
});

describe('Leaderboard', () => {
  it('ranks by profit, ties sharing the better rank', () => {
    const board = new Leaderboard(memoryStore(), () => Date.UTC(2026, 10, 1, 5));
    expect(board.add('ก #01', 900_000)).toEqual({ rank: 1, total: 1 });
    expect(board.add('ข #02', 1_200_000)).toEqual({ rank: 1, total: 2 });
    expect(board.add('ค #03', 900_000)).toEqual({ rank: 2, total: 3 });
    expect(board.today().map((e) => e.codename)).toEqual(['ข #02', 'ก #01', 'ค #03']);
  });

  it('starts empty on a new day', () => {
    let now = new Date(2026, 10, 1, 20).getTime();
    const board = new Leaderboard(memoryStore(), () => now);
    board.add('ก #01', 1);
    now = new Date(2026, 10, 2, 9).getTime();
    expect(board.today()).toEqual([]);
    expect(board.add('ข #02', 1)).toEqual({ rank: 1, total: 1 });
  });

  it('survives corrupt or failing storage', () => {
    const store = memoryStore();
    const board = new Leaderboard(store, () => new Date(2026, 10, 1).getTime());
    store.data.set('stat-tec:leaderboard:2026-11-01', '{not json');
    expect(board.today()).toEqual([]);
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(board.add('ก #01', 5)).toEqual({ rank: 1, total: 1 });
  });
});
