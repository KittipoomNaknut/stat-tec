import { LANDMARK_STRIDE } from '../perception/protocol';
import { POSE_CONNECTIONS } from '../perception/skeleton';

/** Joints drawn (face points are noise at this size). */
const FIRST_BODY_JOINT = 11;
/** Camera frame shape when no preview has arrived yet (the service captures 16:9). */
const DEFAULT_ASPECT = 16 / 9;

/**
 * "The system sees you": the camera picture in a small frame, mirrored like a mirror, with the
 * tracked skeleton glowing on top. The picture comes from the perception service's preview and
 * is only drawn, never stored (ARCHITECTURE §17). Without a picture (the MediaPipe fallback,
 * E2E) the skeleton is drawn on its own.
 */
export class PlayerCam {
  readonly #root = document.createElement('div');
  readonly #canvas = document.createElement('canvas');
  readonly #ctx: CanvasRenderingContext2D;
  #frame: ImageBitmap | null = null;
  #decoding = false;
  #player: Float32Array | null = null;
  #shown: Uint8Array | null = null;
  #dirty = true;
  #enabled = false;

  constructor(parent: HTMLElement) {
    this.#root.className = 'hud-panel hud-player-cam';
    this.#root.hidden = true;
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.#ctx = ctx;
    const label = document.createElement('span');
    label.className = 'hud-player-cam-label';
    label.textContent = 'SCAN';
    this.#root.append(this.#canvas, label);
    parent.append(this.#root);
  }

  set visible(value: boolean) {
    this.#enabled = value;
    this.#sync();
  }

  /** A JPEG preview from the perception service; frames arriving mid-decode are dropped. */
  setFrame(jpeg: ArrayBuffer): void {
    if (this.#decoding) return;
    this.#decoding = true;
    createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
      .then((bitmap) => {
        this.#frame?.close();
        this.#frame = bitmap;
        this.#dirty = true;
        this.#sync();
      })
      .catch(() => undefined)
      .finally(() => {
        this.#decoding = false;
      });
  }

  setPose(player: Float32Array | null, shown: Uint8Array | null): void {
    this.#player = player;
    this.#shown = shown;
    this.#dirty = true;
    this.#sync();
  }

  /** Shown with a picture always (so a visitor can find their spot), else only with a body. */
  #sync(): void {
    this.#root.hidden = !this.#enabled || (!this.#frame && !this.#player);
    this.#root.classList.toggle('is-tracking', this.#player !== null);
  }

  draw(): void {
    if (!this.#dirty || this.#root.hidden) return;
    this.#dirty = false;
    const { width, height } = this.#canvas.getBoundingClientRect();
    const w = Math.round(width * devicePixelRatio);
    const h = Math.round(height * devicePixelRatio);
    if (w === 0 || h === 0) return;
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
    }
    const ctx = this.#ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Cover the box with the camera frame (centered crop), mirrored
    const frame = this.#frame;
    const aspect = frame ? frame.width / frame.height : DEFAULT_ASPECT;
    const scale = Math.max(w / aspect, h);
    const fw = scale * aspect;
    const fh = scale;
    const ox = (w - fw) / 2;
    const oy = (h - fh) / 2;
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (frame) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(frame, ox, oy, fw, fh);
      ctx.globalAlpha = 1;
      // A cool tint so the picture sits in the HUD instead of on top of it
      ctx.fillStyle = 'rgba(40, 8, 40, 0.28)';
      ctx.fillRect(0, 0, w, h);
    }

    const p = this.#player;
    if (!p) return;
    const on = (i: number) => i >= FIRST_BODY_JOINT && (this.#shown?.[i] ?? 1) === 1;
    const px = (i: number) => ox + (p[i * LANDMARK_STRIDE] ?? 0) * fw;
    const py = (i: number) => oy + (p[i * LANDMARK_STRIDE + 1] ?? 0) * fh;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffe3ef';
    ctx.shadowColor = 'rgba(255, 61, 143, 0.95)';
    ctx.shadowBlur = 10 * devicePixelRatio;
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.beginPath();
    for (const [a, b] of POSE_CONNECTIONS) {
      if (!on(a) || !on(b)) continue;
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
    ctx.fillStyle = '#ff3d8f';
    for (let i = FIRST_BODY_JOINT; i < p.length / LANDMARK_STRIDE; i++) {
      if (!on(i)) continue;
      ctx.beginPath();
      ctx.arc(px(i), py(i), 3.2 * devicePixelRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
