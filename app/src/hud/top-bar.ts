import { baht, CountUp } from './count-up';
import { setDigits } from './digits';
import { restartAnimation } from './restart-animation';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Top of the screen: the episode (eyebrow, Thai title, progress) on the left and the credits
 * earned so far on the right — readable by the crowd behind the player too.
 */
export class TopBar {
  readonly #root = document.createElement('header');
  readonly #eyebrow: HTMLElement;
  readonly #title: HTMLElement;
  readonly #progress: HTMLOListElement;
  readonly #count: HTMLElement;
  readonly #profit: HTMLElement;
  readonly #profitTile: HTMLElement;
  readonly #counter = new CountUp();

  constructor(parent: HTMLElement, chapterCount: number) {
    this.#root.className = 'hud-topbar';
    this.#root.innerHTML = `
      <div class="hud-episode">
        <p class="hud-eyebrow"></p>
        <h1 class="hud-headline"></h1>
        <ol class="hud-progress">${'<li></li>'.repeat(chapterCount)}<span class="hud-progress-count"></span></ol>
      </div>
      <div class="hud-profit">
        <p class="hud-label-th">กำไรสะสม</p>
        <span class="hud-number"></span>
      </div>`;
    const q = (sel: string) => this.#root.querySelector(sel) as HTMLElement;
    this.#eyebrow = q('.hud-eyebrow');
    this.#title = q('.hud-headline');
    this.#progress = q('.hud-progress') as HTMLOListElement;
    this.#count = q('.hud-progress-count');
    this.#profit = q('.hud-number');
    this.#profitTile = q('.hud-profit');
    setDigits(this.#profit, baht(0));
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  set visible(value: boolean) {
    this.#root.hidden = !value;
  }

  /** `index` is 0-based; −1 for the briefing before the first episode. */
  setChapter(index: number, count: number, concept = '', title = ''): void {
    const n = (i: number) => String(i).padStart(2, '0');
    this.#eyebrow.textContent =
      index < 0 ? 'Briefing' : `Episode ${ROMAN[index] ?? String(index + 1)} · ${concept}`;
    this.#title.textContent = index < 0 ? 'ภารกิจของ CEO คนใหม่' : title;
    this.#count.textContent = `${n(Math.max(index + 1, 0))} / ${n(count)}`;
    [...this.#progress.querySelectorAll('li')].forEach((li, i) => {
      li.className = i < index ? 'is-done' : i === index ? 'is-current' : '';
    });
  }

  setProfit(value: number, animate = true): void {
    if (animate && value > this.#counter.target) restartAnimation(this.#profitTile, 'is-gain');
    this.#counter.set(value, animate);
  }

  update(dtMs: number): void {
    this.#counter.update(dtMs);
    setDigits(this.#profit, baht(this.#counter.value));
  }
}
