import { describe, expect, it } from 'vitest';
import {
  fill,
  isShown,
  lineVars,
  placeholders,
  plain,
  TemplateError,
} from '../../src/narrative/template';

describe('template', () => {
  it('fills vars with thousands separators and splits bold runs', () => {
    const segments = fill('ท่านตั้งราคา **฿{price}** — รายได้ ฿{revenue}', {
      price: 75,
      revenue: 18400,
    });
    expect(segments).toEqual([
      { text: 'ท่านตั้งราคา ', strong: false },
      { text: '฿75', strong: true },
      { text: ' — รายได้ ฿18,400', strong: false },
    ]);
    expect(plain(segments)).toBe('ท่านตั้งราคา ฿75 — รายได้ ฿18,400');
  });

  it('keeps one decimal at most', () => {
    expect(plain(fill('{s} วินาที', { s: 0.4271 }))).toBe('0.4 วินาที');
  });

  it('throws on a missing var instead of showing {price}', () => {
    expect(() => fill('฿{price}', {})).toThrow(TemplateError);
  });

  it('lists placeholders and when-vars of a line', () => {
    expect(placeholders('{a} และ {b}')).toEqual(['a', 'b']);
    expect(lineVars({ text: '{a}', when: '!close' })).toEqual(['a', 'close']);
    expect(lineVars({ cue: 'scan' })).toEqual([]);
  });

  it('shows lines by their when condition', () => {
    expect(isShown('always', {})).toBe(true);
    expect(isShown({ text: 'x', when: 'close' }, { close: true })).toBe(true);
    expect(isShown({ text: 'x', when: '!close' }, { close: true })).toBe(false);
    expect(() => isShown({ text: 'x', when: 'close' }, {})).toThrow(TemplateError);
  });
});
