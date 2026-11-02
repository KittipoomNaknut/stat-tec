import { expect, test, type Page } from '@playwright/test';
import './support/synthetic';

/**
 * EP III with a synthetic body: fast sweeps (slap) through gold price tags sell at that price,
 * and the chapter plays through the AI's day of prices to the CEO report.
 */

const URL = '/?player=synthetic&chapter=slash&speed=2&maxh=360';

async function pointAt(page: Page, x: number, y: number, ms: number) {
  await page.evaluate(
    ([px, py, pms]) => {
      window.statTecSynthetic.pointAt(px ?? 0.5, py ?? 0.5, pms);
    },
    [x, y, ms],
  );
}

/** Slash diagonally through the highest gold tag, as a person aims at what they see. */
async function slashFor(page: Page, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const target = await page.locator('body').getAttribute('data-slash-target');
    if (!target) {
      await page.waitForTimeout(100);
      continue;
    }
    const [x = 0.5, y = 0.5] = target.split(',').map(Number);
    await pointAt(page, x - 0.16, y - 0.24, 120);
    await page.waitForTimeout(260);
    await pointAt(page, x + 0.16, y + 0.28, 90);
    await page.waitForTimeout(240);
  }
}

test('slashing gold tags sells and the chapter plays through to the report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await expect.poll(() => page.locator('body').getAttribute('data-phase')).toBe('attract');
  await page.evaluate(() => {
    window.statTecSynthetic.enter();
  });
  await expect
    .poll(() => page.locator('body').getAttribute('data-chapter'), { timeout: 20_000 })
    .toBe('slash');
  await expect(page.locator('.ps-legend')).toBeVisible();
  // Tutorial and play: 8 s + 20 s of story time at ×2
  await slashFor(page, 16_000);
  const gold = Number(await page.locator('body').getAttribute('data-slash-gold'));
  console.log(`gold ${String(gold)}`);
  expect(gold).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/slash-play.png' });

  await expect(page.locator('.ps-plot')).toHaveClass(/is-shown/, { timeout: 60_000 });
  await expect(page.locator('.ps-gain')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'test-results/slash-day.png' });
  await expect
    .poll(() => page.locator('body').getAttribute('data-phase'), { timeout: 60_000 })
    .toBe('report');
  expect(errors).toEqual([]);
});
