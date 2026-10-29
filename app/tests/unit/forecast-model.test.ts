import { describe, expect, it } from 'vitest';
import {
  accuracy,
  AHEAD,
  BOX,
  completeGuess,
  fitTrend,
  forecast,
  HISTORY,
  orderAt,
  saleDay,
  sales,
} from '../../src/scenes/forecast/model';

const series = sales();
const ai = forecast(series.history);

describe('EPISODE V forecast model', () => {
  it('has three years of history and a year ahead, with 11.11 the peak of every year', () => {
    expect(series.history).toHaveLength(HISTORY);
    expect(series.actual).toHaveLength(AHEAD);
    for (let y = 0; y < 3; y++) {
      const year = series.history.slice(y * 12, y * 12 + 12);
      expect(Math.max(...year)).toBe(year[0]);
    }
  });

  it('finds the 11.11 season (about 2×) and growth from the history alone', () => {
    expect(ai.season[0]).toBeGreaterThan(1.8);
    expect(ai.season[0]).toBeLessThan(2.6);
    expect(Math.max(...ai.season)).toBe(ai.season[0]);
    expect(ai.trend.b).toBeGreaterThan(0);
  });

  it('fits the trend with the season divided out (a raw line tilts too flat)', () => {
    // The spike opens every year, so a raw least-squares line underestimates growth
    expect(fitTrend(series.history).b).toBeLessThan(ai.trend.b);
  });

  it('beats the simple guesses a person might make', () => {
    const aiAcc = accuracy(ai.mean, series.actual);
    const last = series.history.at(-1) ?? 0;
    const flat = accuracy(new Array<number>(AHEAD).fill(last), series.actual);
    const lastYear = accuracy(series.history.slice(HISTORY - 12), series.actual);
    expect(aiAcc).toBeGreaterThan(90);
    expect(aiAcc).toBeGreaterThan(flat);
    expect(aiAcc).toBeGreaterThan(lastYear);
  });

  it('puts the real 11.11 inside the AI band', () => {
    expect(series.actual[0]).toBeGreaterThan(ai.low[0] ?? 0);
    expect(series.actual[0]).toBeLessThan(ai.high[0] ?? 0);
  });

  it('scores a perfect guess 100 and clamps a wild one at 0', () => {
    expect(accuracy(series.actual, series.actual)).toBe(100);
    expect(
      accuracy(
        series.actual.map((v) => v * 5),
        series.actual,
      ),
    ).toBe(0);
  });

  it('fills months the player never drew from their neighbors', () => {
    const drawn = [null, 20, null, null, 10, null, null, null, null, null, null, null];
    expect(completeGuess(drawn, 99)).toEqual([20, 20, 20, 20, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(completeGuess(new Array<null>(AHEAD).fill(null), 99)).toEqual(new Array(AHEAD).fill(99));
  });

  it('pays most for an order that matches demand, less for too few or too many', () => {
    const demand = series.actual[0] ?? 0;
    const exact = saleDay(demand, demand);
    const short = saleDay(demand * 0.7, demand);
    const over = saleDay(demand * 1.4, demand);
    expect(exact.profit).toBe(exact.best);
    expect(short.profit).toBeLessThan(exact.profit);
    expect(over.profit).toBeLessThan(exact.profit);
    expect(short.short).toBeGreaterThan(0);
    expect(over.leftover).toBeGreaterThan(0);
  });

  it('orders in whole boxes, and the best order sits in the middle of a raise', () => {
    const nov = ai.mean[0] ?? 0;
    expect(orderAt(0.5, nov) % BOX).toBe(0);
    expect(orderAt(0, nov)).toBeLessThan(orderAt(1, nov));
    const demand = series.actual[0] ?? 0;
    let best = 0;
    let bestLevel = 0;
    for (let l = 0; l <= 1; l += 0.01) {
      const p = saleDay(orderAt(l, nov), demand).profit;
      if (p > best) {
        best = p;
        bestLevel = l;
      }
    }
    expect(bestLevel).toBeGreaterThan(0.25);
    expect(bestLevel).toBeLessThan(0.65);
  });
});
