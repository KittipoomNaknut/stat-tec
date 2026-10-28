import type { PerceptionSource } from '../../src/perception/protocol';

export interface SessionInfo {
  file: string;
  /** Pose source that produced it — gestures use thresholds calibrated per source. */
  source: PerceptionSource;
}

/**
 * Recorded sessions in tests/fixtures/poses with the owner alone in front of the camera.
 * Every replay test runs against all of them, so a new recording is one line here.
 */
export const SOLO_SESSIONS: readonly SessionInfo[] = [
  { file: '2026-10-28-adult1-2m-indoor.pose.json.gz', source: 'mediapipe' },
  { file: '2026-10-28-adult1-2m-rtmpose.pose.json.gz', source: 'server' },
];
