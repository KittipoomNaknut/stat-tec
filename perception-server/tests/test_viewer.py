import json
import re

from stat_tec_perception.monitor import EventLog
from stat_tec_perception.viewer import Day, Follower, render

ANSI = re.compile(r"\033\[[0-9;]*[A-Za-z]")


def plain(text: str) -> str:
    return ANSI.sub("", text)


def test_open_problems_show_with_what_to_do_until_resolved():
    day = Day()
    day.add({"t": 100, "level": "error", "name": "problem", "problem": "camera-lost"})
    day.add({"t": 101, "level": "warn", "name": "problem", "problem": "low-fps", "fps": 14})
    screen = plain(render(day, {"t": 130, "fps": 14}, 130, 80, 40))
    assert "ปัญหาที่ยังไม่หาย (2)" in screen
    assert "กล้องไม่ส่งภาพ" in screen and "เช็กสาย USB" in screen
    assert "fps 14" in screen

    day.add({"t": 140, "level": "info", "name": "resolved", "problem": "camera-lost"})
    screen = plain(render(day, {"t": 140}, 140, 80, 40))
    assert "ปัญหาที่ยังไม่หาย (1)" in screen
    assert "หายแล้ว: กล้องไม่ส่งภาพ" in screen  # in the event feed
    assert "ปัญหา 2" in screen  # today's count keeps both


def test_a_dead_service_is_the_first_thing_on_screen():
    screen = plain(render(Day(), {"t": 0, "fps": 30}, 100, 80, 40))
    assert "ตัวจับท่าไม่ได้ทำงาน" in screen.splitlines()[1]
    assert "ตัวจับท่าไม่ได้ทำงาน" in plain(render(Day(), None, 100, 80, 40))


def test_today_numbers():
    day = Day()
    for e in (
        {"name": "visit-start", "visit": 1},
        {"name": "pose", "pose": "both-up", "waitMs": 900},
        {"name": "pose", "pose": None, "prompt": "t-pose"},
        {"name": "visit-end", "visit": 1, "durationS": 180, "profit": 900000, "rank": 1},
        {"name": "visit-start", "visit": 2},
        {"name": "visit-abandoned", "visit": 2, "chapter": "rival", "level": "warn"},
        {"name": "error", "level": "error", "message": "boom"},
    ):
        day.add({"t": 100, "level": "info", **e})
    screen = plain(render(day, {"t": 100}, 100, 100, 40))
    assert "วันนี้ 2 รอบ (จบ 1 · ออกกลางคัน 1)" in screen
    assert "เฉลี่ย 3.0 นาที" in screen
    assert "ท่าหมดเวลา 1/2" in screen
    assert "error 1" in screen
    assert "เดินออกกลางคัน รอบ #2 ที่ EP II" in screen


def test_follower_reads_only_new_whole_lines(tmp_path):
    log = EventLog(tmp_path)
    follower = Follower(tmp_path)
    log.write("app", "visit-start", visit=1)
    t = log.recent[-1]["t"]
    assert [e["name"] for e in follower.read(t)] == ["visit-start"]
    assert follower.read(t) == []
    path = follower.path
    assert path is not None
    with path.open("a") as f:
        f.write(json.dumps({"t": t, "name": "chapter"}) + "\n" + '{"t": 1, "na')
    assert [e["name"] for e in follower.read(t)] == ["chapter"]  # the half line waits
    with path.open("a") as f:
        f.write('me": "pose"}\n')
    assert [e["name"] for e in follower.read(t)] == ["pose"]
