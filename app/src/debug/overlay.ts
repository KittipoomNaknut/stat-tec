import './overlay.css';
import { RateMeter, RollingWindow } from '../core/rolling-stats';
import type { CameraSettings, CameraStatus } from '../perception/camera';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type PerceptionOptions,
  type PoseDetections,
} from '../perception/protocol';
import { POSE_CONNECTIONS } from '../perception/skeleton';

const WINDOW = 120;
const TEXT_REFRESH_MS = 250;
const MIN_VISIBILITY = 0.5;

/**
 * Developer view (F1): mirrored camera feed, skeletons of every detected pose and live
 * performance numbers. Not part of the visitor experience.
 */
export class DebugOverlay {
  readonly #root = document.createElement('div');
  readonly #video = document.createElement('video');
  readonly #canvas = document.createElement('canvas');
  readonly #ctx: CanvasRenderingContext2D;
  readonly #panel = document.createElement('pre');

  readonly #frameTime = new RollingWindow(WINDOW);
  readonly #renderRate = new RateMeter(WINDOW);
  readonly #inference = new RollingWindow(WINDOW);
  readonly #detectionRate = new RateMeter(WINDOW);
  readonly #workerToScreen = new RollingWindow(WINDOW);

  #detections: PoseDetections | null = null;
  #drawnFrameId = -1;
  #camera: { status: CameraStatus; settings: CameraSettings | null } = {
    status: 'connecting',
    settings: null,
  };
  #perception: PerceptionOptions | null = null;
  #error: string | null = null;
  #lastTextUpdate = 0;
  readonly #gpu = detectGpu();

  constructor(parent: HTMLElement) {
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.#ctx = ctx;

    this.#root.className = 'debug-overlay';
    this.#video.muted = true;
    this.#video.playsInline = true;
    this.#panel.className = 'debug-panel';
    this.#root.append(this.#video, this.#canvas, this.#panel);
    parent.append(this.#root);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        this.#root.hidden = !this.#root.hidden;
      }
    });
  }

  setCameraStatus(status: CameraStatus): void {
    this.#camera.status = status;
  }

  setCameraTrack(track: MediaStreamTrack, settings: CameraSettings): void {
    this.#camera.settings = settings;
    this.#video.srcObject = new MediaStream([track]);
    void this.#video.play();
  }

  setPerception(options: PerceptionOptions): void {
    this.#perception = options;
  }

  /** Pass `null` to clear once the problem is resolved. */
  setError(message: string | null): void {
    this.#error = message;
  }

  addDetections(detections: PoseDetections): void {
    this.#detections = detections;
    this.#inference.push(detections.inferenceMs);
    this.#detectionRate.tick(performance.now());
  }

  update(dtMs: number, nowMs: number): void {
    this.#frameTime.push(dtMs);
    this.#renderRate.tick(nowMs);
    if (this.#root.hidden) return;

    const d = this.#detections;
    if (d && d.frameId !== this.#drawnFrameId) {
      this.#drawnFrameId = d.frameId;
      this.#workerToScreen.push(performance.timeOrigin + nowMs - d.receivedAt);
      this.#drawSkeletons(d);
    }
    if (nowMs - this.#lastTextUpdate >= TEXT_REFRESH_MS) {
      this.#lastTextUpdate = nowMs;
      this.#panel.textContent = this.#describe(nowMs);
    }
  }

  #drawSkeletons(d: PoseDetections): void {
    const canvas = this.#canvas;
    const dpr = window.devicePixelRatio;
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = this.#ctx;
    ctx.clearRect(0, 0, width, height);
    if (d.width === 0 || d.height === 0) return;

    // Match the video's object-fit: contain + horizontal mirror.
    const scale = Math.min(width / d.width, height / d.height);
    const w = d.width * scale;
    const h = d.height * scale;
    const left = (width - w) / 2;
    const top = (height - h) / 2;
    const x = (pose: number, i: number) => {
      const v = d.landmarks[(pose * LANDMARK_COUNT + i) * LANDMARK_STRIDE] ?? 0;
      return left + (1 - v) * w;
    };
    const y = (pose: number, i: number) =>
      top + (d.landmarks[(pose * LANDMARK_COUNT + i) * LANDMARK_STRIDE + 1] ?? 0) * h;
    const visible = (pose: number, i: number) =>
      (d.landmarks[(pose * LANDMARK_COUNT + i) * LANDMARK_STRIDE + 3] ?? 0) >= MIN_VISIBILITY;

    ctx.lineWidth = 3 * dpr;
    ctx.lineCap = 'round';
    for (let pose = 0; pose < d.poseCount; pose++) {
      ctx.strokeStyle = pose === 0 ? '#3fe0ff' : '#ffc857';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      for (const [a, b] of POSE_CONNECTIONS) {
        if (!visible(pose, a) || !visible(pose, b)) continue;
        ctx.moveTo(x(pose, a), y(pose, a));
        ctx.lineTo(x(pose, b), y(pose, b));
      }
      ctx.stroke();
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        if (!visible(pose, i)) continue;
        ctx.fillRect(x(pose, i) - 3 * dpr, y(pose, i) - 3 * dpr, 6 * dpr, 6 * dpr);
      }
    }
  }

  #describe(nowMs: number): string {
    const cam = this.#camera.settings;
    const p = this.#perception;
    const lines = [
      `camera     ${this.#camera.status}${cam ? ` · ${cam.label} · ${String(cam.width)}×${String(cam.height)} @ ${cam.frameRate.toFixed(0)}` : ''}`,
      `gpu        ${this.#gpu}`,
      `model      ${p ? `${p.model} / ${p.delegate} / numPoses ${String(p.numPoses)}` : 'loading…'}`,
      `inference  ${ms(this.#inference.mean())} avg · ${ms(this.#inference.percentile(95))} p95 · ${this.#detectionRate.rate(nowMs).toFixed(1)} fps`,
      `poses      ${String(this.#detections?.poseCount ?? 0)}`,
      `worker→ui  ${ms(this.#workerToScreen.mean())} avg · ${ms(this.#workerToScreen.percentile(95))} p95`,
      `render     ${this.#renderRate.rate(nowMs).toFixed(1)} fps · frame ${ms(this.#frameTime.percentile(95))} p95`,
    ];
    if (this.#error !== null) lines.push(`ERROR      ${this.#error}`);
    lines.push('', 'F1 hide');
    return lines.join('\n');
  }
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function detectGpu(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'WebGL2 unavailable';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return String(renderer);
}
