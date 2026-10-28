import { cameraConfig } from '../config/camera';

export type CameraStatus = 'connecting' | 'live' | 'lost';

export interface CameraSettings {
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export interface CameraEvents {
  onStatus: (status: CameraStatus) => void;
  /** Called with every new track, including after a reconnect. */
  onTrack: (track: MediaStreamTrack, settings: CameraSettings) => void;
  /** Why the last connect attempt failed, e.g. permission denied or camera busy. */
  onError: (message: string) => void;
}

/**
 * Owns the webcam track and keeps it alive: when the camera is unplugged or stalls,
 * it releases the track and retries until a camera is available again.
 */
export class Camera {
  readonly #events: CameraEvents;
  readonly #labelHint: string | null;
  #track: MediaStreamTrack | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = true;

  /** @param labelHint case-insensitive substring of the camera label to prefer, e.g. "brio" */
  constructor(events: CameraEvents, labelHint: string | null = null) {
    this.#events = events;
    this.#labelHint = labelHint;
  }

  start(): void {
    this.#stopped = false;
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    this.#releaseTrack();
  }

  /** Drop the current track and reconnect, e.g. when frames stop arriving. */
  restart(): void {
    if (this.#stopped) return;
    this.#releaseTrack();
    this.#events.onStatus('lost');
    this.#scheduleRetry();
  }

  async #connect(): Promise<void> {
    this.#events.onStatus('connecting');
    let track: MediaStreamTrack;
    try {
      track = await this.#openTrack();
    } catch (error) {
      console.warn('[camera] connect failed', error);
      this.#events.onError(
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
      this.#events.onStatus('lost');
      this.#scheduleRetry();
      return;
    }
    if (this.#stopped) {
      track.stop();
      return;
    }
    track.addEventListener('ended', () => {
      this.restart();
    });
    this.#track = track;
    // Outside the try: a failing consumer is a bug to surface, not a reason to reconnect.
    this.#events.onTrack(track, describe(track));
    this.#events.onStatus('live');
  }

  async #openTrack(): Promise<MediaStreamTrack> {
    const deviceId = await this.#findDeviceId();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId === undefined ? {} : { deviceId: { exact: deviceId } }),
        width: { ideal: cameraConfig.idealWidth },
        height: { ideal: cameraConfig.idealHeight },
        frameRate: { ideal: cameraConfig.idealFrameRate },
      },
    });
    const [track] = stream.getVideoTracks();
    if (!track) throw new Error('Camera stream has no video track');
    return track;
  }

  async #findDeviceId(): Promise<string | undefined> {
    if (this.#labelHint === null) return undefined;
    const hint = this.#labelHint.toLowerCase();
    // Labels are empty until camera permission is granted; then the default camera is used.
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.find((d) => d.kind === 'videoinput' && d.label.toLowerCase().includes(hint))
      ?.deviceId;
  }

  #scheduleRetry(): void {
    clearTimeout(this.#retryTimer);
    if (this.#stopped) return;
    this.#retryTimer = setTimeout(() => {
      void this.#connect();
    }, cameraConfig.reconnectIntervalMs);
  }

  #releaseTrack(): void {
    this.#track?.stop();
    this.#track = null;
  }
}

function describe(track: MediaStreamTrack): CameraSettings {
  const settings = track.getSettings();
  return {
    label: track.label,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? 0,
  };
}
