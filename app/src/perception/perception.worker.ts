/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type FromWorker,
  type PerceptionOptions,
  type ToWorker,
} from './protocol';
import { PoseTracker } from './tracker';

declare const self: DedicatedWorkerGlobalScope;

let landmarker: PoseLandmarker | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let frameId = 0;
let tracker = new PoseTracker(null);

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
  tracker = new PoseTracker(options.filter);
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

  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const tracked = tracker.process(landmarks, poses.length, width, height, start);
  const { player, body } = tracked;

  post(
    {
      type: 'detections',
      detections: {
        frameId: frameId++,
        receivedAt,
        inferenceMs,
        width,
        height,
        poseCount: poses.length,
        landmarks,
        lock: tracked.state,
        playerId: tracked.playerId,
        playerIndex: tracked.playerIndex,
        otherIndices: tracked.otherIndices,
        player,
        body,
      },
    },
    [landmarks.buffer, ...(player ? [player.buffer] : []), ...(body ? [body.buffer] : [])],
  );
}
