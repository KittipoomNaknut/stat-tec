"""
WebSocket server: one capture/inference thread, any number of local clients.

Each client gets only the newest detections (a slow client skips frames instead of lagging),
plus a downscaled JPEG preview while it asks for one (debug overlay). Only pages served from
localhost / 127.0.0.1 may connect, so other websites open in the browser cannot read poses.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from .camera import Camera
from .estimator import Estimator
from .layout import to_app_layout
from .protocol import Detections, encode_detections, encode_preview

log = logging.getLogger(__name__)

# Browser pages on this machine; None = non-browser clients (tools, tests) that send no Origin.
ALLOWED_ORIGINS = [re.compile(r"https?://(localhost|127\.0\.0\.1)(:\d+)?"), None]
PREVIEW_WIDTH = 640
STATUS_INTERVAL_S = 1.0


@dataclass(eq=False)
class Client:
    connection: ServerConnection
    queue: asyncio.Queue[bytes | str] = field(default_factory=lambda: asyncio.Queue(maxsize=2))
    preview: bool = False

    def offer(self, message: bytes | str) -> None:
        """Queue a message, dropping the oldest if the client is behind."""
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(message)


class PerceptionServer:
    def __init__(
        self,
        camera: Camera,
        estimator: Estimator,
        host: str = "127.0.0.1",
        port: int = 8765,
        preview_fps: float = 10,
    ) -> None:
        self.camera = camera
        self.estimator = estimator
        self.host = host
        self.port = port
        self._preview_interval = 1 / preview_fps
        self._clients: set[Client] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop = threading.Event()
        self._frame_s = 0.0  # smoothed frame interval; fps = 1 / interval
        self._inference_ms = 0.0
        self.frames = 0

    async def serve_forever(self, ready: asyncio.Event | None = None) -> None:
        self._loop = asyncio.get_running_loop()
        worker = threading.Thread(target=self._capture_loop, name="capture", daemon=True)
        worker.start()
        try:
            async with serve(
                self._handle, self.host, self.port, origins=ALLOWED_ORIGINS, compression=None
            ) as server:
                self.port = server.sockets[0].getsockname()[1] if server.sockets else self.port
                log.info("listening on ws://%s:%d", self.host, self.port)
                if ready:
                    ready.set()
                status = asyncio.create_task(self._status_loop())
                try:
                    await asyncio.Future()
                finally:
                    status.cancel()
        finally:
            self._stop.set()
            worker.join(timeout=2)
            self.camera.close()

    async def _handle(self, connection: ServerConnection) -> None:
        client = Client(connection)
        self._clients.add(client)
        log.info("client connected (%d total)", len(self._clients))
        await connection.send(json.dumps(self._hello()))
        sender = asyncio.create_task(self._send_loop(client))
        try:
            async for message in connection:
                if isinstance(message, str):
                    self._on_text(client, message)
        except ConnectionClosed:
            pass
        finally:
            sender.cancel()
            self._clients.discard(client)
            log.info("client disconnected (%d total)", len(self._clients))

    def _on_text(self, client: Client, message: str) -> None:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            return
        if isinstance(data, dict) and data.get("type") == "preview":
            client.preview = bool(data.get("enabled"))

    async def _send_loop(self, client: Client) -> None:
        try:
            while True:
                await client.connection.send(await client.queue.get())
        except ConnectionClosed:
            pass

    async def _status_loop(self) -> None:
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            status = json.dumps(
                {
                    "type": "status",
                    "fps": round(1 / self._frame_s, 1) if self._frame_s else 0.0,
                    "inferenceMs": round(self._inference_ms, 1),
                }
            )
            for client in list(self._clients):
                client.offer(status)

    def _hello(self) -> dict:
        c = self.camera
        return {
            "type": "hello",
            "model": self.estimator.name,
            "camera": {"label": c.label, "width": c.width, "height": c.height, "frameRate": c.fps},
        }

    def _capture_loop(self) -> None:
        last_preview = 0.0
        last_frame = time.monotonic()
        while not self._stop.is_set():
            got = self.camera.read()
            if got is None:
                continue
            frame, captured_at = got
            start = time.perf_counter()
            keypoints, scores = self.estimator(frame)
            inference_ms = (time.perf_counter() - start) * 1000
            h, w = frame.shape[:2]
            message = encode_detections(
                Detections(
                    frame_id=self.frames,
                    captured_at_ms=captured_at,
                    inference_ms=inference_ms,
                    width=w,
                    height=h,
                    people=len(keypoints),
                    landmarks=to_app_layout(keypoints, scores, w, h),
                )
            )
            self.frames += 1
            now = time.monotonic()
            # Smooth the interval, not 1/interval: averaging rates overstates fps (36 vs 30.7).
            dt = now - last_frame
            self._frame_s = dt if self._frame_s == 0 else 0.9 * self._frame_s + 0.1 * dt
            self._inference_ms = 0.9 * self._inference_ms + 0.1 * inference_ms
            last_frame = now

            preview = None
            if now - last_preview >= self._preview_interval and any(
                c.preview for c in self._clients
            ):
                preview = encode_preview(_jpeg(frame))
                last_preview = now
            if self._loop:
                self._loop.call_soon_threadsafe(self._publish, message, preview)

    def _publish(self, message: bytes, preview: bytes | None) -> None:
        for client in list(self._clients):
            client.offer(message)
            if preview and client.preview:
                client.offer(preview)


def _jpeg(frame: np.ndarray) -> bytes:
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (PREVIEW_WIDTH, round(h * PREVIEW_WIDTH / w)))
    ok, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return buf.tobytes() if ok else b""
