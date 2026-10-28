import type { Line } from './schema';

/** Values a line can use; booleans only drive `when`. */
export type TemplateVars = Readonly<Record<string, string | number | boolean>>;

/** A run of text, `strong` for `**bold**` (rendered in the accent color). */
export interface Segment {
  text: string;
  strong: boolean;
}

export class TemplateError extends Error {
  override name = 'TemplateError';
}

const PLACEHOLDER = /\{([a-zA-Z]\w*)\}/g;
const NUMBER = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });

/** Var names a text uses, e.g. `"฿{price} / {unit}"` → `['price', 'unit']`. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
}

/** Var names a line depends on: its placeholders plus its `when` condition. */
export function lineVars(line: Line): string[] {
  if (typeof line === 'string') return placeholders(line);
  const names = line.text === undefined ? [] : placeholders(line.text);
  if (line.when !== undefined) names.push(line.when.replace(/^!/, ''));
  return names;
}

/** Whether a line shows for these vars (`when: close` / `when: '!close'`). */
export function isShown(line: Line, vars: TemplateVars): boolean {
  if (typeof line === 'string' || line.when === undefined) return true;
  const negate = line.when.startsWith('!');
  const name = negate ? line.when.slice(1) : line.when;
  const value = vars[name];
  if (value === undefined) throw new TemplateError(`missing var "${name}" for when`);
  return negate ? !value : Boolean(value);
}

export function lineText(line: Line): string | undefined {
  return typeof line === 'string' ? line : line.text;
}

export function lineCue(line: Line): string | undefined {
  return typeof line === 'string' ? undefined : line.cue;
}

/** Fills `{var}`s (numbers get thousands separators) and splits `**bold**` runs. */
export function fill(text: string, vars: TemplateVars): Segment[] {
  const filled = text.replace(PLACEHOLDER, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new TemplateError(`missing var "${name}" in "${text}"`);
    return typeof value === 'number' ? NUMBER.format(value) : String(value);
  });
  const segments: Segment[] = [];
  filled.split('**').forEach((part, i) => {
    if (part) segments.push({ text: part, strong: i % 2 === 1 });
  });
  return segments;
}

export function plain(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join('');
}
