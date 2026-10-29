/**
 * Full-screen system message over a dimmed stage: "paused — come back", "reconnecting".
 * Not the narrator box: these interrupt the story and must be impossible to miss.
 */
export class Notice {
  readonly #root = document.createElement('div');
  readonly #label: HTMLElement;
  readonly #text: HTMLElement;
  readonly #bar: HTMLElement;

  constructor(parent: HTMLElement) {
    this.#root.className = 'hud-notice';
    this.#root.innerHTML = `
      <div class="hud-panel hud-notice-card">
        <p class="hud-label hud-label-accent"></p>
        <p class="hud-notice-text"></p>
        <div class="hud-notice-bar"><i></i></div>
      </div>`;
    this.#label = this.#root.querySelector('.hud-label') as HTMLElement;
    this.#text = this.#root.querySelector('.hud-notice-text') as HTMLElement;
    this.#bar = this.#root.querySelector('.hud-notice-bar i') as HTMLElement;
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  /** `progress` 0..1 drains the bar (time left before the visit ends); `null` hides it. */
  show(label: string, text: string, progress: number | null = null): void {
    this.#root.hidden = false;
    if (this.#label.textContent !== label) this.#label.textContent = label;
    if (this.#text.textContent !== text) this.#text.textContent = text;
    this.#bar.parentElement?.toggleAttribute('hidden', progress === null);
    if (progress !== null) this.#bar.style.transform = `scaleX(${String(1 - progress)})`;
  }

  hide(): void {
    this.#root.hidden = true;
  }
}
