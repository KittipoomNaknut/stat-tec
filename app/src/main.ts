import './style.css';
import { perceptionOptionsFromUrl } from './config/perception';
import { startLoop } from './core/loop';
import { BenchmarkView } from './debug/benchmark';
import { DebugOverlay } from './debug/overlay';
import { Camera } from './perception/camera';
import { isPerceptionSupported, PerceptionClient } from './perception/client';

const UNSUPPORTED = 'This browser cannot stream camera frames to a worker. Use Chrome/Chromium.';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const params = new URLSearchParams(location.search);
const cameraHint = params.get('camera');

if (params.has('bench')) {
  startBenchmark(root);
} else {
  startOverlay(root);
}

function startBenchmark(parent: HTMLElement): void {
  const bench = new BenchmarkView(parent, location.search);
  if (!isPerceptionSupported()) {
    bench.setError(UNSUPPORTED);
    return;
  }
  new Camera(
    {
      onStatus: () => undefined,
      onError: (message) => {
        bench.setError(`camera: ${message}`);
      },
      onTrack: (track, settings) => {
        bench.setTrack(track, settings);
      },
    },
    cameraHint,
  ).start();
}

function startOverlay(parent: HTMLElement): void {
  const overlay = new DebugOverlay(parent);
  startLoop((dt, now) => {
    overlay.update(dt, now);
  });
  if (!isPerceptionSupported()) {
    overlay.setError(UNSUPPORTED);
    return;
  }

  const perception = new PerceptionClient(perceptionOptionsFromUrl(location.search), {
    onReady: (options) => {
      overlay.setPerception(options);
    },
    onDetections: (detections) => {
      overlay.addDetections(detections);
    },
    onError: (message) => {
      overlay.setError(message);
    },
  });

  new Camera(
    {
      onStatus: (status) => {
        overlay.setCameraStatus(status);
        if (status === 'live') overlay.setError(null);
      },
      onError: (message) => {
        overlay.setError(`camera: ${message}`);
      },
      onTrack: (track, settings) => {
        // The worker consumes the original track; the preview gets its own clone.
        perception.attachTrack(track);
        overlay.setCameraTrack(track.clone(), settings);
      },
    },
    cameraHint,
  ).start();
}
