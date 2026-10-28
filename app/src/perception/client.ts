import type { FromWorker, PerceptionOptions, PoseDetections, ToWorker } from './protocol';

export interface PerceptionEvents {
  onReady: (options: PerceptionOptions) => void;
  onDetections: (detections: PoseDetections) => void;
  onError: (message: string) => void;
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
          events.onReady(message.options);
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

  #send(message: ToWorker, transfer: Transferable[] = []): void {
    this.#worker.postMessage(message, transfer);
  }
}
