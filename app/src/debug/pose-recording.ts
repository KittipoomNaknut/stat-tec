/**
 * File format for recorded pose sessions (`*.pose.json.gz`), used as replay fixtures in tests.
 * Only landmarks are stored — never camera images.
 */
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../perception/protocol';

export const POSE_SESSION_VERSION = 1;

export interface PoseClipFrame {
  /** Milliseconds since the clip started. */
  t: number;
  /** Number of poses in this frame. */
  n: number;
  /** Raw detections: `n × 33 × [x, y, z, visibility]`, rounded to 4 decimals. */
  lm: number[];
}

export interface PoseClip {
  id: string;
  instruction: string;
  frames: PoseClipFrame[];
}

export interface PoseSession {
  version: typeof POSE_SESSION_VERSION;
  recordedAt: string;
  camera: { label: string; width: number; height: number; frameRate: number };
  model: string;
  clips: PoseClip[];
}

export function toClipFrame(t: number, poseCount: number, landmarks: Float32Array): PoseClipFrame {
  const lm = Array.from(
    landmarks.subarray(0, poseCount * LANDMARK_COUNT * LANDMARK_STRIDE),
    (v) => Math.round(v * 1e4) / 1e4,
  );
  return { t: Math.round(t * 10) / 10, n: poseCount, lm };
}

export async function encodeSession(session: PoseSession): Promise<Blob> {
  const stream = new Blob([JSON.stringify(session)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function decodeSession(gzipped: Blob): Promise<PoseSession> {
  const stream = gzipped.stream().pipeThrough(new DecompressionStream('gzip'));
  // Untrusted file: check the version before treating it as a PoseSession.
  const data = (await new Response(stream).json()) as { version?: unknown };
  if (data.version !== POSE_SESSION_VERSION) {
    throw new Error(`Unsupported pose session version ${String(data.version)}`);
  }
  return data as PoseSession;
}
