import type {
  CameraInfo,
  FromWorker,
  PerceptionOptions,
  PoseDetections,
  ToWorker,
} from './protocol';

export interface PerceptionEvents {
  /** `options.source` is the source in use (the service, or MediaPipe after a fallback). */
  onReady: (options: PerceptionOptions, model: string) => void;
  onDetections: (detections: PoseDetections) => void;
  onError: (message: string) => void;
  /** The service's camera (source `server` only). */
  onCamera?: (camera: CameraInfo) => void;
  /** JPEG preview from the service, while `setPreview(true)`. */
  onPreview?: (jpeg: ArrayBuffer) => void;
  onServer?: (status: { connected: boolean; fps: number; inferenceMs: number }) => void;
}

/** Frames reach the worker through MediaStreamTrackProcessor, which Firefox lacks on window. */
export function isPerceptionSupported(): boolean {
  return typeof MediaStreamTrackProcessor === 'function';
}

/** Main-thread handle to the perception worker. */
export class PerceptionClient {
  readonly #worker: Worker;

  constructor(options: PerceptionOptions, events: PerceptionEvents) {
    this.#worker = new Worker(new URL('./perception.worker.ts', import.meta.url), {
      type: 'module',
      name: 'perception',
    });
    this.#worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case 'ready':
          events.onReady(message.options, message.model);
          break;
        case 'camera':
          events.onCamera?.(message.camera);
          break;
        case 'preview':
          events.onPreview?.(message.jpeg);
          break;
        case 'server':
          events.onServer?.(message);
          break;
        case 'detections':
          events.onDetections(message.detections);
          break;
        case 'error':
          events.onError(message.message);
          break;
      }
    };
    this.#worker.onerror = (event) => {
      events.onError(event.message);
    };
    this.#send({ type: 'init', options });
  }

  /** Streams frames of `track` straight into the worker; call again after a camera reconnect. */
  attachTrack(track: MediaStreamTrack): void {
    const processor = new MediaStreamTrackProcessor({ track });
    // The lib types `readable` as ReadableStream<any>; video tracks yield VideoFrames.
    const stream = processor.readable as ReadableStream<VideoFrame>;
    this.#send({ type: 'frames', stream }, [stream]);
  }

  /** Ask the perception service for JPEG previews (debug overlay only). */
  setPreview(enabled: boolean): void {
    this.#send({ type: 'preview', enabled });
  }

  /** Stops the worker and frees its GPU resources. */
  dispose(): void {
    this.#worker.terminate();
  }

  #send(message: ToWorker, transfer: Transferable[] = []): void {
    this.#worker.postMessage(message, transfer);
  }
}
