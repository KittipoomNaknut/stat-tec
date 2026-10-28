import './style.css';
import { Camera } from './perception/camera';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root element not found');

const preview = document.createElement('video');
preview.className = 'camera-preview';
preview.muted = true;
preview.playsInline = true;

const status = document.createElement('p');
status.className = 'camera-status';
root.append(preview, status);

const camera = new Camera(
  {
    onStatus: (s) => {
      status.dataset['status'] = s;
      if (s !== 'live') status.textContent = `camera: ${s}`;
    },
    onTrack: (track, settings) => {
      preview.srcObject = new MediaStream([track]);
      void preview.play();
      status.textContent = `camera: ${settings.label} · ${String(settings.width)}×${String(settings.height)} @ ${settings.frameRate.toFixed(0)}fps`;
    },
  },
  new URLSearchParams(location.search).get('camera'),
);
camera.start();
