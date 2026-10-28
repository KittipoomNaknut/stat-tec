"""
YOLOX-m person detector (CUDA, every `det_every` frames) + RTMPose-x pose (TensorRT FP16).

Between detections, each person's box comes from their previous keypoints. Measured on an
RTX 4060 Laptop: 7.5 ms avg, 25 ms p95 (detector frames) — see spikes/pose-models.
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


def largest_first(boxes: np.ndarray, limit: int) -> np.ndarray:
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return boxes[np.argsort(-areas)][:limit]


class RtmPoseEstimator:
    name = "rtmpose-x/trt-fp16 + yolox-m/cuda"

    def __init__(self, trt_cache: Path, det_every: int = 7, max_people: int = 3) -> None:
        from .gpu import enable_gpu

        enable_gpu(trt_cache)
        from rtmlib import YOLOX, Body, RTMPose

        det = Body.MODE["balanced"]
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
        self._det_every = det_every
        self._max_people = max_people
        self._frame = 0
        self._boxes = np.zeros((0, 4), np.float32)

    def __call__(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        h, w = frame.shape[:2]
        if self._frame % self._det_every == 0 or len(self._boxes) == 0:
            self._boxes = np.asarray(self._det(frame), np.float32).reshape(-1, 4)
        self._frame += 1
        boxes = largest_first(self._boxes, self._max_people)
        if len(boxes) == 0:
            return np.zeros((0, 17, 2)), np.zeros((0, 17))
        keypoints, scores = self._pose(frame, bboxes=boxes.tolist())
        self._boxes = boxes_from_keypoints(keypoints, scores, w, h)
        return keypoints, scores
