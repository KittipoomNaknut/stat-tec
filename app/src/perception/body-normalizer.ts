import { bodyScalePx, Landmark } from './landmarks';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from './protocol';

/** Below this the body is too small to define a scale. */
const MIN_SCALE_PX = 4;

/**
 * Converts one pose from image coordinates to **body space**, so gesture thresholds work the
 * same for a small child or an adult, near or far:
 *
 * - origin: midpoint of the shoulders
 * - 1 unit: shoulder width ("SW"), estimated from the torso when the person turns sideways
 * - +x: towards the screen's right (the image is mirrored, so the player's right hand is +x)
 * - +y: down; z uses the same scale as x
 * - visibility is copied unchanged
 *
 * Writes into `out` (length `LANDMARK_COUNT × LANDMARK_STRIDE`) without allocating.
 * Returns `false` and leaves `out` untouched when the body is too small to measure.
 */
export function toBodySpace(
  image: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
  pose = 0,
): boolean {
  const sw = bodyScalePx(image, width, height, pose);
  if (sw < MIN_SCALE_PX) return false;

  const base = pose * LANDMARK_COUNT * LANDMARK_STRIDE;
  const l = base + Landmark.LEFT_SHOULDER * LANDMARK_STRIDE;
  const r = base + Landmark.RIGHT_SHOULDER * LANDMARK_STRIDE;
  const ox = ((image[l] ?? 0) + (image[r] ?? 0)) / 2;
  const oy = ((image[l + 1] ?? 0) + (image[r + 1] ?? 0)) / 2;
  const sx = width / sw;
  const sy = height / sw;

  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const s = base + i * LANDMARK_STRIDE;
    const d = i * LANDMARK_STRIDE;
    out[d] = -((image[s] ?? 0) - ox) * sx;
    out[d + 1] = ((image[s + 1] ?? 0) - oy) * sy;
    out[d + 2] = (image[s + 2] ?? 0) * sx;
    out[d + 3] = image[s + 3] ?? 0;
  }
  return true;
}
