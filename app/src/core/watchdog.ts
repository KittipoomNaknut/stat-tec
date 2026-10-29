/**
 * Keeps the kiosk running unattended (ARCHITECTURE §14): an unexpected error sends the visit back
 * to attract, repeated errors reload the page, a silent perception pipeline shows "reconnecting"
 * and eventually reloads, and a bloated heap is reloaded at a quiet moment (attract).
 */
export interface WatchdogActions {
  /** Back to attract (the app machine's RESET). */
  reset(): void;
  /** Full page reload: the last resort that clears everything. */
  reload(reason: string): void;
  /** Perception stopped (true) or came back (false). */
  onStall(stalled: boolean): void;
  log?(message: string): void;
}

export const WATCHDOG = {
  /** This many errors within `errorWindowMs` → reload instead of reset. */
  maxErrors: 3,
  errorWindowMs: 60_000,
  /** No pose frame for this long (after having had some) → stalled. */
  stallMs: 2000,
  /** Stalled this long → reload (respawns the worker and reconnects everything). */
  stallReloadMs: 15_000,
  /** JS heap above this when the kiosk is idle → reload. */
  maxHeapBytes: 1.5 * 1024 ** 3,
};

export class Watchdog {
  readonly #actions: WatchdogActions;
  readonly #config: typeof WATCHDOG;
  #errors: number[] = [];
  #lastFrame = -1;
  #stalledSince = -1;
  #reloading = false;

  constructor(actions: WatchdogActions, config = WATCHDOG) {
    this.#actions = actions;
    this.#config = config;
  }

  get stalled(): boolean {
    return this.#stalledSince >= 0;
  }

  error(message: string, nowMs: number): void {
    this.#actions.log?.(`error: ${message}`);
    this.#errors = this.#errors.filter((t) => nowMs - t < this.#config.errorWindowMs);
    this.#errors.push(nowMs);
    if (this.#errors.length >= this.#config.maxErrors)
      this.#reload(`${String(this.#errors.length)} errors in a minute`);
    else this.#actions.reset();
  }

  /** A pose frame arrived from perception. */
  frame(nowMs: number): void {
    this.#lastFrame = nowMs;
    if (this.#stalledSince >= 0) {
      this.#stalledSince = -1;
      this.#actions.onStall(false);
    }
  }

  /** Call every animation frame. */
  check(nowMs: number): void {
    if (this.#lastFrame < 0) return; // perception never started (mouse-only dev): nothing to watch
    const silent = nowMs - this.#lastFrame;
    if (this.#stalledSince < 0 && silent > this.#config.stallMs) {
      this.#stalledSince = nowMs;
      this.#actions.onStall(true);
    }
    if (this.#stalledSince >= 0 && nowMs - this.#stalledSince > this.#config.stallReloadMs) {
      this.#reload('perception silent');
    }
  }

  /** Call when the kiosk is idle (attract): reload if the heap has grown too big. */
  idle(heapBytes: number | null): void {
    if (heapBytes !== null && heapBytes > this.#config.maxHeapBytes) {
      this.#reload(`heap ${String(Math.round(heapBytes / 1024 ** 2))} MB`);
    }
  }

  #reload(reason: string): void {
    if (this.#reloading) return;
    this.#reloading = true;
    this.#actions.log?.(`reload: ${reason}`);
    this.#actions.reload(reason);
  }
}
