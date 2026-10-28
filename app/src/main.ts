import './style.css';
import { perceptionOptionsFromUrl } from './config/perception';
import { Camera } from './perception/camera';
import { PerceptionClient } from './perception/client';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const preview = document.createElement('video');
preview.className = 'camera-preview';
preview.muted = true;
preview.playsInline = true;

const status = document.createElement('p');
status.className = 'camera-status';
const detectionStatus = document.createElement('p');
detectionStatus.className = 'camera-status detection-status';
root.append(preview, status, detectionStatus);

let model = 'loading model…';
const perception = new PerceptionClient(perceptionOptionsFromUrl(location.search), {
  onReady: (options) => {
    model = `${options.model}/${options.delegate}`;
    detectionStatus.textContent = `perception: ${model} ready`;
  },
  onDetections: (d) => {
    detectionStatus.textContent = `perception: ${model} · poses ${String(d.poseCount)} · inference ${d.inferenceMs.toFixed(1)} ms · frame #${String(d.frameId)}`;
  },
  onError: (message) => {
    detectionStatus.dataset['status'] = 'lost';
    detectionStatus.textContent = `perception error: ${message}`;
  },
});

const camera = new Camera(
  {
    onStatus: (s) => {
      status.dataset['status'] = s;
      if (s !== 'live') status.textContent = `camera: ${s}`;
    },
    onTrack: (track, settings) => {
      // The worker consumes the original track; the preview gets its own clone.
      perception.attachTrack(track);
      preview.srcObject = new MediaStream([track.clone()]);
      void preview.play();
      status.textContent = `camera: ${settings.label} · ${String(settings.width)}×${String(settings.height)} @ ${settings.frameRate.toFixed(0)}fps`;
    },
  },
  new URLSearchParams(location.search).get('camera'),
);
camera.start();
