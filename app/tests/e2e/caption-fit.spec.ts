import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parse } from 'yaml';
import { fill, lineText, type TemplateVars } from '../../src/narrative/template';
import type { Line, Story } from '../../src/narrative/schema';

/**
 * Every line of the story must fit on one line of the narrator's box, measured in the real
 * layout with the real fonts and bold runs (research 017: a character count missed lines once
 * the box got narrower). Vars are filled with long realistic values.
 */
const LONG_VARS: TemplateVars = new Proxy(
  {},
  {
    // Longest realistic values: the longest codename, ฿1.4 M total profit, five-digit amounts
    get: (_target, key: string) =>
      key === 'codename'
        ? 'เสือดาวสายวางแผน #27'
        : key === 'aiName'
          ? '[AI_NAME]'
          : key === 'totalProfit'
            ? 1_400_000
            : 99_999,
  },
);

function storyLines(): string[] {
  const story = parse(
    readFileSync(new URL('../../../content/story.th.yaml', import.meta.url), 'utf8'),
  ) as Story;
  const out: Line[] = [];
  const take = (lines: readonly Line[] | undefined) => {
    for (const l of lines ?? []) out.push(l);
  };
  for (const beat of story.welcome.beats) take('lines' in beat ? beat.lines : undefined);
  for (const chapter of story.chapters) {
    for (const beat of chapter.beats) {
      take('lines' in beat ? beat.lines : undefined);
      if (beat.type === 'play') take(beat.hints.map((h) => h.text));
    }
  }
  take(story.report.lines);
  return out.map((l) => lineText(l)).filter((t): t is string => t !== undefined);
}

test('every story line fits on one caption line at 1920×1080', async ({ page }) => {
  await page.goto('/?styleguide&hud=0');
  const html = storyLines().map((text) =>
    fill(text, LONG_VARS)
      .map((s) => (s.strong ? `<b>${s.text}</b>` : s.text))
      .join(''),
  );
  const result = await page.evaluate(async (lines) => {
    await document.fonts.ready;
    const box = document.createElement('div');
    box.className = 'hud-panel hud-caption';
    box.style.visibility = 'hidden';
    const p = document.createElement('p');
    p.className = 'hud-caption-text';
    p.style.whiteSpace = 'nowrap';
    p.style.display = 'inline-block';
    box.append(p);
    document.body.append(box);
    const style = getComputedStyle(box);
    const avail = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return lines.map((l) => {
      p.innerHTML = l;
      return { line: p.textContent, ratio: p.getBoundingClientRect().width / avail };
    });
  }, html);
  // 8% margin: different digits, a longer codename, rendering differences on the kiosk
  const tooLong = result
    .filter((r) => r.ratio > 0.92)
    .map((r) => `${r.line} (${(r.ratio * 100).toFixed(0)}%)`);
  expect(tooLong).toEqual([]);
});
