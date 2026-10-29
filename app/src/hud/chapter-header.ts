import { restartAnimation } from './restart-animation';
/**
 * Center-top title block: chapter name with its data-science concept, the lesson card's term,
 * or the attract title. Swaps with a short fade + rise (transform/opacity only).
 */
export class ChapterHeader {
  readonly #root = document.createElement('section');
  readonly #eyebrow: HTMLElement;
  readonly #title: HTMLElement;
  #key = '';

  constructor(parent: HTMLElement) {
    this.#root.className = 'hud-header';
    this.#root.innerHTML = `<p class="hud-label hud-label-accent"></p><h1 class="hud-headline"></h1>`;
    this.#eyebrow = this.#root.querySelector('p') as HTMLElement;
    this.#title = this.#root.querySelector('h1') as HTMLElement;
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  show(eyebrow: string, title: string, variant: 'chapter' | 'lesson' = 'chapter'): void {
    const key = `${variant}|${eyebrow}|${title}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#eyebrow.textContent = eyebrow;
    this.#title.textContent = title;
    this.#root.dataset['variant'] = variant;
    this.#root.hidden = false;
    restartAnimation(this.#root, 'is-entering');
  }

  hide(): void {
    this.#key = '';
    this.#root.hidden = true;
  }
}
