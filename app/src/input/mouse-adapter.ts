import { SlapDetector } from '../gestures/slap';
import type { IntentBus } from './intent-bus';
import type { TargetRegistry } from './targets';

/** Wheel delta per 10% zoom step. */
const WHEEL_STEP = 100;

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * Staff/dev fallback (F2): the mouse and keyboard emit the same intents as the body.
 * move → cursor (a fast flick also slaps) · click → select (hit-tested) · drag → draw ·
 * wheel → zoom · arrows → swipe
 */
export class MouseAdapter {
  readonly #bus: IntentBus;
  readonly #targets: TargetRegistry;
  readonly #view: { width: () => number; height: () => number };
  #enabled = false;
  #dragging = false;
  #moved = false;
  readonly #slap = new SlapDetector();

  constructor(
    source: EventTarget,
    bus: IntentBus,
    targets: TargetRegistry,
    view = { width: () => window.innerWidth, height: () => window.innerHeight },
  ) {
    this.#bus = bus;
    this.#targets = targets;
    this.#view = view;
    source.addEventListener('mousemove', (e) => {
      this.#onMove(e as MouseEvent);
    });
    source.addEventListener('mousedown', (e) => {
      this.#onDown(e as MouseEvent);
    });
    source.addEventListener('mouseup', (e) => {
      this.#onUp(e as MouseEvent);
    });
    source.addEventListener('wheel', (e) => {
      this.#onWheel(e as WheelEvent);
    });
    source.addEventListener('keydown', (e) => {
      this.#onKey(e as KeyboardEvent);
    });
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  set enabled(value: boolean) {
    if (this.#enabled && !value) {
      this.#bus.emit({
        type: 'cursor',
        x: 0,
        y: 0,
        hand: 'right',
        visible: false,
        ...this.#meta(),
      });
    }
    this.#enabled = value;
    this.#dragging = false;
  }

  #onMove(e: MouseEvent): void {
    if (!this.#enabled) return;
    const { x, y } = this.#point(e);
    this.#bus.emit({ type: 'cursor', x, y, hand: 'right', visible: true, ...this.#meta() });
    // Staff stand-in for raising a hand: the higher the pointer, the higher the hand.
    this.#bus.emit({ type: 'raise', hand: 'right', level: 1 - y, ...this.#meta() });
    const slap = this.#slap.update({ x, y, hand: 'right', visible: true }, performance.now());
    if (slap) this.#bus.emit({ ...slap, ...this.#meta() });
    if (this.#dragging) {
      if (!this.#moved) this.#bus.emit({ type: 'draw', phase: 'start', x, y, ...this.#meta() });
      this.#moved = true;
      this.#bus.emit({ type: 'draw', phase: 'move', x, y, ...this.#meta() });
    }
  }

  #onDown(e: MouseEvent): void {
    if (!this.#enabled || e.button !== 0) return;
    this.#dragging = true;
    this.#moved = false;
  }

  #onUp(e: MouseEvent): void {
    if (!this.#enabled || !this.#dragging) return;
    this.#dragging = false;
    const { x, y } = this.#point(e);
    if (this.#moved) {
      this.#bus.emit({ type: 'draw', phase: 'end', x, y, ...this.#meta() });
      return;
    }
    const targetId = this.#targets.hitTest(x, y);
    if (targetId !== null) this.#bus.emit({ type: 'select', targetId, ...this.#meta() });
  }

  #onWheel(e: WheelEvent): void {
    if (!this.#enabled) return;
    const scale = 1 - (e.deltaY / WHEEL_STEP) * 0.1;
    this.#bus.emit({ type: 'zoom', scale, ...this.#meta() });
  }

  #onKey(e: KeyboardEvent): void {
    if (!this.#enabled) return;
    const dir = ARROWS[e.key];
    if (dir) this.#bus.emit({ type: 'swipe', dir, speed: 1, ...this.#meta() });
  }

  #point(e: MouseEvent): { x: number; y: number } {
    return { x: e.clientX / this.#view.width(), y: e.clientY / this.#view.height() };
  }

  #meta() {
    return { t: performance.now(), source: 'mouse' as const };
  }
}
