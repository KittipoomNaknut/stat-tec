/** Messages between the main thread and the perception worker. */

export type PoseModel = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export interface PerceptionOptions {
  model: PoseModel;
  delegate: Delegate;
  /** More than one so the app knows when other people are in frame (see PlayerLock). */
  numPoses: number;
}

export const LANDMARK_COUNT = 33;
/** Floats per landmark in `PoseDetections.landmarks`: x, y, z, visibility. */
export const LANDMARK_STRIDE = 4;

export interface PoseDetections {
  frameId: number;
  /** Epoch ms (`performance.timeOrigin + performance.now()`) when the worker received the frame. */
  receivedAt: number;
  inferenceMs: number;
  width: number;
  height: number;
  poseCount: number;
  /** `poseCount × LANDMARK_COUNT × LANDMARK_STRIDE`, normalized image coordinates, not mirrored. */
  landmarks: Float32Array;
}

export type ToWorker =
  | { type: 'init'; options: PerceptionOptions }
  | { type: 'frames'; stream: ReadableStream<VideoFrame> };

export type FromWorker =
  | { type: 'ready'; options: PerceptionOptions }
  | { type: 'detections'; detections: PoseDetections }
  | { type: 'error'; message: string };
