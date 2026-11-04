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


def test_holding_the_frame_rate_without_a_camera_is_a_no_op():
    from stat_tec_perception.camera import hold_frame_rate

    assert hold_frame_rate(99) is None


class SceneEstimator(FakeEstimator):
    """Like the real estimator: keeps what its filters saw while asked to (staff screen)."""

    record_scene = False
    scene = None

    def __call__(self, frame):
        if self.record_scene:
            self.scene = {"dropped": [{"box": [0.9, 0.1, 1.0, 0.3], "why": "small"}], "poses": []}
        return super().__call__(frame)


def test_staff_screen_sees_scene_log_and_status_but_is_not_the_game():
    server = PerceptionServer(FakeCamera(), SceneEstimator(), port=0, preview_fps=50)

    async def run():
        ready = asyncio.Event()
        task = asyncio.create_task(server.serve_forever(ready))
        await asyncio.wait_for(ready.wait(), 5)
        url = f"ws://127.0.0.1:{server.port}/operator"
        try:
            async with connect(url) as ws:
                hello = json.loads(await ws.recv())
                assert hello["type"] == "hello"
                got: dict = {}
                while not {"scene", "ops", "preview"} <= got.keys():
                    message = await asyncio.wait_for(ws.recv(), 5)
                    if isinstance(message, bytes):
                        assert message[:4] != DETECTIONS_MAGIC  # no detections for it
                        got["preview"] = message[:4] == PREVIEW_MAGIC
                        continue
                    data = json.loads(message)
                    got.setdefault(data["type"], data)
                assert got["scene"]["dropped"][0]["why"] == "small"
                assert got["ops"]["health"]["clients"] == 0  # the game is not connected
                assert server.estimator.record_scene
                # a game event reaches the staff screen as a formatted line
                async with connect(f"ws://127.0.0.1:{server.port}") as game:
                    await game.recv()
                    while True:
                        data = json.loads(await _next_text(ws))
                        if data["type"] == "log" and "เชื่อมต่อแล้ว" in data["text"]:
                            break
            await asyncio.sleep(0.1)
            assert not server.estimator.record_scene  # nobody watching: no extra work
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(asyncio.wait_for(run(), 15))


async def _next_text(ws):
    while True:
        message = await ws.recv()
        if isinstance(message, str):
            return message


def test_staff_commands_reach_the_game_and_bad_ones_do_not():
    async def test(url):
        async with connect(url) as game, connect(f"{url}/operator") as staff:
            await game.recv()  # hello
            await staff.send(json.dumps({"type": "command", "name": "rm -rf"}))
            await staff.send(json.dumps({"type": "command", "name": "pick", "x": 2, "y": 0.5}))
            await staff.send(json.dumps({"type": "command", "name": "pick", "x": 0.3, "y": 0.6}))
            await staff.send(json.dumps({"type": "command", "name": "skip"}))
            got = []
            while len(got) < 2:
                message = await game.recv()
                if isinstance(message, str) and json.loads(message)["type"] == "command":
                    got.append(json.loads(message))
            assert got == [
                {"type": "command", "name": "pick", "x": 0.3, "y": 0.6},
                {"type": "command", "name": "skip"},
            ]
            # the game reports who it follows; the staff screen hears it
            await game.send(json.dumps({"type": "lock", "state": "locked", "x": 0.4, "y": 0.5}))
            while True:
                data = json.loads(await _next_text(staff))
                if data["type"] == "lock":
                    assert data == {"type": "lock", "state": "locked", "x": 0.4, "y": 0.5}
                    break

    asyncio.run(with_server(test))
