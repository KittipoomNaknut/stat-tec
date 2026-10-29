import { describe, expect, it } from 'vitest';
import type { Line } from '../../src/narrative/schema';
import { GLOBAL_VARS, parseStory, REPORT_VARS, story } from '../../src/narrative/story';
import { lineText, lineVars, placeholders } from '../../src/narrative/template';

/** Characters that take horizontal space (Thai vowel/tone marks stack and take none). */
function visibleLength(text: string): number {
  return text.replace(/[ัิ-ฺ็-๎]/g, '').length;
}

/**
 * Longest a line may be so it fits one caption line at 5 vh: in ?styleguide a 38-character line
 * took 920 of the 1373 px text width at 1080p (24 px/char → ~56 chars); 52 leaves a margin.
 */
const MAX_VISIBLE_CHARS = 52;
/** Rough on-screen length of a filled var: "฿1,240,000", "เสือดาวสายบุก #27". */
const VAR_WIDTH = 10;

function allLines(): { where: string; line: Line; vars: readonly string[] }[] {
  const out: { where: string; line: Line; vars: readonly string[] }[] = [];
  const add = (where: string, lines: readonly Line[], vars: readonly string[]) => {
    for (const line of lines) out.push({ where, line, vars });
  };
  for (const beat of story.welcome.beats) {
    if ('lines' in beat) add(`welcome.${beat.type}`, beat.lines, GLOBAL_VARS);
  }
  for (const chapter of story.chapters) {
    const vars = [...GLOBAL_VARS, ...chapter.vars];
    for (const beat of chapter.beats) {
      if ('lines' in beat) add(`${chapter.id}.${beat.type}`, beat.lines, vars);
      if (beat.type === 'play')
        add(
          `${chapter.id}.hints`,
          beat.hints.map((h) => h.text),
          vars,
        );
    }
  }
  add('report', story.report.lines, [...GLOBAL_VARS, ...REPORT_VARS]);
  return out;
}

describe('content/story.th.yaml', () => {
  it('has the five chapters in story order', () => {
    expect(story.chapters.map((c) => c.id)).toEqual([
      'data',
      'coffee',
      'segments',
      'fraud',
      'forecast',
    ]);
  });

  it('uses only vars that someone provides', () => {
    const missing = allLines().flatMap(({ where, line, vars }) =>
      lineVars(line)
        .filter((v) => !vars.includes(v))
        .map((v) => `${where}: {${v}}`),
    );
    expect(missing).toEqual([]);
  });

  it('declares no chapter var that no line uses', () => {
    for (const chapter of story.chapters) {
      const used = new Set(
        allLines()
          .filter((l) => l.where.startsWith(`${chapter.id}.`))
          .flatMap((l) => lineVars(l.line)),
      );
      expect(
        chapter.vars.filter((v) => !used.has(v)),
        chapter.id,
      ).toEqual([]);
    }
  });

  it('keeps every line short enough for one caption line', () => {
    const tooLong = allLines()
      .map(({ where, line }) => ({ where, text: lineText(line) ?? '' }))
      .map(({ where, text }) => {
        const vars = placeholders(text).length;
        const bare = text.replace(/\{\w+\}/g, '').replaceAll('**', '');
        return { where, text, length: visibleLength(bare) + vars * VAR_WIDTH };
      })
      .filter((l) => l.length > MAX_VISIBLE_CHARS);
    expect(tooLong).toEqual([]);
  });

  it('rejects malformed stories with a readable error', () => {
    expect(() => parseStory('meta: { aiName: x, locale: en }')).toThrow(/meta\.locale/);
    const broken = `
meta: { aiName: A, locale: th }
attract: { title: t, prompt: p, rotateSec: 6, taglines: [x] }
welcome: { beats: [{ type: mission, lines: [{ when: close }] }] }
chapters: [{ id: a, scene: a, title: t, concept: c, beats: [{ type: play }] }]
report: { lines: [x] }
styles: { analyst: { label: a, description: d }, risk-taker: { label: a, description: d }, intuitive: { label: a, description: d } }
system: { paused: a, tooFar: a, otherPerson: a, idle: a, reconnecting: a, skip: a }
codename: { animals: [a, b, c, d], titles: [a, b, c, d] }
`;
    expect(() => parseStory(broken)).toThrow(/a line needs text or a cue[\s\S]*durationSec/);
  });
});
