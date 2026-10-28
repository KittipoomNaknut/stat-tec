/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { OneEuroFilterBank } from './one-euro';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type FromWorker,
  type PerceptionOptions,
  type ToWorker,
} from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
/** A gap this long means the player left; start the filter fresh. */
const FILTER_RESET_GAP_MS = 500;

let landmarker: PoseLandmarker | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let frameId = 0;
/** One bank per axis (x, y, z), each with one channel per landmark. */
let filters: OneEuroFilterBank[] = [];
let lastPlayerAt = -Infinity;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      init(message.options).catch(fail);
      break;
    case 'frames':
      consume(message.stream).catch(fail);
      break;
  }
};

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function fail(error: unknown): void {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

async function init(options: PerceptionOptions): Promise<void> {
  // Absolute URLs: Vite's dev server would otherwise rewrite the loader's dynamic import.
  const base = new URL(import.meta.env.BASE_URL, self.location.origin).href;
  // Module build of the WASM loader: module workers cannot use importScripts.
  const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`, true);
  const create = (delegate: PerceptionOptions['delegate']) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${base}models/pose_landmarker_${options.model}.task`,
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: options.numPoses,
    });

  let delegate = options.delegate;
  try {
    landmarker = await create(delegate);
  } catch (error) {
    if (delegate === 'CPU') throw error;
    console.warn('[perception] GPU delegate unavailable, falling back to CPU', error);
    delegate = 'CPU';
    landmarker = await create(delegate);
  }
  const filter = options.filter;
  filters = filter ? [0, 1, 2].map(() => new OneEuroFilterBank(LANDMARK_COUNT, filter)) : [];
  post({ type: 'ready', options: { ...options, delegate } });
}

/** Reads frames as they arrive; the track processor drops frames while inference is busy. */
async function consume(stream: ReadableStream<VideoFrame>): Promise<void> {
  await reader?.cancel();
  const current = stream.getReader();
  reader = current;
  for (;;) {
    const { value: frame, done } = await current.read();
    if (done) return;
    try {
      if (landmarker) detect(landmarker, frame);
    } finally {
      frame.close();
    }
  }
}

function detect(model: PoseLandmarker, frame: VideoFrame): void {
  const receivedAt = performance.timeOrigin + performance.now();
  const start = performance.now();
  const result = model.detectForVideo(frame, start);
  const inferenceMs = performance.now() - start;

  const poses = result.landmarks;
  const landmarks = new Float32Array(poses.length * LANDMARK_COUNT * LANDMARK_STRIDE);
  let i = 0;
  for (const pose of poses) {
    for (const p of pose) {
      landmarks[i++] = p.x;
      landmarks[i++] = p.y;
      landmarks[i++] = p.z;
      landmarks[i++] = p.visibility;
    }
  }

  const player = poses.length > 0 ? filterPlayer(landmarks, start, frame) : null;

  post(
    {
      type: 'detections',
      detections: {
        frameId: frameId++,
        receivedAt,
        inferenceMs,
        width: frame.displayWidth,
        height: frame.displayHeight,
        poseCount: poses.length,
        landmarks,
        player,
      },
    },
    player ? [landmarks.buffer, player.buffer] : [landmarks.buffer],
  );
}

/** Smoothed copy of the first pose. Speeds are measured in shoulder widths per second. */
function filterPlayer(landmarks: Float32Array, tMs: number, frame: VideoFrame): Float32Array {
  const player = landmarks.slice(0, LANDMARK_COUNT * LANDMARK_STRIDE);
  if (filters.length === 0) return player;
  if (tMs - lastPlayerAt > FILTER_RESET_GAP_MS) {
    for (const f of filters) f.reset();
  }
  lastPlayerAt = tMs;

  const w = frame.displayWidth;
  const h = frame.displayHeight;
  const at = (i: number, axis: number) => player[i * LANDMARK_STRIDE + axis] ?? 0;
  const shoulderPx = Math.max(
    Math.hypot(
      (at(LEFT_SHOULDER, 0) - at(RIGHT_SHOULDER, 0)) * w,
      (at(LEFT_SHOULDER, 1) - at(RIGHT_SHOULDER, 1)) * h,
    ),
    1,
  );
  // x and z are normalized by width, y by height.
  const scales = [shoulderPx / w, shoulderPx / h, shoulderPx / w];
  filters.forEach((f, axis) => {
    f.filter(player, tMs, LANDMARK_STRIDE, axis, scales[axis]);
  });
  return player;
}
