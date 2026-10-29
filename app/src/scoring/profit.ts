import { clamp } from '../core/math';
import { scoringConfig } from '../config/scoring';
import type { CeoStyle } from '../narrative/schema';

/** What a chapter hands to scoring (a subset of SceneResult, ARCHITECTURE §6). */
export interface ChapterOutcome {
  chapterId: string;
  /** 0..1 closeness to the best answer; `null` for unscored chapters (A is a warm-up). */
  score: number | null;
  /** Evidence for each CEO style, summed over the session. */
  style: Partial<Record<CeoStyle, number>>;
}

/** Profit for one chapter in baht, rounded to the nearest thousand (reads better). */
export function chapterProfit(outcome: ChapterOutcome, config = scoringConfig): number {
  const base = config.baseByChapter[outcome.chapterId] ?? 0;
  const score = outcome.score === null ? 1 : clamp(outcome.score, 0, 1);
  return Math.round((base * (config.floor + (1 - config.floor) * score)) / 1000) * 1000;
}

export function totalProfit(outcomes: readonly ChapterOutcome[], config = scoringConfig): number {
  return outcomes.reduce((sum, o) => sum + chapterProfit(o, config), 0);
}
