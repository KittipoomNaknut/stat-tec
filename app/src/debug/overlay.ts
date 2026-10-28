import './overlay.css';
import { RateMeter, RollingWindow } from '../core/rolling-stats';
import type { CameraSettings, CameraStatus } from '../perception/camera';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type PerceptionOptions,
  type PoseDetections,
} from '../perception/protocol';
import { Landmark } from '../perception/landmarks';
import { POSE_CONNECTIONS } from '../perception/skeleton';
import { JitterMeter } from './jitter';

const WINDOW = 120;
const TEXT_REFRESH_MS = 250;
const MIN_VISIBILITY = 0.5;

const COLOR_PLAYER = '#3fe0ff';
const COLOR_OTHER = '#ffc857';
const COLOR_RAW = 'rgba(255, 255, 255, 0.45)';

/**
 * Developer view: mirrored camera feed, skeletons and live performance numbers.
 * F1 toggles the overlay, F3 toggles the unfiltered skeleton. Not part of the visitor experience.
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
  readonly #rawJitter = new JitterMeter();
  readonly #filteredJitter = new JitterMeter();

  #detections: PoseDetections | null = null;
  #drawnFrameId = -1;
  #showRaw = false;
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
      } else if (e.key === 'F3') {
        e.preventDefault();
        this.#showRaw = !this.#showRaw;
        this.#drawnFrameId = -1;
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
    if (detections.player) {
      this.#rawJitter.add(
        detections.landmarks,
        detections.width,
        detections.height,
        detections.playerIndex,
      );
      this.#filteredJitter.add(detections.player, detections.width, detections.height);
    } else {
      this.#rawJitter.reset();
      this.#filteredJitter.reset();
    }
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
    this.#ctx.clearRect(0, 0, width, height);
    if (d.width === 0 || d.height === 0) return;

    // Match the video's object-fit: contain + horizontal mirror.
    const scale = Math.min(width / d.width, height / d.height);
    const box = {
      left: (width - d.width * scale) / 2,
      top: (height - d.height * scale) / 2,
      w: d.width * scale,
      h: d.height * scale,
    };

    for (const pose of d.otherIndices) {
      this.#drawPose(d.landmarks, pose, box, COLOR_OTHER, 3 * dpr);
    }
    if (this.#showRaw && d.playerIndex >= 0) {
      this.#drawPose(d.landmarks, d.playerIndex, box, COLOR_RAW, 2 * dpr);
    }
    if (d.player) this.#drawPose(d.player, 0, box, COLOR_PLAYER, 4 * dpr);
  }

  #drawPose(
    data: Float32Array,
    pose: number,
    box: { left: number; top: number; w: number; h: number },
    color: string,
    lineWidth: number,
  ): void {
    const ctx = this.#ctx;
    const base = pose * LANDMARK_COUNT * LANDMARK_STRIDE;
    const x = (i: number) => box.left + (1 - (data[base + i * LANDMARK_STRIDE] ?? 0)) * box.w;
    const y = (i: number) => box.top + (data[base + i * LANDMARK_STRIDE + 1] ?? 0) * box.h;
    const visible = (i: number) => (data[base + i * LANDMARK_STRIDE + 3] ?? 0) >= MIN_VISIBILITY;

    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [a, b] of POSE_CONNECTIONS) {
      if (!visible(a) || !visible(b)) continue;
      ctx.moveTo(x(a), y(a));
      ctx.lineTo(x(b), y(b));
    }
    ctx.stroke();
    const dot = lineWidth * 1.5;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      if (visible(i)) ctx.fillRect(x(i) - dot / 2, y(i) - dot / 2, dot, dot);
    }
  }

  #describe(nowMs: number): string {
    const cam = this.#camera.settings;
    const p = this.#perception;
    const f = p?.filter;
    const lines = [
      `camera     ${this.#camera.status}${cam ? ` · ${cam.label} · ${String(cam.width)}×${String(cam.height)} @ ${cam.frameRate.toFixed(0)}` : ''}`,
      `gpu        ${this.#gpu}`,
      `model      ${p ? `${p.model} / ${p.delegate} / numPoses ${String(p.numPoses)}` : 'loading…'}`,
      `filter     ${f ? `one-euro minCutoff ${String(f.minCutoff)} · beta ${String(f.beta)} · dCutoff ${String(f.dCutoff)}` : p ? 'off' : '…'}`,
      `inference  ${ms(this.#inference.mean())} avg · ${ms(this.#inference.percentile(95))} p95 · ${this.#detectionRate.rate(nowMs).toFixed(1)} fps`,
      `player     ${describeLock(this.#detections)}`,
      `body (SW)  ${describeWrists(this.#detections?.body ?? null)}`,
      `jitter     raw ${px(this.#rawJitter.mean())} · filtered ${px(this.#filteredJitter.mean())}  (stand still)`,
      `worker→ui  ${ms(this.#workerToScreen.mean())} avg · ${ms(this.#workerToScreen.percentile(95))} p95`,
      `render     ${this.#renderRate.rate(nowMs).toFixed(1)} fps · frame ${ms(this.#frameTime.percentile(95))} p95`,
    ];
    if (this.#error !== null) lines.push(`ERROR      ${this.#error}`);
    lines.push('', `F1 hide · F3 raw skeleton ${this.#showRaw ? 'on' : 'off'}`);
    return lines.join('\n');
  }
}

function describeLock(d: PoseDetections | null): string {
  if (!d) return '–';
  const id = d.playerId > 0 ? ` #${String(d.playerId)}` : '';
  return `${d.lock}${id} · others ${String(d.otherIndices.length)} · detections ${String(d.poseCount)}`;
}

/** Wrist positions in body space: what cursor and gesture thresholds will read. */
function describeWrists(body: Float32Array | null): string {
  if (!body) return '–';
  const wrist = (name: string, i: number) => {
    const k = i * LANDMARK_STRIDE;
    const x = body[k] ?? 0;
    const y = body[k + 1] ?? 0;
    return `${name} (${signed(x)}, ${signed(y)})`;
  };
  return `${wrist('R wrist', Landmark.RIGHT_WRIST)} · ${wrist('L wrist', Landmark.LEFT_WRIST)}`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function px(value: number): string {
  return `${value.toFixed(2)} px`;
}

function detectGpu(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'WebGL2 unavailable';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return String(renderer);
}
