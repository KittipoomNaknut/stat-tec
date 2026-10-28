/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  LANDMARK_COUNT,
  LANDMARK_STRIDE,
  type FromWorker,
  type PerceptionOptions,
  type ToWorker,
} from './protocol';
import {
  binaryKind,
  decodeDetections,
  DETECTIONS_MAGIC,
  parseText,
  PREVIEW_MAGIC,
  previewJpeg,
} from './server-protocol';
import { PoseTracker } from './tracker';

declare const self: DedicatedWorkerGlobalScope;

/** Use MediaPipe instead if the perception service has not said hello by then. */
const SERVER_CONNECT_TIMEOUT_MS = 3000;
const SERVER_RECONNECT_MS = 2000;

let landmarker: PoseLandmarker | null = null;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let frameId = 0;
let tracker = new PoseTracker(null);
let socket: WebSocket | null = null;
let previewWanted = false;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      init(message.options).catch(fail);
      break;
    case 'frames':
      consume(message.stream).catch(fail);
      break;
    case 'preview':
      previewWanted = message.enabled;
      sendPreviewWish();
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
  tracker = new PoseTracker(options.filter);
  if (options.source === 'server') {
    try {
      const model = await connectServer(options.serverUrl);
      post({ type: 'ready', options, model });
      return;
    } catch (error) {
      console.warn('[perception] service unavailable, falling back to MediaPipe:', error);
    }
  }
  await initMediaPipe({ ...options, source: 'mediapipe' });
}

// ---------- Source: perception service (ADR-0007) ----------

/**
 * Resolves with the service's model name once it says hello, or rejects if it does not within
 * SERVER_CONNECT_TIMEOUT_MS. After a successful hello, a dropped connection retries forever.
 */
function connectServer(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let ready = false;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timeout = setTimeout(() => {
      ws.close();
    }, SERVER_CONNECT_TIMEOUT_MS);

    ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      const data = event.data;
      if (typeof data === 'string') {
        const text = parseText(data);
        if (text?.type === 'hello' && !ready) {
          ready = true;
          clearTimeout(timeout);
          socket = ws;
          sendPreviewWish();
          post({ type: 'camera', camera: text.camera });
          post({ type: 'server', connected: true, fps: 0, inferenceMs: 0 });
          resolve(text.model);
        } else if (text?.type === 'status') {
          post({ type: 'server', connected: true, fps: text.fps, inferenceMs: text.inferenceMs });
        }
        return;
      }
      const kind = binaryKind(data);
      if (kind === DETECTIONS_MAGIC) {
        onServerDetections(data);
      } else if (kind === PREVIEW_MAGIC) {
        const jpeg = previewJpeg(data);
        post({ type: 'preview', jpeg }, [jpeg]);
      }
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (socket === ws) socket = null;
      if (!ready) {
        reject(new Error(`no hello from ${url}`));
        return;
      }
      post({ type: 'server', connected: false, fps: 0, inferenceMs: 0 });
      reconnectLater(url);
    };
  });
}

function reconnectLater(url: string): void {
  setTimeout(() => {
    connectServer(url).catch(() => {
      reconnectLater(url);
    });
  }, SERVER_RECONNECT_MS);
}

function sendPreviewWish(): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'preview', enabled: previewWanted }));
  }
}

function onServerDetections(message: ArrayBuffer): void {
  const d = decodeDetections(message);
  // Capture time on this worker's clock, so the filters see the real interval between frames.
  const tMs = d.capturedAt - performance.timeOrigin;
  publish(d.landmarks, d.people, d.width, d.height, d.capturedAt, d.inferenceMs, tMs);
}

// ---------- Source: MediaPipe in the browser (fallback) ----------

async function initMediaPipe(options: PerceptionOptions): Promise<void> {
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
  post({
    type: 'ready',
    options: { ...options, delegate },
    model: `mediapipe ${options.model}/${delegate}`,
  });
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
  publish(
    landmarks,
    poses.length,
    frame.displayWidth,
    frame.displayHeight,
    receivedAt,
    inferenceMs,
    start,
  );
}

// ---------- Shared ----------

/** Runs the tracker on raw detections from either source and posts the result. */
function publish(
  landmarks: Float32Array,
  poseCount: number,
  width: number,
  height: number,
  receivedAt: number,
  inferenceMs: number,
  tMs: number,
): void {
  const tracked = tracker.process(landmarks, poseCount, width, height, tMs);
  const { player, body, shown } = tracked;
  post(
    {
      type: 'detections',
      detections: {
        frameId: frameId++,
        receivedAt,
        inferenceMs,
        width,
        height,
        poseCount,
        landmarks,
        lock: tracked.state,
        playerId: tracked.playerId,
        playerIndex: tracked.playerIndex,
        otherIndices: tracked.otherIndices,
        player,
        body,
        playerShown: shown,
      },
    },
    [landmarks, player, body, shown].flatMap((a) => (a ? [a.buffer] : [])),
  );
}
