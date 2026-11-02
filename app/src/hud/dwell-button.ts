import { restartAnimation } from './restart-animation';
import type { IntentBus } from '../input/intent-bus';
import { elementRect, type TargetRegistry } from '../input/targets';

/**
 * A button you select by holding the cursor on it (or clicking, in mouse mode). The button
 * itself fills while the player dwells — the feedback is where they are looking (research 011).
 */
export class DwellButton {
  readonly element = document.createElement('div');
  readonly id: string;
  readonly #off: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    bus: IntentBus,
    targets: TargetRegistry,
    id: string,
    label: string,
    onSelect: () => void,
    hint = 'HOLD',
  ) {
    this.id = id;
    this.element.className = 'hud-panel hud-button';
    this.element.dataset['target'] = id;
    const text = document.createElement('span');
    text.textContent = label;
    const sub = document.createElement('span');
    sub.className = 'hud-button-hint';
    sub.textContent = hint;
    const beam = document.createElement('div');
    beam.className = 'hud-beam';
    beam.append(document.createElement('i'));
    this.element.append(text, sub, beam);
    parent.append(this.element);
    this.#off.push(
      // A leaving scene marks its HUD inert: its buttons stop being targets at once.
      targets.register(id, () =>
        this.element.isConnected && !this.element.closest('[inert]')
          ? elementRect(this.element)
          : null,
      ),
      bus.on('dwell', (d) => {
        if (d.targetId !== this.id) return;
        this.element.style.setProperty('--dwell', String(d.progress));
        this.element.classList.toggle('is-hover', d.progress > 0);
      }),
      bus.on('select', (s) => {
        if (s.targetId !== this.id) return;
        this.element.style.setProperty('--dwell', '0');
        this.element.classList.remove('is-hover');
        restartAnimation(this.element, 'is-selected');
        onSelect();
      }),
    );
  }

  dispose(): void {
    for (const off of this.#off) off();
    this.element.remove();
  }
}
