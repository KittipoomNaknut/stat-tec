"""Webcam capture that survives unplugging. MJPEG is required: YUYV at 720p only gives 10 fps."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)
RECONNECT_S = 2.0


class Camera:
    def __init__(self, index: int, width: int, height: int, fps: int) -> None:
        self.index = index
        self.width = width
        self.height = height
        self.fps = fps
        self._cap: cv2.VideoCapture | None = None
        self._next_attempt = 0.0

    @property
    def label(self) -> str:
        name = Path(f"/sys/class/video4linux/video{self.index}/name")
        return name.read_text().strip() if name.exists() else f"camera {self.index}"

    def read(self) -> tuple[np.ndarray, float] | None:
        """Next frame and its capture time (epoch ms), or None while the camera is unavailable."""
        if self._cap is None and not self._open():
            return None
        assert self._cap is not None
        ok, frame = self._cap.read()
        if not ok:
            log.warning("camera %s stopped delivering frames; reconnecting", self.index)
            self.close()
            return None
        return frame, time.time() * 1000

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
        self._cap = None

    def _open(self) -> bool:
        now = time.monotonic()
        if now < self._next_attempt:
            time.sleep(min(self._next_attempt - now, 0.1))
            return False
        cap = cv2.VideoCapture(self.index, cv2.CAP_V4L2)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        if not cap.isOpened():
            cap.release()
            self._next_attempt = now + RECONNECT_S
            log.warning("cannot open camera %s; retrying in %.0f s", self.index, RECONNECT_S)
            return False
        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        log.info("camera %s (%s) opened at %dx%d", self.index, self.label, self.width, self.height)
        self._cap = cap
        return True
