import { expect, test, type Page } from '@playwright/test';

/**
 * A whole visit driven by a synthetic body through the real gesture engine (cursor activation,
 * dwell-to-select, presence): ROADMAP Phase 3 DoD.
 */

/**
 * Story time ×3. The tutorial waits 8 s of story time for the player, i.e. 2.7 s here, while a
 * dwell takes 1.2 s of real time plus moving the hand there — ×4 left too little (research 014).
 */
const SPEED = 3;
/** Low internal resolution: CI renders WebGL in software (~9 fps at full size). */
const URL = `/?player=synthetic&speed=${String(SPEED)}&maxh=360`;

interface Synthetic {
  enter(): void;
  lose(): void;
  return(): void;
  leave(): void;
  pointAt(x: number, y: number): void;
  rest(): void;
}

declare global {
  interface Window {
    statTecSynthetic: Synthetic;
  }
}

const phase = (page: Page) => page.locator('body').getAttribute('data-phase');

async function player(page: Page, action: 'enter' | 'lose' | 'return' | 'leave' | 'rest') {
  await page.evaluate((a) => {
    window.statTecSynthetic[a]();
  }, action);
}

/** Point at a target's center with the body and hold until the app reports it selected. */
async function dwellOn(page: Page, id: string) {
  const target = page.locator(`[data-target="${id}"]`).first();
  await expect(target).toBeVisible();
  // Let the entrance animation (500 ms story time) settle so the box stays put.
  await page.waitForTimeout(200);
  const box = await target.boundingBox({ timeout: 2000 });
  if (!box) throw new Error(`no box for ${id}`);
  await page.evaluate(
    ({ x, y }) => {
      window.statTecSynthetic.pointAt(x, y);
    },
    { x: (box.x + box.width / 2) / 1920, y: (box.y + box.height / 2) / 1080 },
  );
  await expect
    .poll(() => page.locator('body').getAttribute('data-last-select'), { timeout: 6000 })
    .toBe(id);
}

/** Any selectable button of the active scene (not one fading out), wherever it sits. */
const CHOICE = '.scene-hud:not(.is-leaving) .hud-button[data-target]';

test('a visitor plays a whole visit with their body', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await expect.poll(() => phase(page)).toBe('attract');
  await expect(page.locator('.attract-title')).toHaveText('STAT WARS');

  await player(page, 'enter');
  await expect.poll(() => phase(page)).toBe('welcome');
  await expect(page.locator('.hud-caption')).toBeVisible();

  // Tutorial: point at "พร้อมแล้ว" and hold, then lower the arm like a person does.
  await dwellOn(page, 'welcome-ready');
  await player(page, 'rest');
  await expect.poll(() => phase(page)).toBe('chapter');

  const chapters = ['data', 'coffee', 'segments', 'fraud', 'forecast'];
  const seen = new Set<string>();
  let selected = 0;
  for (;;) {
    // Phase and chapter in one read: two reads can straddle the switch to the report.
    const now = await page.evaluate(() =>
      Object.fromEntries(Object.entries(document.body.dataset)),
    );
    if (now['phase'] !== 'chapter') break;
    const chapter = now['chapter'] ?? '';
    seen.add(chapter);
    const id = await page
      .locator(CHOICE)
      .first()
      .getAttribute('data-target', { timeout: 200 })
      .catch(() => null);
    if (id !== null) {
      const t0 = Date.now();
      await dwellOn(page, id);
      console.log(`${chapter}: selected ${id} in ${String(Date.now() - t0)} ms`);
      selected++;
      await player(page, 'rest');
    }
    await page.waitForTimeout(200);
  }
  expect([...seen]).toEqual(chapters);
  // segments' ad choice, fraud, forecast — coffee is played by raising a hand, segments' play
  // by holding still in the crowd (magnets drop by themselves when time runs out)
  expect(selected).toBe(3);

  // Report: a real profit total and rank, then back to attract on its own.
  await expect.poll(() => phase(page)).toBe('report');
  await expect(page.locator('.report-name')).toContainText('CEO ');
  await expect(page.locator('.report-profit .hud-number')).toHaveText(
    /฿\d{3},\d{3}|฿1,\d{3},\d{3}/,
    {
      timeout: 30_000,
    },
  );
  await page.screenshot({ path: 'test-results/report.png' });
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('attract');
  expect(errors).toEqual([]);
});

test('stepping out pauses the visit; coming back resumes the same chapter', async ({ page }) => {
  await page.goto(URL);
  await expect.poll(() => phase(page)).toBe('attract');
  await player(page, 'enter');
  await dwellOn(page, 'welcome-ready');
  await expect.poll(() => phase(page)).toBe('chapter');
  const chapter = await page.locator('body').getAttribute('data-chapter');

  await player(page, 'lose');
  await expect.poll(() => phase(page)).toBe('paused');
  await expect(page.locator('.hud-notice')).toBeVisible();
  await expect(page.locator('.hud-notice-text')).toContainText('กลับมายืนตรงจุดนี้');

  await player(page, 'return');
  await expect.poll(() => phase(page)).toBe('chapter');
  await expect(page.locator('.hud-notice')).toBeHidden();
  expect(await page.locator('body').getAttribute('data-chapter')).toBe(chapter);
});

test('a visitor who does not come back ends the visit', async ({ page }) => {
  await page.goto(URL);
  await expect.poll(() => phase(page)).toBe('attract');
  await player(page, 'enter');
  await expect.poll(() => phase(page)).toBe('welcome');
  await player(page, 'lose');
  await expect.poll(() => phase(page)).toBe('paused');
  // 8 s pause timeout at ×3
  await expect.poll(() => phase(page), { timeout: 10_000 }).toBe('attract');
});

test('staff F5 returns to attract from the middle of a visit', async ({ page }) => {
  await page.goto(URL);
  await expect.poll(() => phase(page)).toBe('attract');
  await player(page, 'enter');
  await expect.poll(() => phase(page)).toBe('welcome');
  await page.keyboard.press('F5');
  await expect.poll(() => phase(page)).toBe('attract');
});
