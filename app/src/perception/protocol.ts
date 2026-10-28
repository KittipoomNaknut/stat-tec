/** Messages between the main thread and the perception worker. */
import type { OneEuroParams } from './one-euro';
import type { LockState } from './player-lock';

export type PoseModel = 'lite' | 'full' | 'heavy';
export type Delegate = 'GPU' | 'CPU';

export interface PerceptionOptions {
  model: PoseModel;
  delegate: Delegate;
  /** More than one so the app knows when other people are in frame (see PlayerLock). */
  numPoses: number;
  /** Temporal smoothing of the player's landmarks; `null` disables it. */
  filter: OneEuroParams | null;
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
  lock: LockState;
  /** Increments each time a new person becomes the player. */
  playerId: number;
  /** The player's pose in `landmarks`, or −1 when no player is visible this frame. */
  playerIndex: number;
  /** Other distinct people in frame (duplicate detections merged away). */
  otherIndices: number[];
  /**
   * The player's landmarks after filtering (same layout as one pose of `landmarks`), or `null`
   * when no player is visible this frame.
   */
  player: Float32Array | null;
  /** `player` in body space (see body-normalizer.ts), or `null` when it cannot be measured. */
  body: Float32Array | null;
  /** Per landmark of `player`: 1 = show it (hysteresis, no flicker). See stabilizer.ts. */
  playerShown: Uint8Array | null;
}

export type ToWorker =
  | { type: 'init'; options: PerceptionOptions }
  | { type: 'frames'; stream: ReadableStream<VideoFrame> };

export type FromWorker =
  | { type: 'ready'; options: PerceptionOptions }
  | { type: 'detections'; detections: PoseDetections }
  | { type: 'error'; message: string };
