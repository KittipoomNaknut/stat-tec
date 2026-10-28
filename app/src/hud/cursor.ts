import './cursor.css';
import type { IntentOf } from '../input/intents';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

/** On-screen hand cursor with a dwell progress ring. Pure DOM, animated with transforms only. */
export class HudCursor {
  readonly #root = document.createElement('div');
  readonly #progress: SVGCircleElement;

  constructor(parent: HTMLElement) {
    this.#root.className = 'hud-cursor';
    this.#root.hidden = true;
    this.#root.innerHTML = `
      <svg viewBox="-30 -30 60 60" aria-hidden="true">
        <circle class="hud-cursor-dot" r="7" />
        <circle class="hud-cursor-track" r="${String(RING_R)}" />
        <circle class="hud-cursor-progress" r="${String(RING_R)}"
          stroke-dasharray="${String(RING_C)}" stroke-dashoffset="${String(RING_C)}" />
      </svg>`;
    const progress = this.#root.querySelector<SVGCircleElement>('.hud-cursor-progress');
    if (!progress) throw new Error('cursor markup missing');
    this.#progress = progress;
    parent.append(this.#root);
  }

  move(cursor: IntentOf<'cursor'>): void {
    this.#root.hidden = !cursor.visible;
    if (!cursor.visible) return;
    this.#root.style.transform = `translate(${String(cursor.x * 100)}vw, ${String(cursor.y * 100)}vh)`;
  }

  setProgress(progress: number): void {
    this.#progress.style.strokeDashoffset = String(RING_C * (1 - progress));
  }
}
