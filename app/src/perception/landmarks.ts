import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

/**
 * BlazePose landmark indices used by the app. "Left"/"right" are the person's own sides,
 * as MediaPipe reports them (before the screen mirror).
 */
export const Landmark = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

/** Distance between the shoulders in source pixels, for pose `pose` of `data`. */
export function shoulderWidthPx(
  data: Float32Array,
  width: number,
  height: number,
  pose = 0,
): number {
  const base = pose * LANDMARK_COUNT * LANDMARK_STRIDE;
  const l = base + Landmark.LEFT_SHOULDER * LANDMARK_STRIDE;
  const r = base + Landmark.RIGHT_SHOULDER * LANDMARK_STRIDE;
  return Math.hypot(
    ((data[l] ?? 0) - (data[r] ?? 0)) * width,
    ((data[l + 1] ?? 0) - (data[r + 1] ?? 0)) * height,
  );
}
