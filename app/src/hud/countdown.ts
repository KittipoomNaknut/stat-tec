const R = 26;
const C = 2 * Math.PI * R;

/** Ring + seconds for play beats. Turns to the accent color in the last 5 seconds. */
export class Countdown {
  readonly #root = document.createElement('div');
  readonly #arc: SVGCircleElement;
  readonly #text: HTMLElement;
  #total = 0;
  #shown = -1;

  constructor(parent: HTMLElement) {
    this.#root.className = 'hud-countdown';
    this.#root.innerHTML = `
      <svg viewBox="-32 -32 64 64" aria-hidden="true">
        <circle class="hud-countdown-track" r="${String(R)}" />
        <circle class="hud-countdown-arc" r="${String(R)}" stroke-dasharray="${String(C)}" />
      </svg>
      <span class="hud-countdown-value"></span>`;
    this.#arc = this.#root.querySelector('.hud-countdown-arc') as SVGCircleElement;
    this.#text = this.#root.querySelector('.hud-countdown-value') as HTMLElement;
    this.#root.hidden = true;
    parent.append(this.#root);
  }

  update(remainingSec: number | null): void {
    if (remainingSec === null) {
      this.#root.hidden = true;
      this.#total = 0;
      return;
    }
    if (this.#total === 0) this.#total = remainingSec;
    this.#root.hidden = false;
    this.#arc.style.strokeDashoffset = String(C * (1 - remainingSec / Math.max(this.#total, 1e-3)));
    const s = Math.ceil(remainingSec);
    if (s !== this.#shown) {
      this.#shown = s;
      this.#text.textContent = String(s);
      this.#root.classList.toggle('is-ending', s <= 5);
    }
  }
}
