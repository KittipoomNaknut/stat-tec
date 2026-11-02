import { expect, test, type Page } from '@playwright/test';
import './support/synthetic';

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

const phase = (page: Page) => page.locator('body').getAttribute('data-phase');

async function player(page: Page, action: 'enter' | 'lose' | 'return' | 'leave' | 'rest') {
  await page.evaluate((a) => {
    window.statTecSynthetic[a]();
  }, action);
}

/** A pose question of the active scene (not one fading out), wherever it sits. */
const POSE_PROMPT = '.scene-hud:not(.is-leaving) .pose-prompt';

/** Strike a pose with the body and hold it until the prompt takes it (research 025). */
async function strike(page: Page, pose: string) {
  await page.evaluate((p) => {
    window.statTecSynthetic.pose(p as Parameters<Window['statTecSynthetic']['pose']>[0]);
  }, pose);
  await expect(page.locator(`${POSE_PROMPT} [data-pose="${pose}"].is-chosen`)).toBeVisible({
    timeout: 6000,
  });
  await player(page, 'rest');
}

test('a visitor plays a whole visit with their body', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await expect.poll(() => phase(page)).toBe('attract');
  await expect(page.locator('.attract-title')).toHaveText('STAT WARS');

  await player(page, 'enter');
  await expect.poll(() => phase(page)).toBe('welcome');
  await expect(page.locator('.hud-caption')).toBeVisible();

  // Tutorial: both hands up to start.
  await expect(page.locator(`${POSE_PROMPT}[data-poses="both-up"]`)).toBeVisible();
  await strike(page, 'both-up');
  await expect.poll(() => phase(page)).toBe('chapter');

  const chapters = ['coffee', 'rival', 'slash'];
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
    const poses = await page
      .locator(POSE_PROMPT)
      .first()
      .getAttribute('data-poses', { timeout: 200 })
      .catch(() => null);
    const pose = poses?.split(',')[0];
    if (pose) {
      const t0 = Date.now();
      await strike(page, pose);
      console.log(`${chapter}: posed ${pose} in ${String(Date.now() - t0)} ms`);
      selected++;
    }
    await page.waitForTimeout(200);
  }
  expect([...seen]).toEqual(chapters);
  // Pose questions: the coffee quiz, the rival's strategy and the T-pose before the AI's day
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
  await strike(page, 'both-up');
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
