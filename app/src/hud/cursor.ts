import './cursor.css';
import type { IntentOf } from '../input/intents';
import type { Rect } from '../input/targets';

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;
/**
 * Display smoothing time constant. Pose updates arrive at 30 Hz but the screen draws at 60 Hz:
 * easing toward each new position removes the visible stepping (research 015).
 */
const FOLLOW_TAU_MS = 28;
/** While dwelling, the drawn cursor leans this far toward the button's center (visual only). */
const MAGNET = 0.35;

/** On-screen hand cursor with a dwell progress ring. Pure DOM, animated with transforms only. */
export class HudCursor {
  readonly #root = document.createElement('div');
  readonly #progress: SVGCircleElement;
  /** Latest position from the gesture engine, screen [0, 1]. */
  #target = { x: 0.5, y: 0.5 };
  /** Position drawn. */
  #shown = { x: 0.5, y: 0.5 };
  #visible = false;
  /** True once the owner calls frame(): then the cursor eases instead of jumping. */
  #animated = false;
  #magnet: { rect: Rect; strength: number } | null = null;

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
    const appearing = cursor.visible && !this.#visible;
    this.#visible = cursor.visible;
    this.#root.hidden = !cursor.visible;
    if (!cursor.visible) return;
    this.#target = { x: cursor.x, y: cursor.y };
    // Appear where the hand is, not sliding in from the last place it was seen.
    if (appearing || !this.#animated) {
      this.#shown = { ...this.#target };
      this.#draw();
    }
  }

  setProgress(progress: number): void {
    this.#progress.style.strokeDashoffset = String(RING_C * (1 - progress));
  }

  /** Lean toward the button being dwelled on (`null` to release). */
  setMagnet(rect: Rect | null, progress = 0): void {
    this.#magnet = rect ? { rect, strength: MAGNET * Math.min(1, progress * 2) } : null;
  }

  /** Call every animation frame for smooth motion between pose updates. */
  frame(dtMs: number): void {
    this.#animated = true;
    if (!this.#visible) return;
    const k = 1 - Math.exp(-dtMs / FOLLOW_TAU_MS);
    this.#shown.x += (this.#target.x - this.#shown.x) * k;
    this.#shown.y += (this.#target.y - this.#shown.y) * k;
    this.#draw();
  }

  #draw(): void {
    let { x, y } = this.#shown;
    const m = this.#magnet;
    if (m) {
      x += (m.rect.x + m.rect.w / 2 - x) * m.strength;
      y += (m.rect.y + m.rect.h / 2 - y) * m.strength;
    }
    this.#root.style.transform = `translate(${String(x * 100)}vw, ${String(y * 100)}vh)`;
  }
}
