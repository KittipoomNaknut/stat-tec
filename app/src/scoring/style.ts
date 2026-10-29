import { CEO_STYLES, type CeoStyle } from '../narrative/schema';
import type { ChapterOutcome } from './profit';

/**
 * The player's CEO style: the one with the most evidence across chapters. Ties and an empty
 * session go to `analyst` — the style the show wants to celebrate.
 */
export function ceoStyle(outcomes: readonly ChapterOutcome[]): CeoStyle {
  const totals = new Map<CeoStyle, number>(CEO_STYLES.map((s) => [s, 0]));
  for (const o of outcomes) {
    for (const s of CEO_STYLES) totals.set(s, (totals.get(s) ?? 0) + (o.style[s] ?? 0));
  }
  let best: CeoStyle = 'analyst';
  for (const s of CEO_STYLES) {
    if ((totals.get(s) ?? 0) > (totals.get(best) ?? 0)) best = s;
  }
  return best;
}
