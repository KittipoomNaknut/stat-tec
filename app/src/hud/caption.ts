import type { CaptionLine, NarrativeState } from '../narrative/engine';
import type { Segment } from '../narrative/template';

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });

/** Segments split into grapheme clusters, cached per line (lines are immutable once shown). */
const clusters = new WeakMap<CaptionLine, { strong: boolean; parts: string[] }[]>();

function clustersOf(line: CaptionLine) {
  let c = clusters.get(line);
  if (!c) {
    c = line.segments.map((s: Segment) => ({
      strong: s.strong,
      parts: [...graphemes.segment(s.text)].map((g) => g.segment),
    }));
    clusters.set(line, c);
  }
  return c;
}

/**
 * The AI narrator's box: the current line typing out, the previous one dimmed above it for
 * context. Untyped text is laid out but invisible, so the box never reflows while typing.
 */
export class Caption {
  readonly #root = document.createElement('div');
  readonly #lines = document.createElement('div');
  /** Rendered (line, shown) per slot, to touch the DOM only when something changed. */
  #rendered: [CaptionLine | null, number][] = [
    [null, -1],
    [null, -1],
  ];

  constructor(parent: HTMLElement, speaker: string) {
    this.#root.className = 'hud-panel hud-caption';
    this.#root.innerHTML = `
      <div class="hud-caption-speaker">
        <span class="hud-voice"><i></i><i></i><i></i></span>
        <p class="hud-label hud-label-accent"></p>
      </div>`;
    const label = this.#root.querySelector('p');
    if (label) label.textContent = speaker;
    this.#lines.className = 'hud-caption-lines';
    for (let i = 0; i < 2; i++) {
      const p = document.createElement('p');
      p.className = 'hud-caption-text';
      this.#lines.append(p);
    }
    this.#root.append(this.#lines);
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  update(state: NarrativeState | null): void {
    const lines = state?.lines ?? [];
    this.#root.hidden = lines.length === 0;
    const current = lines.at(-1) ?? null;
    this.#root.classList.toggle('is-speaking', !!current && current.shown < current.length);
    const slots: (CaptionLine | null)[] =
      lines.length > 1 ? [lines[0] ?? null, current] : [null, current];
    slots.forEach((line, i) => {
      const prev = this.#rendered[i];
      const shown = line?.shown ?? -1;
      if (prev && prev[0] === line && prev[1] === shown) return;
      this.#rendered[i] = [line, shown];
      const el = this.#lines.children[i] as HTMLElement | undefined;
      if (el) this.#render(el, line, i === 0);
    });
  }

  #render(el: HTMLElement, line: CaptionLine | null, previous: boolean): void {
    el.classList.toggle('is-previous', previous);
    el.hidden = line === null;
    el.replaceChildren();
    if (!line) return;
    let budget = line.shown;
    for (const seg of clustersOf(line)) {
      const typed = seg.parts.slice(0, Math.max(0, budget)).join('');
      const rest = seg.parts.slice(Math.max(0, budget)).join('');
      budget -= seg.parts.length;
      const wrap = (text: string, ghost: boolean) => {
        if (!text) return;
        const node = document.createElement(seg.strong ? 'b' : 'span');
        node.textContent = text;
        if (ghost) node.className = 'is-untyped';
        el.append(node);
      };
      wrap(typed, false);
      wrap(rest, true);
    }
  }
}
