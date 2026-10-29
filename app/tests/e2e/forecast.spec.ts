import { expect, test, type Page } from '@playwright/test';
import './support/synthetic';

/**
 * EPISODE V with a synthetic body: the arm draws the next twelve months (pen = cursor), the
 * hand's height sizes the 11.11 order, and the chapter plays through to the CEO report.
 */

const URL = '/?player=synthetic&chapter=forecast&speed=2&maxh=360';
/** Share of the chart width for the history (scenes/forecast/scene.ts HISTORY_W). */
const HISTORY_W = 0.62;

async function pointAt(page: Page, x: number, y: number, ms: number) {
  await page.evaluate(
    ([px, py, pms]) => {
      window.statTecSynthetic.pointAt(px ?? 0.5, py ?? 0.5, pms);
    },
    [x, y, ms],
  );
}

test('drawing the forecast and sizing the order play through to the report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await expect.poll(() => page.locator('body').getAttribute('data-phase')).toBe('attract');
  await page.evaluate(() => {
    window.statTecSynthetic.enter();
  });
  await expect
    .poll(() => page.locator('body').getAttribute('data-chapter'), { timeout: 20_000 })
    .toBe('forecast');

  // Wait for the future zone (tutorial), then draw from the edge of the history across the year
  await expect(page.locator('.fc-help')).toBeVisible({ timeout: 30_000 });
  const box = await page.locator('.fc-area').boundingBox();
  if (!box) throw new Error('no chart');
  const vw = page.viewportSize()?.width ?? 1920;
  const vh = page.viewportSize()?.height ?? 1080;
  const sx = (j: number) =>
    (box.x + (HISTORY_W + ((j + 0.5) / 12) * (1 - HISTORY_W)) * box.width) / vw;
  const sy = (v: number) => (box.y + (1 - v / 40_000) * box.height) / vh;
  const guess = [
    27_000, 19_000, 9000, 10_000, 11_000, 12_000, 13_000, 14_000, 14_500, 12_500, 12_000, 13_000,
  ];
  await pointAt(page, sx(-1.2), sy(guess[0] ?? 0), 400);
  await page.waitForTimeout(900);
  for (let j = 0; j < 12; j++) {
    await pointAt(page, sx(j), sy(guess[j] ?? 0), 260);
    await page.waitForTimeout(300);
  }
  await pointAt(page, sx(12.4), sy(guess[11] ?? 0), 260);
  await expect.poll(() => page.locator('body').getAttribute('data-forecast-drawn')).toBe('12');
  await page.evaluate(() => {
    window.statTecSynthetic.rest();
  });

  // The order: raise the hand partway and hold
  await expect(page.locator('.fc-order')).toBeVisible({ timeout: 90_000 });
  await pointAt(page, 0.5, 0.75, 400);
  await expect(page.locator('.fc-sold')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.locator('body').getAttribute('data-phase'), { timeout: 90_000 })
    .toBe('report');
  expect(errors).toEqual([]);
});
