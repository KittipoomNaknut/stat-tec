import asyncio
import json
import time

import numpy as np
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from stat_tec_perception.protocol import DETECTIONS_MAGIC, PREVIEW_MAGIC, decode_detections
from stat_tec_perception.server import Client, PerceptionServer


class FakeCamera:
    index, width, height, fps, label = 0, 320, 180, 30, "fake"

    def read(self):
        time.sleep(1 / 60)
        return np.zeros((self.height, self.width, 3), np.uint8), time.time() * 1000

    def close(self):
        pass


class FakeEstimator:
    name = "fake"

    def __call__(self, frame):
        kp = np.zeros((1, 17, 2))
        kp[0, :, 0], kp[0, :, 1] = 160, 90
        return kp, np.full((1, 17), 0.9)


async def with_server(test):
    server = PerceptionServer(FakeCamera(), FakeEstimator(), port=0, preview_fps=50)
    ready = asyncio.Event()
    task = asyncio.create_task(server.serve_forever(ready))
    await asyncio.wait_for(ready.wait(), 5)
    try:
        await asyncio.wait_for(test(f"ws://127.0.0.1:{server.port}"), 10)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def next_binary(ws, magic):
    while True:
        message = await ws.recv()
        if isinstance(message, bytes) and message[:4] == magic:
            return message


def test_hello_then_detections():
    async def test(url):
        async with connect(url) as ws:
            hello = json.loads(await ws.recv())
            assert hello["type"] == "hello"
            assert hello["camera"]["width"] == 320
            d = decode_detections(await next_binary(ws, DETECTIONS_MAGIC))
            assert d.people == 1
            lm = d.landmarks.reshape(1, 33, 4)
            assert lm[0, 0, :2].tolist() == pytest.approx([0.5, 0.5])  # nose at the center

    asyncio.run(with_server(test))


def test_preview_only_after_asking():
    async def test(url):
        async with connect(url) as ws:
            await ws.recv()
            await ws.send(json.dumps({"type": "preview", "enabled": True}))
            jpeg = (await next_binary(ws, PREVIEW_MAGIC))[4:]
            assert jpeg[:2] == b"\xff\xd8"  # JPEG start marker

    asyncio.run(with_server(test))


def test_rejects_other_websites_but_allows_local_pages():
    async def test(url):
        with pytest.raises(InvalidStatus) as err:
            async with connect(url, origin="https://evil.example"):
                pass
        assert err.value.response.status_code == 403
        async with connect(url, origin="http://localhost:5173") as ws:
            assert json.loads(await ws.recv())["type"] == "hello"

    asyncio.run(with_server(test))


def test_slow_client_keeps_only_the_newest_messages():
    async def test():
        client = Client(connection=None)  # type: ignore[arg-type]
        for i in range(10):
            client.offer(f"m{i}")
        assert [client.queue.get_nowait() for _ in range(client.queue.qsize())] == ["m8", "m9"]

    asyncio.run(test())
