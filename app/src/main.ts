import './style.css';
import { perceptionOptionsFromUrl } from './config/perception';
import { startLoop } from './core/loop';
import { DebugOverlay } from './debug/overlay';
import { Camera } from './perception/camera';
import { PerceptionClient } from './perception/client';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const overlay = new DebugOverlay(root);

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

const camera = new Camera(
  {
    onStatus: (status) => {
      overlay.setCameraStatus(status);
    },
    onTrack: (track, settings) => {
      // The worker consumes the original track; the preview gets its own clone.
      perception.attachTrack(track);
      overlay.setCameraTrack(track.clone(), settings);
    },
  },
  new URLSearchParams(location.search).get('camera'),
);
camera.start();

startLoop((dt, now) => {
  overlay.update(dt, now);
});
