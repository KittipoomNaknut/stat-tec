import './playground.css';
import type { IntentBus } from '../input/intent-bus';
import { elementRect, type TargetRegistry } from '../input/targets';
import { HudCursor } from '../hud/cursor';
import { DwellAttemptLog } from './dwell-log';
import { encodeSession } from './pose-recording';
import type { SessionRecorder } from './session-recorder';

const BUTTONS = 6;

/**
 * `?playground` — try the cursor and dwell-to-select with your body (or the mouse, F2).
 * Six large buttons; hold the cursor on one to select it.
 * Research 010: every dwell attempt is logged with its outcome; F9 downloads the attempts and
 * the raw pose recording of the session (landmarks only).
 */
export class Playground {
  readonly #status = document.createElement('p');
  #mode = 'body';
  #presence = 'searching';

  readonly #log: DwellAttemptLog;

  constructor(
    parent: HTMLElement,
    bus: IntentBus,
    targets: TargetRegistry,
    recorder: SessionRecorder,
  ) {
    this.#log = new DwellAttemptLog(bus, targets);
    this.#log.onChange(() => {
      this.#render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F9') return;
      e.preventDefault();
      void exportSession(this.#log, targets, recorder);
    });
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
    const s = this.#log.summary();
    const tried = s.selected + s['left-target'] + s['cursor-hidden'];
    const attempts = `กดติด ${String(s.selected)}/${String(tried)} · หลุดเป้า ${String(s['left-target'])} · cursor หาย ${String(s['cursor-hidden'])} · ผ่านเฉย ๆ ${String(s['passed-by'])}`;
    this.#status.textContent = `${message} · ${attempts} · input: ${this.#mode} (F2) · player: ${this.#presence} · F9 บันทึก · F1 debug`;
  }
}

async function exportSession(
  log: DwellAttemptLog,
  targets: TargetRegistry,
  recorder: SessionRecorder,
): Promise<void> {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const attempts = {
    version: 1,
    recordedAt: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    targets: targets.snapshot(),
    summary: log.summary(),
    attempts: log.attempts,
  };
  download(
    new Blob([JSON.stringify(attempts, null, 2)], { type: 'application/json' }),
    `playground-${stamp}.attempts.json`,
  );
  if (recorder.frames > 0) {
    download(await encodeSession(recorder.session()), `playground-${stamp}.pose.json.gz`);
  }
}

function download(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 10_000);
}
