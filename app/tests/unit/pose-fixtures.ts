import { Landmark } from '../../src/perception/landmarks';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../../src/perception/protocol';

export interface SyntheticPose {
  /** Torso center, normalized image coordinates. */
  cx: number;
  cy: number;
  /** Shoulder width as a fraction of the frame width. */
  sw: number;
  visibility?: number;
  /** 1 = facing the camera; near 0 = turned sideways (shoulders overlap, torso unchanged). */
  shoulderSpread?: number;
}

/**
 * A crude upright person in normalized image coordinates for a `width × height` frame:
 * shoulders `sw` apart, hips one shoulder width lower, everything else at the torso center.
 */
export function syntheticPoses(poses: readonly SyntheticPose[], width = 1280, height = 720) {
  const data = new Float32Array(poses.length * LANDMARK_COUNT * LANDMARK_STRIDE);
  poses.forEach(({ cx, cy, sw, visibility = 0.95, shoulderSpread = 1 }, p) => {
    const halfX = (sw / 2) * shoulderSpread;
    const halfY = ((sw * width) / height) * 0.5;
    const set = (i: number, x: number, y: number) => {
      const k = (p * LANDMARK_COUNT + i) * LANDMARK_STRIDE;
      data[k] = x;
      data[k + 1] = y;
      data[k + 2] = 0;
      data[k + 3] = visibility;
    };
    for (let i = 0; i < LANDMARK_COUNT; i++) set(i, cx, cy);
    // Image left = person's right (camera faces the person).
    set(Landmark.RIGHT_SHOULDER, cx - halfX, cy - halfY);
    set(Landmark.LEFT_SHOULDER, cx + halfX, cy - halfY);
    set(Landmark.RIGHT_HIP, cx - halfX * 0.8, cy + halfY);
    set(Landmark.LEFT_HIP, cx + halfX * 0.8, cy + halfY);
    set(Landmark.NOSE, cx, cy - halfY * 2);
  });
  return { data, width, height, poseCount: poses.length };
}
