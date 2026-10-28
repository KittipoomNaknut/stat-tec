import { RollingWindow } from '../core/rolling-stats';

export interface AdaptiveResolutionConfig {
  /** Frame interval p95 (ms) above which frames are being dropped. 60 Hz healthy p95 ≈ 17. */
  slowP95Ms: number;
  /** p95 below this counts as headroom to scale back up. */
  fastP95Ms: number;
  /** Frames are judged in windows of this length. */
  windowMs: number;
  step: number;
  min: number;
  max: number;
  /** Fast windows needed before scaling up; doubles after each scale-down (no ping-pong). */
  recoverWindows: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveResolutionConfig = {
  slowP95Ms: 20,
  fastP95Ms: 18,
  windowMs: 2000,
  step: 0.1,
  min: 0.6,
  max: 1,
  recoverWindows: 2,
};

/**
 * Render scale controller (ARCHITECTURE §11.1). Judges the requestAnimationFrame interval:
 * GPU time is not measurable without timer queries, but dropped frames show up as long intervals.
 */
export class AdaptiveResolution {
  readonly #config: AdaptiveResolutionConfig;
  readonly #frames = new RollingWindow(512);
  #windowStart = -1;
  #fastWindows = 0;
  #recoverWindows: number;
  #scale: number;

  constructor(config: AdaptiveResolutionConfig = DEFAULT_ADAPTIVE) {
    this.#config = config;
    this.#scale = config.max;
    this.#recoverWindows = config.recoverWindows;
  }

  get scale(): number {
    return this.#scale;
  }

  /** Feeds one frame interval; returns true when the scale changed. */
  update(frameMs: number, nowMs: number): boolean {
    if (this.#windowStart < 0) this.#windowStart = nowMs;
    this.#frames.push(frameMs);
    if (nowMs - this.#windowStart < this.#config.windowMs) return false;

    const p95 = this.#frames.percentile(95);
    this.#frames.clear();
    this.#windowStart = nowMs;
    const { slowP95Ms, fastP95Ms, step, min, max } = this.#config;

    if (p95 > slowP95Ms && this.#scale > min) {
      this.#scale = round(Math.max(min, this.#scale - step));
      this.#fastWindows = 0;
      this.#recoverWindows *= 2;
      return true;
    }
    if (p95 < fastP95Ms && this.#scale < max) {
      this.#fastWindows++;
      if (this.#fastWindows >= this.#recoverWindows) {
        this.#scale = round(Math.min(max, this.#scale + step));
        this.#fastWindows = 0;
        return true;
      }
    } else {
      this.#fastWindows = 0;
    }
    return false;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
