import { restartAnimation } from './restart-animation';
import { baht, CountUp } from './count-up';

/**
 * Corner tiles: chapter progress (top-left) and accumulated profit (top-right). Readable by the
 * crowd behind the player too (ARCHITECTURE §11.3: HUD label size).
 */
export class TopBar {
  readonly #root = document.createElement('header');
  readonly #chapterLabel: HTMLElement;
  readonly #progress: HTMLOListElement;
  readonly #profit: HTMLElement;
  readonly #profitTile: HTMLElement;
  readonly #count = new CountUp();
  #shown = '';

  constructor(parent: HTMLElement, chapterCount: number) {
    this.#root.className = 'hud-topbar';
    this.#root.innerHTML = `
      <div class="hud-panel hud-tile">
        <p class="hud-label"></p>
        <ol class="hud-progress">${'<li></li>'.repeat(chapterCount)}</ol>
      </div>
      <div class="hud-panel hud-tile hud-profit">
        <p class="hud-label-th">กำไรสะสม</p>
        <span class="hud-number">฿0</span>
      </div>`;
    this.#chapterLabel = this.#root.querySelector('.hud-label') as HTMLElement;
    this.#progress = this.#root.querySelector('.hud-progress') as HTMLOListElement;
    this.#profit = this.#root.querySelector('.hud-number') as HTMLElement;
    this.#profitTile = this.#root.querySelector('.hud-profit') as HTMLElement;
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  set visible(value: boolean) {
    this.#root.hidden = !value;
  }

  /** `index` is 0-based; −1 before the first chapter. */
  setChapter(index: number, count: number): void {
    const n = (i: number) => String(i).padStart(2, '0');
    if (index < 0) {
      this.#chapterLabel.innerHTML = `Briefing <span class="hud-label-accent">·</span> ${n(count)} chapters`;
    } else
      this.#chapterLabel.innerHTML = `Chapter <span class="hud-label-accent">${n(Math.max(index + 1, 0))}</span> / ${n(count)}`;
    [...this.#progress.children].forEach((li, i) => {
      li.className = i < index ? 'is-done' : i === index ? 'is-current' : '';
    });
  }

  setProfit(value: number, animate = true): void {
    if (animate && value > this.#count.target) {
      // Retrigger the gain pulse
      restartAnimation(this.#profitTile, 'is-gain');
    }
    this.#count.set(value, animate);
  }

  update(dtMs: number): void {
    this.#count.update(dtMs);
    const text = baht(this.#count.value);
    if (text !== this.#shown) {
      this.#shown = text;
      this.#profit.textContent = text;
    }
  }
}
