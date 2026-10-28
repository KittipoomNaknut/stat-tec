/**
 * Messages from the perception service (perception-server/src/stat_tec_perception/protocol.py).
 * Both sides are tested against tests/fixtures/server/std1-two-people.bin.
 */
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

export const DETECTIONS_MAGIC = 'STD1';
export const PREVIEW_MAGIC = 'STJ1';
export const HEADER_SIZE = 28;

export interface ServerDetections {
  frameId: number;
  /** Epoch ms when the service read the frame (same clock as performance.timeOrigin + now). */
  capturedAt: number;
  inferenceMs: number;
  width: number;
  height: number;
  people: number;
  /** `people × 33 × [x, y, z, visibility]`, normalized image coordinates, own buffer. */
  landmarks: Float32Array;
}

export interface ServerCamera {
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export type ServerText =
  | { type: 'hello'; model: string; camera: ServerCamera }
  | { type: 'status'; fps: number; inferenceMs: number };

/** The 4-byte tag at the start of a binary message. */
export function binaryKind(message: ArrayBuffer): string {
  return message.byteLength >= 4 ? String.fromCharCode(...new Uint8Array(message, 0, 4)) : '';
}

export function decodeDetections(message: ArrayBuffer): ServerDetections {
  if (binaryKind(message) !== DETECTIONS_MAGIC) throw new Error('not a detections message');
  const view = new DataView(message);
  const people = view.getUint8(24);
  const floats = people * LANDMARK_COUNT * LANDMARK_STRIDE;
  if (message.byteLength !== HEADER_SIZE + floats * 4) {
    throw new Error(
      `detections length ${String(message.byteLength)} ≠ ${String(HEADER_SIZE + floats * 4)}`,
    );
  }
  // Read little-endian explicitly instead of viewing the buffer with the platform's byte order.
  const landmarks = new Float32Array(floats);
  for (let i = 0; i < floats; i++) landmarks[i] = view.getFloat32(HEADER_SIZE + i * 4, true);
  return {
    frameId: view.getUint32(4, true),
    capturedAt: view.getFloat64(8, true),
    inferenceMs: view.getFloat32(16, true),
    width: view.getUint16(20, true),
    height: view.getUint16(22, true),
    people,
    landmarks,
  };
}

/** JPEG bytes of a preview message. */
export function previewJpeg(message: ArrayBuffer): ArrayBuffer {
  return message.slice(4);
}

export function parseText(message: string): ServerText | null {
  try {
    const data = JSON.parse(message) as { type?: unknown };
    return data.type === 'hello' || data.type === 'status' ? (data as ServerText) : null;
  } catch {
    return null;
  }
}
