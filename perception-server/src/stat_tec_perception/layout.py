"""Maps COCO-17 keypoints (RTMPose) onto the app's 33-landmark BlazePose layout."""

from __future__ import annotations

import numpy as np

LANDMARK_COUNT = 33
LANDMARK_STRIDE = 4  # x, y, z, visibility

# COCO-17 index -> BlazePose-33 index. Both use the person's own left/right.
COCO_TO_APP = {
    0: 0,  # nose
    1: 2,  # left eye
    2: 5,  # right eye
    3: 7,  # left ear
    4: 8,  # right ear
    5: 11,  # left shoulder
    6: 12,  # right shoulder
    7: 13,  # left elbow
    8: 14,  # right elbow
    9: 15,  # left wrist
    10: 16,  # right wrist
    11: 23,  # left hip
    12: 24,  # right hip
    13: 25,  # left knee
    14: 26,  # right knee
    15: 27,  # left ankle
    16: 28,  # right ankle
}
_COCO = np.array(list(COCO_TO_APP.keys()))
_APP = np.array(list(COCO_TO_APP.values()))


def to_app_layout(keypoints: np.ndarray, scores: np.ndarray, width: int, height: int) -> np.ndarray:
    """
    `keypoints` (people, 17, 2) in pixels and `scores` (people, 17) → float32
    `people x 33 x [x, y, z, visibility]` with x, y normalized to [0, 1].

    Landmarks COCO-17 lacks (fingers, heels, inner/outer eyes, mouth) get visibility 0.
    Visibility = clamp(score, 0, 1): RTMPose scores span the same range as MediaPipe
    visibility for visible joints (0.5-1.05 measured), so the app's thresholds still apply.
    z is not estimated (0).
    """
    people = len(keypoints)
    out = np.zeros((people, LANDMARK_COUNT, LANDMARK_STRIDE), dtype=np.float32)
    if people == 0:
        return out.reshape(-1)
    out[:, _APP, 0] = keypoints[:, _COCO, 0] / width
    out[:, _APP, 1] = keypoints[:, _COCO, 1] / height
    out[:, _APP, 3] = np.clip(scores[:, _COCO], 0.0, 1.0)
    return out.reshape(-1)
