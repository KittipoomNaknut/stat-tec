"""
Binary WebSocket messages, little-endian (mirrored in app/src/perception/server-protocol.ts).

Detections (28-byte header, then float32 landmarks — header length keeps them 4-byte aligned):
    magic   4s  b"STD1"
    frame   u32
    t       f64  capture time, epoch ms (same clock as the browser's performance.timeOrigin + now)
    ms      f32  inference time
    width   u16
    height  u16
    people  u8
    pad     3x
    float32 people x 33 x [x, y, z, visibility]

Preview (debug only, only to clients that asked): b"STJ1" + JPEG bytes.
Text frames are JSON. Server: {"type": "hello" | "status", ...}.
Client: {"type": "preview", "enabled": bool}.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

DETECTIONS_MAGIC = b"STD1"
PREVIEW_MAGIC = b"STJ1"
_HEADER = struct.Struct("<4sIdfHHB3x")
HEADER_SIZE = _HEADER.size


@dataclass(frozen=True)
class Detections:
    frame_id: int
    captured_at_ms: float
    inference_ms: float
    width: int
    height: int
    people: int
    landmarks: np.ndarray  # float32, people x 33 x 4 flattened


def encode_detections(d: Detections) -> bytes:
    landmarks = np.ascontiguousarray(d.landmarks, dtype="<f4")
    if landmarks.size != d.people * 33 * 4:
        raise ValueError(f"expected {d.people * 33 * 4} floats, got {landmarks.size}")
    header = _HEADER.pack(
        DETECTIONS_MAGIC,
        d.frame_id,
        d.captured_at_ms,
        d.inference_ms,
        d.width,
        d.height,
        d.people,
    )
    return header + landmarks.tobytes()


def decode_detections(message: bytes) -> Detections:
    magic, frame_id, t, ms, width, height, people = _HEADER.unpack_from(message)
    if magic != DETECTIONS_MAGIC:
        raise ValueError(f"not a detections message: {magic!r}")
    landmarks = np.frombuffer(message, dtype="<f4", offset=HEADER_SIZE)
    return Detections(frame_id, t, ms, width, height, people, landmarks)


def encode_preview(jpeg: bytes) -> bytes:
    return PREVIEW_MAGIC + jpeg
