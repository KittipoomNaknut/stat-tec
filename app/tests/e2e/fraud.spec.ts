import { expect, test, type Page } from '@playwright/test';
import './support/synthetic';

/**
 * EPISODE IV with a synthetic body: slashing through red ships with fast sweeps (slap) catches
 * fraud, and the chapter plays through the AI's scan and the player's ring to the next chapter.
 */

const URL = '/?player=synthetic&chapter=fraud&speed=2&maxh=360';

async function pointAt(page: Page, x: number, y: number, ms: number) {
  await page.evaluate(
    ([px, py, pms]) => {
      window.statTecSynthetic.pointAt(px ?? 0.5, py ?? 0.5, pms);
    },
    [x, y, ms],
  );
}

/** Slash diagonally through the newest red ship, as a person aims at what they see. */
async function slashFor(page: Page, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const target = await page.locator('body').getAttribute('data-fraud-target');
    if (!target) {
      await page.waitForTimeout(100);
      continue;
    }
    const [x = 0.5, y = 0.5] = target.split(',').map(Number);
    const lead = x - 0.06;
    await pointAt(page, lead - 0.16, y - 0.26, 120);
    await page.waitForTimeout(260);
    await pointAt(page, lead + 0.16, y + 0.26, 90);
    await page.waitForTimeout(240);
  }
}

test('slashing catches fraud and the chapter plays through to the next one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await expect.poll(() => page.locator('body').getAttribute('data-phase')).toBe('attract');
  await page.evaluate(() => {
    window.statTecSynthetic.enter();
  });
  await expect
    .poll(() => page.locator('body').getAttribute('data-chapter'), { timeout: 20_000 })
    .toBe('fraud');
  // Tutorial and play: 8 s + 20 s of story time at ×2
  await expect(page.locator('.fr-help')).toBeVisible();
  await slashFor(page, 16_000);
  const caught = Number(await page.locator('body').getAttribute('data-fraud-caught'));
  console.log(`caught ${String(caught)}`);
  expect(caught).toBeGreaterThan(0);

  // The ring: raise the hand halfway and hold
  await pointAt(page, 0.5, 0.6, 400);
  await expect(page.locator('.fr-curve')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.fr-plot')).toHaveClass(/is-shown/);
  await expect
    .poll(() => page.locator('body').getAttribute('data-chapter'), { timeout: 90_000 })
    .toBe('forecast');
  expect(errors).toEqual([]);
});
