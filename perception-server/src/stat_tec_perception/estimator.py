"""
Person detector (YOLOX, CUDA) + RTMPose-x pose (TensorRT FP16).

Research 027: YOLOX-tiny on every frame (5.4 ms) + RTMPose-x (3.6 ms) ≈ 9 ms a frame, steady.
Before, YOLOX-m ran every 7th frame (19 ms) and the frames between cropped around the previous
keypoints: a fast arm left that box, the wrist came out wrong, and the cursor lagged or went
grey. On a test photo tiny and m found the same people with keypoints within 3 px.

Frames between detections (`det_every` > 1), or a frame where the detector finds nobody, use
boxes from the previous keypoints.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import numpy as np

KEYPOINT_THRESHOLD = 0.3
BOX_EXPANSION = 1.25


class Estimator(Protocol):
    name: str

    def __call__(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """(people, 17, 2) pixel keypoints and (people, 17) scores, largest person first."""
        ...


def boxes_from_keypoints(
    keypoints: np.ndarray, scores: np.ndarray, width: int, height: int
) -> np.ndarray:
    """xyxy boxes around each person's confident keypoints, expanded by 25%."""
    boxes = []
    for kp, sc in zip(keypoints, scores, strict=True):
        pts = kp[sc > KEYPOINT_THRESHOLD]
        if len(pts) < 2:
            continue
        (x0, y0), (x1, y1) = pts.min(axis=0), pts.max(axis=0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        hw, hh = (x1 - x0) / 2 * BOX_EXPANSION, (y1 - y0) / 2 * BOX_EXPANSION
        boxes.append(
            [max(cx - hw, 0), max(cy - hh, 0), min(cx + hw, width - 1), min(cy + hh, height - 1)]
        )
    return np.array(boxes, dtype=np.float32).reshape(-1, 4)


Zone = tuple[float, float]


def in_zone(boxes: np.ndarray, width: int, zone: Zone | None) -> np.ndarray:
    """Boxes whose center lies in the play zone: a band of the image width, as fractions.

    People beside the play spot (a queue, passers-by, a poster) are never posed, so they cost no
    time and cannot steal the lock. Most useful with a wide camera like the Kinect (research 031).
    """
    if zone is None or len(boxes) == 0:
        return boxes
    cx = (boxes[:, 0] + boxes[:, 2]) / 2 / width
    return boxes[(cx >= zone[0]) & (cx <= zone[1])]


def tall_enough(boxes: np.ndarray, height: int, min_height: float) -> np.ndarray:
    """Boxes at least `min_height` of the image tall: someone standing at the play spot.

    A player 2 m from the camera fills over half the frame; people far behind, or things the
    detector mistakes for people, are small. The Kinect saw 5-11 such boxes a frame, 0.1-0.4 of
    the frame tall (research 032).
    """
    if min_height <= 0 or len(boxes) == 0:
        return boxes
    return boxes[(boxes[:, 3] - boxes[:, 1]) >= min_height * height]


# COCO-17 indices
NOSE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 0, 5, 6, 11, 12
SEEN = 0.5
EDGE = 0.02


def looks_like_a_person(kp: np.ndarray, sc: np.ndarray, width: int) -> bool:
    """A whole, upright person facing the camera, not a sliver or a thing (research 033).

    - a head and both shoulders are seen, the head between and above the shoulders
    - with the hips in view, a torso of human proportions below the shoulders (hips are not
      required: a player close to the camera has them out of frame)
    - no shoulder on the side edge of the image (someone half in view)

    On the RTMPose recordings of real play this rejects 0-2% of frames, never for longer
    than 264 ms (the app's lock waits 300 ms); walking in and out at the edge is rejected.
    """
    if min(sc[L_SHOULDER], sc[R_SHOULDER], sc[NOSE]) < SEEN:
        return False
    ls, rs, nose = kp[L_SHOULDER], kp[R_SHOULDER], kp[NOSE]
    mid = (ls + rs) / 2
    sw = float(np.linalg.norm(ls - rs))
    if abs(nose[0] - mid[0]) > 0.75 * sw or nose[1] > mid[1]:
        return False
    if min(sc[L_HIP], sc[R_HIP]) >= SEEN:
        hips = (kp[L_HIP] + kp[R_HIP]) / 2
        torso = float(np.linalg.norm(hips - mid))
        if hips[1] - mid[1] < 0.5 * sw or not 0.25 <= sw / max(torso, 1e-6) <= 1.6:
            return False
    edge = EDGE * width
    return min(ls[0], rs[0]) > edge and max(ls[0], rs[0]) < width - edge


def largest_first(boxes: np.ndarray, limit: int) -> np.ndarray:
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return boxes[np.argsort(-areas)][:limit]


DETECTORS = {"tiny": "lightweight", "m": "balanced"}  # rtmlib Body modes


class RtmPoseEstimator:
    def __init__(
        self,
        trt_cache: Path,
        det_every: int = 1,
        max_people: int = 3,
        detector: str = "tiny",
        zone: Zone | None = None,
        min_height: float = 0.0,
        body_check: bool = True,
    ) -> None:
        from .gpu import enable_gpu

        enable_gpu(trt_cache)
        from rtmlib import YOLOX, Body, RTMPose

        det = Body.MODE[DETECTORS[detector]]
        self.name = f"rtmpose-x/trt-fp16 + yolox-{detector}/cuda every {det_every}"
        pose = Body.MODE["performance"]
        self._det = YOLOX(
            det["det"], model_input_size=det["det_input_size"], backend="onnxruntime", device="cuda"
        )
        self._pose = RTMPose(
            pose["pose"],
            model_input_size=pose["pose_input_size"],
            backend="onnxruntime",
            device="tensorrt",
        )
        providers = self._pose.session.get_providers()
        if providers[0] != "TensorrtExecutionProvider":
            raise RuntimeError(f"pose model is not on TensorRT: {providers}")
        self._zone = zone
        self._min_height = min_height
        self._body_check = body_check
        self._det_every = det_every
        self._max_people = max_people
        self._frame = 0
        self._boxes = np.zeros((0, 4), np.float32)

    def __call__(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        h, w = frame.shape[:2]
        if self._frame % self._det_every == 0 or len(self._boxes) == 0:
            found = tall_enough(
                in_zone(np.asarray(self._det(frame), np.float32).reshape(-1, 4), w, self._zone),
                h,
                self._min_height,
            )
            # A missed detection keeps the boxes from the last keypoints, so one bad frame
            # does not drop the player
            if len(found) > 0 or len(self._boxes) == 0:
                self._boxes = found
        self._frame += 1
        boxes = largest_first(self._boxes, self._max_people)
        if len(boxes) == 0:
            return np.zeros((0, 17, 2)), np.zeros((0, 17))
        keypoints, scores = self._pose(frame, bboxes=boxes.tolist())
        self._boxes = in_zone(boxes_from_keypoints(keypoints, scores, w, h), w, self._zone)
        if self._body_check:
            # Still tracked (the boxes above), just not reported as people
            keep = [looks_like_a_person(k, s, w) for k, s in zip(keypoints, scores, strict=True)]
            keypoints, scores = keypoints[keep], scores[keep]
        return keypoints, scores
