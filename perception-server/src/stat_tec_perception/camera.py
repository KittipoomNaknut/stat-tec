"""Webcam capture that survives unplugging. MJPEG is required: YUYV at 720p only gives 10 fps."""

from __future__ import annotations

import fcntl
import logging
import os
import struct
import time
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)
RECONNECT_S = 2.0

# V4L2 ioctl and control ids (linux/videodev2.h, v4l2-controls.h)
_VIDIOC_G_CTRL = 0xC008561B
_VIDIOC_S_CTRL = 0xC008561C
_EXPOSURE_AUTO_PRIORITY = 0x009A0903


def hold_frame_rate(index: int) -> bool | None:
    """
    Stops the webcam from lowering its frame rate in dim light (research 027): with
    `exposure_auto_priority` on, the built-in webcam ran at 10-16 fps in an evening room, and
    the cursor lagged. Off, auto exposure must fit the frame time (the picture gets a little
    darker; the pose model copes). Returns True if it was on and is now off, False if it was
    already off, None if the camera has no such control (or this is not Linux).
    """
    try:
        fd = os.open(f"/dev/video{index}", os.O_RDWR | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        control = bytearray(struct.pack("Ii", _EXPOSURE_AUTO_PRIORITY, 0))
        fcntl.ioctl(fd, _VIDIOC_G_CTRL, control)
        if struct.unpack("Ii", control)[1] == 0:
            return False
        fcntl.ioctl(fd, _VIDIOC_S_CTRL, bytearray(struct.pack("Ii", _EXPOSURE_AUTO_PRIORITY, 0)))
        return True
    except OSError:
        return None
    finally:
        os.close(fd)


class Camera:
    def __init__(
        self,
        index: int,
        width: int,
        height: int,
        fps: int,
        hold_fps: bool = True,
        fourcc: str = "MJPG",
    ) -> None:
        self.index = index
        # MJPG for USB webcams; the Kinect 360 has no MJPG and needs GRBG (its 30 fps color)
        self.fourcc = fourcc
        self.hold_fps = hold_fps
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
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.fourcc))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        # One buffer: always the newest frame. With the default (4), a loop that once fell behind
        # the camera never catches up and every frame arrives ~100 ms old (research 038).
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            cap.release()
            self._next_attempt = now + RECONNECT_S
            log.warning("cannot open camera %s; retrying in %.0f s", self.index, RECONNECT_S)
            return False
        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        log.info("camera %s (%s) opened at %dx%d", self.index, self.label, self.width, self.height)
        if self.hold_fps:
            held = hold_frame_rate(self.index)
            if held:
                log.info(
                    "camera %s: frame rate held in dim light (exposure priority off)", self.index
                )
        self._cap = cap
        return True
