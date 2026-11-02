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
from .monitor import EventLog, Problems, clean_app_event, cpu_temp, gpu_reading, on_mains
from .protocol import Detections, encode_detections, encode_preview

log = logging.getLogger(__name__)

# Browser pages on this machine; None = non-browser clients (tools, tests) that send no Origin.
ALLOWED_ORIGINS = [re.compile(r"https?://(localhost|127\.0\.0\.1)(:\d+)?"), None]
PREVIEW_WIDTH = 640
STATUS_INTERVAL_S = 1.0
HARDWARE_EVERY = 5  # status ticks between temperature readings (nvidia-smi takes ~30 ms)
HEALTH_LOG_EVERY = 60  # status ticks between health lines in the event log


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
        events: EventLog | None = None,
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
        self._last_frame_at = 0.0  # monotonic; 0 = no frame yet
        self._started = time.monotonic()
        self._people = 0
        self.events = events or EventLog(None)
        self._problems = Problems(self.events)
        for name, level, open_s, close_s in (
            ("camera-lost", "error", 0, 1),  # "bad" already means 2 s without a frame
            ("low-fps", "warn", 3, 3),
            ("slow-pose", "warn", 5, 3),
            ("app-missing", "error", 15, 0),
            ("app-slow", "warn", 10, 5),
            ("gpu-hot", "warn", 10, 10),
            ("cpu-hot", "warn", 10, 10),
            ("on-battery", "warn", 2, 0),
        ):
            self._problems.rule(name, level, open_s, close_s)
        self._hardware: dict = {}
        self._app: dict = {}  # last app-health fields, and when they came ("at", monotonic)

    async def serve_forever(self, ready: asyncio.Event | None = None) -> None:
        self._loop = asyncio.get_running_loop()
        self._started = time.monotonic()
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
                self.events.write(
                    "service",
                    "service-start",
                    camera=self.camera.label,
                    width=self.camera.width,
                    height=self.camera.height,
                    model=self.estimator.name,
                )
                status = asyncio.create_task(self._status_loop())
                try:
                    await asyncio.Future()
                finally:
                    status.cancel()
                    self.events.write("service", "service-stop")
        finally:
            self._stop.set()
            worker.join(timeout=2)
            self.camera.close()

    async def _handle(self, connection: ServerConnection) -> None:
        client = Client(connection)
        self._clients.add(client)
        log.info("client connected (%d total)", len(self._clients))
        self.events.write("service", "app-connected", clients=len(self._clients))
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
            self.events.write("service", "app-disconnected", "warn", clients=len(self._clients))

    def _on_text(self, client: Client, message: str) -> None:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return
        if data.get("type") == "preview":
            client.preview = bool(data.get("enabled"))
        elif data.get("type") == "event":
            event = clean_app_event(data)
            if event is None:
                return
            name, level, fields = event
            if name == "app-health":
                # Every few seconds: kept for status.json and the app-slow rule, not logged
                self._app = {**fields, "at": time.monotonic()}
                return
            self.events.write("app", name, level, **fields)

    async def _send_loop(self, client: Client) -> None:
        try:
            while True:
                await client.connection.send(await client.queue.get())
        except ConnectionClosed:
            pass

    async def _status_loop(self) -> None:
        tick = 0
        while True:
            await asyncio.sleep(STATUS_INTERVAL_S)
            fps = round(1 / self._frame_s, 1) if self._frame_s else 0.0
            status = json.dumps(
                {"type": "status", "fps": fps, "inferenceMs": round(self._inference_ms, 1)}
            )
            for client in list(self._clients):
                client.offer(status)
            if tick % HARDWARE_EVERY == 0:
                self._hardware = await asyncio.to_thread(_hardware)
            health = self._health(fps)
            self.events.status({"t": time.time(), **health, "problems": self._problems.open})
            if tick % HEALTH_LOG_EVERY == 0:
                self.events.write("service", "health", **health)
            tick += 1

    def _health(self, fps: float) -> dict:
        """Current health, after checking it for problems."""
        now = time.monotonic()
        silent_s = now - self._last_frame_at if self._last_frame_at else None
        camera_ok = silent_s is not None and silent_s < 0.5
        hw = self._hardware
        app_fps = self._app.get("fps") if now - self._app.get("at", -1e9) < 15 else None
        p = self._problems
        # Before the first frame: give the camera 5 s to open
        no_frames = silent_s >= 2 if silent_s is not None else now - self._started >= 5
        p.check("camera-lost", no_frames, camera_ok, now)
        # fps and inference only mean something while frames come in
        p.check("low-fps", camera_ok and fps < 20, camera_ok and fps >= 24, now, fps=fps)
        slow, ms = self._inference_ms > 40, round(self._inference_ms, 1)
        p.check("slow-pose", camera_ok and slow, self._inference_ms < 30, now, ms=ms)
        clients = len(self._clients)
        p.check("app-missing", clients == 0, clients > 0, now)
        if isinstance(app_fps, int | float):
            p.check("app-slow", app_fps < 30, app_fps >= 45, now, appFps=app_fps)
        if "gpuC" in hw:
            p.check("gpu-hot", hw["gpuC"] >= 85, hw["gpuC"] < 80, now, gpuC=hw["gpuC"])
        if "cpuC" in hw:
            p.check("cpu-hot", hw["cpuC"] >= 95, hw["cpuC"] < 88, now, cpuC=hw["cpuC"])
        if "mains" in hw:
            p.check("on-battery", not hw["mains"], hw["mains"], now)
        return {
            "fps": fps,
            "inferenceMs": round(self._inference_ms, 1),
            "people": self._people,
            "clients": clients,
            "cameraSilentS": round(silent_s, 1) if silent_s is not None else None,
            "appFps": app_fps,
            **hw,
        }

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
            self._people = len(keypoints)
            now = time.monotonic()
            self._last_frame_at = now
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


def _hardware() -> dict:
    """Temperatures and power, for the status line and the hot / battery rules."""
    reading: dict = gpu_reading() or {}
    cpu = cpu_temp()
    if cpu is not None:
        reading["cpuC"] = cpu
    mains = on_mains()
    if mains is not None:
        reading["mains"] = mains
    return reading
