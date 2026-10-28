import type { PoseDetections } from '../perception/protocol';
import {
  POSE_SESSION_VERSION,
  toClipFrame,
  type PoseClip,
  type PoseSession,
} from './pose-recording';

/** Records raw detections as one free-form clip, e.g. a whole playground session. */
export class SessionRecorder {
  readonly #clip: PoseClip;
  #start: number | null = null;
  camera: PoseSession['camera'] | null = null;
  model = '';

  constructor(id: string, instruction: string) {
    this.#clip = { id, instruction, frames: [] };
  }

  get frames(): number {
    return this.#clip.frames.length;
  }

  add(d: PoseDetections): void {
    this.#start ??= d.receivedAt;
    this.#clip.frames.push(toClipFrame(d.receivedAt - this.#start, d.poseCount, d.landmarks));
  }

  session(): PoseSession {
    if (!this.camera) throw new Error('camera unknown');
    return {
      version: POSE_SESSION_VERSION,
      recordedAt: new Date().toISOString(),
      camera: this.camera,
      model: this.model,
      clips: [this.#clip],
    };
  }
}
