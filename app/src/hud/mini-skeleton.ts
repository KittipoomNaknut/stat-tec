import { LANDMARK_STRIDE } from '../perception/protocol';
import { POSE_CONNECTIONS } from '../perception/skeleton';

/** Joints drawn (face points are noise at this size). */
const FIRST_BODY_JOINT = 11;

/**
 * Small glowing figure in the bottom-left corner: "the system sees you". It mirrors the player
 * so raising the right hand raises the figure's right-side hand on screen.
 */
export class MiniSkeleton {
  readonly #canvas = document.createElement('canvas');
  readonly #ctx: CanvasRenderingContext2D;
  #player: Float32Array | null = null;
  #shown: Uint8Array | null = null;
  #dirty = true;

  constructor(parent: HTMLElement) {
    this.#canvas.className = 'hud-panel hud-mini-skeleton';
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.#ctx = ctx;
    parent.append(this.#canvas);
  }

  #enabled = false;

  set visible(value: boolean) {
    this.#enabled = value;
    this.#canvas.hidden = !value || !this.#player;
  }

  setPose(player: Float32Array | null, shown: Uint8Array | null): void {
    this.#player = player;
    // An empty frame says "not tracked" louder than nothing: hide it with no body.
    this.#canvas.hidden = !this.#enabled || !player;
    this.#shown = shown;
    this.#dirty = true;
  }

  draw(): void {
    if (!this.#dirty || this.#canvas.hidden) return;
    this.#dirty = false;
    const { width, height } = this.#canvas.getBoundingClientRect();
    const w = Math.round(width * devicePixelRatio);
    const h = Math.round(height * devicePixelRatio);
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, w, h);
    const p = this.#player;
    if (!p) return;
    const on = (i: number) => i >= FIRST_BODY_JOINT && (this.#shown?.[i] ?? 1) === 1;
    // Fit the visible joints into the canvas, keeping the aspect ratio, mirrored.
    let x0 = 1,
      x1 = 0,
      y0 = 1,
      y1 = 0;
    for (let i = FIRST_BODY_JOINT; i < p.length / LANDMARK_STRIDE; i++) {
      if (!on(i)) continue;
      const x = p[i * LANDMARK_STRIDE] ?? 0;
      const y = p[i * LANDMARK_STRIDE + 1] ?? 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (x1 <= x0 || y1 <= y0) return;
    const pad = 0.14;
    const scale = Math.min((w * (1 - 2 * pad)) / (x1 - x0), (h * (1 - 2 * pad)) / (y1 - y0));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const px = (i: number) => w / 2 - ((p[i * LANDMARK_STRIDE] ?? 0) - cx) * scale;
    const py = (i: number) => h / 2 + ((p[i * LANDMARK_STRIDE + 1] ?? 0) - cy) * scale;

    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3fe0ff';
    ctx.shadowColor = 'rgba(63, 224, 255, 0.8)';
    ctx.shadowBlur = 8 * devicePixelRatio;
    ctx.lineWidth = 2.5 * devicePixelRatio;
    ctx.beginPath();
    for (const [a, b] of POSE_CONNECTIONS) {
      if (!on(a) || !on(b)) continue;
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
  }
}
