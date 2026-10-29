/**
 * Profit model (ARCHITECTURE §10): chapter profit = base × (floor + (1 − floor) × score), so every
 * player earns something — kids should leave feeling good. Bases add up to ~1.4 M baht.
 */
export const scoringConfig = {
  floor: 0.4,
  baseByChapter: {
    data: 120_000,
    coffee: 280_000,
    segments: 320_000,
    fraud: 300_000,
    forecast: 380_000,
  } as Readonly<Record<string, number>>,
  /** Leaderboard entries kept per day. */
  leaderboardSize: 500,
};
