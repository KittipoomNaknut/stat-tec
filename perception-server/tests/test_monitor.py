import asyncio
import json

from websockets.asyncio.client import connect

from stat_tec_perception.monitor import EventLog, Problems, clean_app_event, today_file
from stat_tec_perception.server import PerceptionServer

from .test_server import FakeCamera, FakeEstimator


def test_problem_opens_after_it_holds_and_resolves_with_its_duration():
    log = EventLog(None)
    problems = Problems(log)
    problems.rule("low-fps", "warn", open_s=3, close_s=2)
    for t in (0, 1, 2):
        problems.check("low-fps", bad=True, ok=False, now=t, fps=12)
    assert problems.open == []  # 2 s of bad fps: not yet
    problems.check("low-fps", bad=True, ok=False, now=3, fps=12)
    assert problems.open == ["low-fps"]
    assert log.recent[-1] == {**log.recent[-1], "name": "problem", "problem": "low-fps", "fps": 12}

    # In the band between bad and ok: still open; then ok for 2 s resolves it
    problems.check("low-fps", bad=False, ok=False, now=4)
    problems.check("low-fps", bad=False, ok=True, now=5)
    assert problems.open == ["low-fps"]
    problems.check("low-fps", bad=False, ok=True, now=7)
    assert problems.open == []
    assert log.recent[-1]["name"] == "resolved"
    assert log.recent[-1]["lastedS"] == 7.0
    assert len(log.recent) == 2  # one line each way, not one per check


def test_a_blip_never_opens_a_problem():
    problems = Problems(EventLog(None))
    problems.rule("gpu-hot", open_s=10)
    for t in range(0, 30, 2):
        problems.check("gpu-hot", bad=t % 4 == 0, ok=t % 4 != 0, now=t)
    assert problems.open == []


def test_app_events_are_cleaned():
    assert clean_app_event({"name": ""}) is None
    assert clean_app_event({"name": "x" * 41}) is None
    assert clean_app_event({"name": 3}) is None
    name, level, fields = clean_app_event(
        {
            "name": "pose",
            "level": "loud",
            "fields": {
                "pose": "left-up",
                "waitMs": 1200,
                "ok": True,
                "nested": {"a": 1},
                "list": [1, 2],
                "t": 5,
                "note": "y" * 1000,
            },
        }
    )
    assert (name, level) == ("pose", "info")
    assert fields == {"pose": "left-up", "waitMs": 1200, "ok": True, "note": "y" * 300}


def test_event_log_writes_a_line_per_event_and_the_status(tmp_path):
    log = EventLog(tmp_path)
    log.write("app", "visit-start", visit=1)
    log.write("app", "error", "error", message="boom")
    log.status({"fps": 30})
    lines = today_file(tmp_path).read_text().splitlines()
    assert [json.loads(line)["name"] for line in lines] == ["visit-start", "error"]
    assert json.loads(lines[1])["level"] == "error"
    assert json.loads((tmp_path / "status.json").read_text()) == {"fps": 30}


def test_service_logs_app_events_but_not_app_health(tmp_path):
    events = EventLog(tmp_path)
    server = PerceptionServer(FakeCamera(), FakeEstimator(), port=0, events=events)

    async def run():
        ready = asyncio.Event()
        task = asyncio.create_task(server.serve_forever(ready))
        await asyncio.wait_for(ready.wait(), 5)
        try:
            async with connect(f"ws://127.0.0.1:{server.port}") as ws:
                await ws.recv()
                await ws.send(
                    json.dumps({"type": "event", "name": "app-health", "fields": {"fps": 58}})
                )
                await ws.send(
                    json.dumps({"type": "event", "name": "visit-start", "fields": {"visit": 4}})
                )
                await ws.send("not json")
                # Keep reading (a client that stops reading stalls the close) until a
                # status tick has written the app's fps to status.json
                status = tmp_path / "status.json"
                for _ in range(200):
                    await ws.recv()
                    if status.exists() and json.loads(status.read_text()).get("appFps"):
                        break
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())
    names = [e["name"] for e in events.recent]
    assert "visit-start" in names
    assert "app-health" not in names
    assert names[0] == "service-start"
    assert json.loads((tmp_path / "status.json").read_text())["appFps"] == 58
