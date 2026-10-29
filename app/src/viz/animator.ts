/** Easing curves (t in [0, 1]). */
export const ease = {
  linear: (t: number) => t,
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
};

interface Job {
  elapsed: number;
  delay: number;
  duration: number;
  ease: (t: number) => number;
  onUpdate: (t: number) => void;
  resolve: () => void;
}

/**
 * Frame-stepped tweens for scene choreography. Time only moves when `update(dt)` is called, so
 * a paused visit freezes mid-animation and `?speed` replays faster. Choreography reads as code:
 *
 *   await anim.tween(600, (t) => (axis.style.opacity = String(t)));
 *   await Promise.all(points.map((p, i) => anim.tween(400, move(p), { delay: i * 80 })));
 */
export class Animator {
  #jobs: Job[] = [];
  #cancelled = false;

  /** Animates `onUpdate` from 0 to 1 (eased) over `durationMs`; resolves when done. */
  tween(
    durationMs: number,
    onUpdate: (t: number) => void,
    options: { delay?: number; ease?: (t: number) => number } = {},
  ): Promise<void> {
    if (this.#cancelled) return new Promise(() => undefined);
    return new Promise((resolve) => {
      this.#jobs.push({
        elapsed: 0,
        delay: options.delay ?? 0,
        duration: Math.max(durationMs, 1),
        ease: options.ease ?? ease.outExpo,
        onUpdate,
        resolve,
      });
    });
  }

  wait(ms: number): Promise<void> {
    return this.tween(ms, () => undefined, { ease: ease.linear });
  }

  update(dtMs: number): void {
    const done: Job[] = [];
    for (const job of this.#jobs) {
      job.elapsed += dtMs;
      const t = Math.min(1, Math.max(0, (job.elapsed - job.delay) / job.duration));
      if (job.elapsed >= job.delay) job.onUpdate(job.ease(t));
      if (t >= 1) done.push(job);
    }
    if (done.length === 0) return;
    this.#jobs = this.#jobs.filter((j) => !done.includes(j));
    for (const job of done) job.resolve();
  }

  /** Stops everything; pending promises never resolve (the scene is going away). */
  cancel(): void {
    this.#cancelled = true;
    this.#jobs = [];
  }
}
