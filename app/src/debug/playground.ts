import './playground.css';
import type { IntentBus } from '../input/intent-bus';
import { elementRect, type TargetRegistry } from '../input/targets';
import { HudCursor } from '../hud/cursor';

const BUTTONS = 6;

/**
 * `?playground` — try the cursor and dwell-to-select with your body (or the mouse, F2).
 * Six large buttons; hold the cursor on one to select it.
 */
export class Playground {
  readonly #status = document.createElement('p');
  #count = 0;
  #mode = 'body';
  #presence = 'searching';

  constructor(parent: HTMLElement, bus: IntentBus, targets: TargetRegistry) {
    const grid = document.createElement('div');
    grid.className = 'playground';
    const buttons = new Map<string, HTMLElement>();
    for (let i = 1; i <= BUTTONS; i++) {
      const id = `button-${String(i)}`;
      const button = document.createElement('div');
      button.className = 'playground-button';
      button.textContent = `ปุ่ม ${String(i)}`;
      grid.append(button);
      buttons.set(id, button);
      targets.register(id, () => elementRect(button));
    }
    this.#status.className = 'playground-status';
    parent.append(grid, this.#status);

    const cursor = new HudCursor(parent);
    bus.on('cursor', (c) => {
      cursor.move(c);
    });
    bus.on('dwell', (d) => {
      cursor.setProgress(d.progress);
      for (const [id, el] of buttons)
        el.classList.toggle('hover', id === d.targetId && d.progress > 0);
    });
    bus.on('select', (s) => {
      this.#count++;
      cursor.setProgress(0);
      const el = buttons.get(s.targetId);
      // Remove then re-add on the next frame to restart the flash animation.
      el?.classList.remove('selected');
      requestAnimationFrame(() => el?.classList.add('selected'));
      this.#render(`เลือก ${el?.textContent ?? s.targetId} แล้ว (${s.source})`);
    });
    bus.on('presence', (p) => {
      this.#presence = p.state;
      this.#render();
    });
    this.#render('ยกมือชี้ไปที่ปุ่ม แล้วค้างไว้');
  }

  setMode(mode: 'body' | 'mouse'): void {
    this.#mode = mode;
    this.#render();
  }

  #last = '';
  #render(message = this.#last): void {
    this.#last = message;
    this.#status.textContent = `${message} · เลือกไปแล้ว ${String(this.#count)} ครั้ง · input: ${this.#mode} (F2) · player: ${this.#presence} · F1 debug`;
  }
}
