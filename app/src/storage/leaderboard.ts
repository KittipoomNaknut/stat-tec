import { scoringConfig } from '../config/scoring';

/** Minimal synchronous key-value store; `localStorage` in the app, a Map in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LeaderboardEntry {
  codename: string;
  profit: number;
  /** Epoch ms. */
  at: number;
}

const PREFIX = 'stat-tec:leaderboard:';

/**
 * Today's ranking by total profit (ARCHITECTURE §10): one list per local day, codenames only.
 * Stored as JSON under a dated key, so a new day starts empty without any cleanup job.
 * The list is small (≤ 500 entries) — localStorage is simpler than IndexedDB and synchronous.
 */
export class Leaderboard {
  readonly #store: KeyValueStore;
  readonly #now: () => number;

  constructor(store: KeyValueStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  today(): LeaderboardEntry[] {
    try {
      const raw = this.#store.getItem(this.#key());
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LeaderboardEntry[]) : [];
    } catch {
      // Corrupt or blocked storage must never stop the show.
      return [];
    }
  }

  /** Adds an entry; returns its rank (1 = best; ties share the better rank) and today's count. */
  add(codename: string, profit: number): { rank: number; total: number } {
    const entries = this.today();
    entries.push({ codename, profit, at: this.#now() });
    entries.sort((a, b) => b.profit - a.profit);
    const kept = entries.slice(0, scoringConfig.leaderboardSize);
    try {
      this.#store.setItem(this.#key(), JSON.stringify(kept));
    } catch {
      // Quota or privacy mode: the ranking for this visitor is still correct.
    }
    const rank = entries.filter((e) => e.profit > profit).length + 1;
    return { rank, total: entries.length };
  }

  #key(): string {
    const d = new Date(this.#now());
    const day = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return PREFIX + day;
  }
}
