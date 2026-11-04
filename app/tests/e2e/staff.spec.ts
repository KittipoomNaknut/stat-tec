import { expect, test, type Page } from '@playwright/test';
import './support/synthetic';

/** The staff screen's commands drive the game (research 035), and each lands in the booth log. */

const body = (page: Page, key: string) => page.locator('body').getAttribute(`data-${key}`);
const command = (page: Page, name: 'start' | 'skip' | 'next' | 'pause' | 'reset') =>
  page.evaluate((n) => {
    window.statTecCommand(n);
  }, name);

test('staff commands start, pause, skip a chapter and reset the visit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?player=synthetic&maxh=360');
  await expect.poll(() => body(page, 'phase')).toBe('attract');

  // Start with nobody locked yet, then skip the both-hands-up welcome
  await command(page, 'start');
  await expect.poll(() => body(page, 'phase')).toBe('welcome');
  await command(page, 'start');
  await expect.poll(() => body(page, 'chapter')).toBe('coffee');

  // Pause: the story stands still
  await command(page, 'pause');
  await expect.poll(() => body(page, 'staff-paused')).toBe('true');
  const caption = await page.locator('.hud-caption').textContent();
  const beat = await body(page, 'beat');
  await page.waitForTimeout(3000);
  expect(await body(page, 'beat')).toBe(beat);
  expect(await page.locator('.hud-caption').textContent()).toBe(caption);
  await command(page, 'pause');
  await expect.poll(() => body(page, 'staff-paused')).toBe('false');

  // Skip the whole chapter: on to the next one
  await command(page, 'next');
  await expect.poll(() => body(page, 'chapter')).toBe('slash');
  await command(page, 'skip');

  // Back to the attract screen
  await command(page, 'reset');
  await expect.poll(() => body(page, 'phase')).toBe('attract');

  const staff = await page.evaluate(() =>
    window
      .statTecBooth()
      .filter((e) => e.name === 'staff')
      .map((e) => String(e.fields['command'])),
  );
  expect(staff).toEqual(['start', 'start', 'pause', 'pause', 'next', 'skip', 'reset']);
  expect(errors).toEqual([]);
});
