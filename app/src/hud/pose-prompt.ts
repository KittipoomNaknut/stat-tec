import { gestureConfig } from '../config/gestures';
import { boothLog } from '../core/booth-log';
import type { PoseName } from '../gestures/pose';
import type { IntentBus } from '../input/intent-bus';
import './pose-prompt.css';

export interface PoseOption {
  pose: PoseName;
  label: string;
}

type Arm = readonly [number, number];
/** Hand positions of the pictogram, as the player sees themselves (mirror: their left on the left). */
const ARMS: Record<PoseName | 'rest', { left: Arm; right: Arm }> = {
  rest: { left: [34, 74], right: [66, 74] },
  'both-up': { left: [18, 4], right: [82, 4] },
  'left-up': { left: [18, 4], right: [66, 74] },
  'right-up': { left: [34, 74], right: [82, 4] },
  't-pose': { left: [4, 40], right: [96, 40] },
  cross: { left: [64, 62], right: [36, 62] },
};

/** A stick figure doing the pose (SVG markup). */
export function posePictogram(pose: PoseName): string {
  const { left, right } = ARMS[pose];
  const elbow = (s: Arm, h: Arm): Arm => [(s[0] + h[0]) / 2, (s[1] + h[1]) / 2];
  const arm = (s: Arm, h: Arm) => {
    const e = elbow(s, h);
    return `<polyline points="${String(s[0])},${String(s[1])} ${String(e[0])},${String(e[1])} ${String(h[0])},${String(h[1])}" />`;
  };
  return `<svg class="pose-figure" viewBox="0 0 100 120" aria-hidden="true">
    <circle cx="50" cy="20" r="10" />
    <line x1="50" y1="30" x2="50" y2="76" />
    <polyline points="40,116 50,76 60,116" />
    ${arm([42, 40], left)}${arm([58, 40], right)}
    <circle class="pose-hand" cx="${String(left[0])}" cy="${String(left[1])}" r="5" />
    <circle class="pose-hand" cx="${String(right[0])}" cy="${String(right[1])}" r="5" />
  </svg>`;
}

/**
 * Pose answers (research 025): a card per option with a stick figure doing the pose. The card
 * of the pose the player is holding fills up; when the hold completes on an offered pose,
 * `onSelect` runs once.
 */
export class PosePrompt {
  readonly element = document.createElement('div');
  readonly #cards = new Map<PoseName, HTMLElement>();
  readonly #off: () => void;
  #done = false;
  #holding: { pose: PoseName; since: number } | null = null;

  constructor(
    parent: HTMLElement,
    bus: IntentBus,
    options: readonly PoseOption[],
    onSelect: (pose: PoseName) => void,
  ) {
    this.element.className = 'pose-prompt';
    this.element.dataset['poses'] = options.map((o) => o.pose).join(',');
    for (const o of options) {
      const card = document.createElement('div');
      card.className = 'hud-panel pose-card';
      card.dataset['pose'] = o.pose;
      card.innerHTML = `${posePictogram(o.pose)}<span class="pose-label"></span><i class="pose-fill" aria-hidden="true"></i>`;
      (card.querySelector('.pose-label') as HTMLElement).textContent = o.label;
      this.#cards.set(o.pose, card);
      this.element.append(card);
    }
    parent.append(this.element);
    // The prompt times the hold itself, from when it first sees the pose: a player already in
    // the pose when the prompt appears still gets it (the detector fires once per hold).
    this.#off = bus.on('pose', (p) => {
      if (this.#done) return;
      const offered = p.pose !== null && this.#cards.has(p.pose) ? p.pose : null;
      if (offered !== this.#holding?.pose) {
        this.#holding = offered ? { pose: offered, since: p.t } : null;
      }
      const progress = this.#holding
        ? Math.min(1, (p.t - this.#holding.since) / gestureConfig.pose.holdMs)
        : 0;
      for (const [pose, card] of this.#cards) {
        const on = pose === offered;
        card.style.setProperty('--p', on ? String(progress) : '0');
        card.classList.toggle('is-holding', on);
      }
      if (offered && progress >= 1) {
        this.#done = true;
        this.#cards.get(offered)?.classList.add('is-chosen');
        onSelect(offered);
      }
    });
  }

  dispose(): void {
    this.#off();
    this.element.remove();
  }
}

/**
 * Asks a pose question in a centered stage: resolves with the pose held, or `null` once
 * `timeoutMs` of story time passes (`tween` is the scene's Animator, so pausing pauses it).
 */
export function askPose(
  parent: HTMLElement,
  bus: IntentBus,
  options: readonly PoseOption[],
  tween: (ms: number, step: (t: number) => void) => Promise<void>,
  timeoutMs: number,
  layout: 'stage' | 'list' = 'stage',
): Promise<PoseName | null> {
  const stage = document.createElement('div');
  // stage: centered cards over the scene · list: compact rows inside a side panel
  stage.className = layout === 'stage' ? 'pose-stage is-entering' : 'pose-list';
  parent.append(stage);
  const askedAt = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (pose: PoseName | null) => {
      if (settled) return;
      settled = true;
      // The booth log: which pose, and how long the player took (or that nobody answered)
      boothLog('pose', {
        prompt: options.map((o) => o.pose).join(','),
        pose,
        waitMs: Math.round(performance.now() - askedAt),
      });
      // Leave the chosen card on screen a moment so the player sees it took
      setTimeout(
        () => {
          prompt.dispose();
          stage.remove();
        },
        pose ? 500 : 0,
      );
      resolve(pose);
    };
    const prompt = new PosePrompt(stage, bus, options, finish);
    const timer = document.createElement('div');
    timer.className = 'pose-timer';
    timer.append(document.createElement('i'));
    stage.append(timer);
    const bar = timer.firstElementChild as HTMLElement;
    void tween(timeoutMs, (t) => {
      bar.style.transform = `scaleX(${String(1 - t)})`;
    }).then(() => {
      finish(null);
    });
  });
}
