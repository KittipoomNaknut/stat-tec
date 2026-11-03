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
  // Hands down while the tags fly: the grey cursor says how to point (research 027)
  await page.evaluate(() => {
    window.statTecSynthetic.rest();
  });
  await expect(page.locator('.hud-point-hint')).toBeVisible({
    timeout: 5000,
  });
  // ...on screen, clear of the caption (the lowered hand parks the cursor at the bottom)
  const hint = await page.locator('.hud-point-hint').boundingBox();
  expect(hint).not.toBeNull();
  if (hint) {
    expect(hint.y).toBeGreaterThanOrEqual(0);
    expect(hint.y + hint.height).toBeLessThanOrEqual(1080);
    expect(hint.x).toBeGreaterThanOrEqual(0);
    expect(hint.x + hint.width).toBeLessThanOrEqual(1920);
    const caption = await page.locator('.hud-caption').boundingBox();
    if (caption) expect(hint.y + hint.height).toBeLessThanOrEqual(caption.y);
  }
  await page.screenshot({ path: 'test-results/slash-hint.png' });
  // Tutorial and play: 8 s + 20 s of story time at ×2
  await slashFor(page, 16_000);
  const gold = Number(await page.locator('body').getAttribute('data-slash-gold'));
  console.log(`gold ${String(gold)}`);
  expect(gold).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/slash-play.png' });

  await expect(page.locator('.ps-plot')).toHaveClass(/is-shown/, { timeout: 60_000 });
  await expect(page.locator('.ps-gain')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: 'test-results/slash-day.png' });

  // The 3D profit surface turns and zooms with the hands (research 030)
  await expect(page.locator('.ps-explore.is-shown')).toBeVisible({ timeout: 30_000 });
  const view = async () =>
    ((await page.locator('body').getAttribute('data-surface-view')) ?? '0,0,0')
      .split(',')
      .map(Number);
  await page.evaluate(() => {
    window.statTecSynthetic.hands([1.9, -0.2], null);
  });
  await expect.poll(async () => (await view())[0], { timeout: 3000 }).toBeGreaterThan(0.2);
  await page.evaluate(() => {
    window.statTecSynthetic.hands([1.8, -0.3], [-1.8, -0.3]);
  });
  await expect.poll(async () => (await view())[2], { timeout: 3000 }).toBeGreaterThan(1.3);
  await page.screenshot({ path: 'test-results/slash-surface.png' });
  await page.evaluate(() => {
    window.statTecSynthetic.rest();
  });
  await expect
    .poll(() => page.locator('body').getAttribute('data-phase'), { timeout: 60_000 })
    .toBe('report');
  expect(errors).toEqual([]);
});
