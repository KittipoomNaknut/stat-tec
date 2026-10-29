import './style.css';
import { perceptionOptionsFromUrl } from './config/perception';
import { startLoop } from './core/loop';
import { BenchmarkView } from './debug/benchmark';
import { DebugOverlay } from './debug/overlay';
import { Playground } from './debug/playground';
import { RecorderPanel } from './debug/recorder';
import { SessionRecorder } from './debug/session-recorder';
import { showStyleguide } from './debug/styleguide';
import { SyntheticPlayer } from './debug/synthetic-player';
import { renderConfigFromUrl } from './config/render';
import { Experience } from './experience/experience';
import { story } from './narrative/story';
import { GestureEngine } from './gestures/engine';
import { IntentBus } from './input/intent-bus';
import { MouseAdapter } from './input/mouse-adapter';
import { TargetRegistry } from './input/targets';
import { Camera, type CameraSettings } from './perception/camera';
import { isPerceptionSupported, PerceptionClient } from './perception/client';
import type { PerceptionOptions, PoseDetections } from './perception/protocol';

const UNSUPPORTED = 'This browser cannot stream camera frames to a worker. Use Chrome/Chromium.';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const params = new URLSearchParams(location.search);
const cameraHint = params.get('camera');

if (params.has('styleguide')) {
  showStyleguide(root, location.search);
} else if (params.has('bench')) {
  startBenchmark(root);
} else if (params.has('record')) {
  const recorder = new RecorderPanel(root, location.search);
  startOverlay(root, {
    onReady: (_options, model) => {
      recorder.setModel(model);
    },
    onDetections: (detections) => {
      recorder.addDetections(detections);
    },
    onCamera: (settings) => {
      recorder.setCamera(settings);
    },
  });
} else if (params.has('playground')) {
  startPlayground(root);
} else if (params.has('debug')) {
  startOverlay(root);
} else {
  startExperience(root);
}

/** The visitor experience (default). F1 debug overlay, F2 mouse, F5 back to attract. */
function startExperience(parent: HTMLElement): void {
  const speed = Number(params.get('speed') ?? '1');
  const experience = new Experience(parent, {
    story,
    speed: speed > 0 ? speed : 1,
    ...(params.has('chapter') ? { startChapter: params.get('chapter') ?? '' } : {}),
    maxInternalHeight: renderConfigFromUrl(location.search).maxInternalHeight,
  });
  startLoop((dt, now) => {
    experience.frame(dt, now);
  });
  if (params.get('player') === 'synthetic') {
    // E2E: a scripted body instead of the camera (tests/e2e).
    const player = new SyntheticPlayer((frame, now) => {
      experience.onBody(frame, now);
    });
    Object.assign(window, { statTecSynthetic: player });
    return;
  }
  startOverlay(parent, {
    onReady: (options) => {
      experience.setPoseSource(options.source);
    },
    onDetections: (detections) => {
      experience.onDetections(detections);
    },
  }).setVisible(false);
}

function startPlayground(parent: HTMLElement): void {
  const bus = new IntentBus();
  const targets = new TargetRegistry();
  const recorder = new SessionRecorder('playground', 'free play in ?playground (research 010)');
  const playground = new Playground(parent, bus, targets, recorder);
  const engine = new GestureEngine(bus, targets);
  const mouse = new MouseAdapter(window, bus, targets);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F2') return;
    e.preventDefault();
    mouse.enabled = !mouse.enabled;
    engine.enabled = !mouse.enabled;
    playground.setMode(mouse.enabled ? 'mouse' : 'body');
  });
  startOverlay(parent, {
    onReady: (options, model) => {
      engine.setPoseSource(options.source);
      recorder.model = model;
    },
    onCamera: (camera) => {
      recorder.camera = camera;
    },
    onDetections: (detections) => {
      engine.update(detections, performance.now());
      recorder.add(detections);
    },
  }).setVisible(false);
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

/** Optional listeners for tools layered on top of the overlay, e.g. the recorder. */
interface OverlayListeners {
  onReady?: (options: PerceptionOptions, model: string) => void;
  onDetections?: (detections: PoseDetections) => void;
  onCamera?: (settings: CameraSettings) => void;
}

function startOverlay(parent: HTMLElement, listeners: OverlayListeners = {}): DebugOverlay {
  let perception: PerceptionClient | null = null;
  // Previews from the perception service are only requested while the overlay is on screen.
  const overlay = new DebugOverlay(parent, (visible) => {
    perception?.setPreview(visible);
  });
  startLoop((dt, now) => {
    overlay.update(dt, now);
  });

  const client = new PerceptionClient(perceptionOptionsFromUrl(location.search), {
    onReady: (options, model) => {
      overlay.setPerception(options, model);
      listeners.onReady?.(options, model);
      // The service owns the camera; the browser opens it only for the MediaPipe fallback.
      if (options.source === 'server') client.setPreview(overlay.visible);
      else startBrowserCamera(client, overlay, listeners);
    },
    onCamera: (camera) => {
      overlay.setCameraInfo(camera);
      listeners.onCamera?.(camera);
    },
    onPreview: (jpeg) => {
      overlay.setPreviewFrame(jpeg);
    },
    onServer: (status) => {
      overlay.setServer(status);
    },
    onDetections: (detections) => {
      overlay.addDetections(detections);
      listeners.onDetections?.(detections);
    },
    onError: (message) => {
      overlay.setError(message);
    },
  });
  perception = client;
  return overlay;
}

function startBrowserCamera(
  perception: PerceptionClient,
  overlay: DebugOverlay,
  listeners: OverlayListeners,
): void {
  if (!isPerceptionSupported()) {
    overlay.setError(UNSUPPORTED);
    return;
  }
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
        listeners.onCamera?.(settings);
      },
    },
    cameraHint,
  ).start();
}
