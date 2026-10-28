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

/**
 * Shoulder width ≈ this × torso length (shoulder midpoint to hip midpoint) for an upright adult
 * facing the camera — measured 0.64 on the first recorded session.
 */
export const TORSO_TO_SHOULDER_WIDTH = 0.65;

/**
 * Body size in source pixels, in shoulder-width units but robust to turning sideways: shoulders
 * overlap when a person turns, the torso does not. Larger of shoulder width and scaled torso length.
 */
export function bodyScalePx(data: Float32Array, width: number, height: number, pose = 0): number {
  const base = pose * LANDMARK_COUNT * LANDMARK_STRIDE;
  const at = (i: number, axis: number) => data[base + i * LANDMARK_STRIDE + axis] ?? 0;
  const midX = (a: number, b: number) => (at(a, 0) + at(b, 0)) / 2;
  const midY = (a: number, b: number) => (at(a, 1) + at(b, 1)) / 2;
  const torso = Math.hypot(
    (midX(Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER) -
      midX(Landmark.LEFT_HIP, Landmark.RIGHT_HIP)) *
      width,
    (midY(Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER) -
      midY(Landmark.LEFT_HIP, Landmark.RIGHT_HIP)) *
      height,
  );
  return Math.max(shoulderWidthPx(data, width, height, pose), TORSO_TO_SHOULDER_WIDTH * torso);
}
