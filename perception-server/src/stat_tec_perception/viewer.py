"""
`stat-tec-log`: the booth's live log in a terminal (research 026).

Redraws once a second from `status.json` and today's `events-*.jsonl`: the health line, a red
box of problems still open (what broke, since when, what to do), today's numbers and the latest
events. Rings the terminal bell when a problem opens. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .monitor import DEFAULT_LOG_DIR, today_file

RED, YELLOW, GREEN, DIM, BOLD, RESET = (
    "\033[31m",
    "\033[33m",
    "\033[32m",
    "\033[2m",
    "\033[1m",
    "\033[0m",
)
STALE_S = 5  # status.json older than this: the service is not running

# What each problem means and what the staff can do about it
PROBLEMS: dict[str, tuple[str, str]] = {
    "camera-lost": ("กล้องไม่ส่งภาพ", "เช็กสาย USB กล้อง / ถอดเสียบใหม่ (ระบบต่อใหม่เอง)"),
    "low-fps": ("กล้องได้เฟรมน้อย", "เปิดไฟห้องให้สว่างขึ้น (ห้องมืด กล้องจะช้าลง)"),
    "slow-pose": ("จับท่าช้า", "เครื่องอาจร้อนหรือ GPU ถูกแย่ง ปิดโปรแกรมอื่น"),
    "app-missing": ("หน้าเกมไม่ได้เชื่อมต่อ", "หน้าเกมปิดอยู่หรือค้าง: ./scripts/demo.sh start ใหม่"),
    "app-slow": ("เกมกระตุก (fps ต่ำ)", "เครื่องร้อน/ไฟไม่พอ: เสียบชาร์จ พักเครื่อง"),
    "gpu-hot": ("GPU ร้อนเกิน", "เปิดพัดลม ยกเครื่องให้อากาศถ่าย พักระหว่างรอบ"),
    "cpu-hot": ("CPU ร้อนเกิน", "เปิดพัดลม ยกเครื่องให้อากาศถ่าย พักระหว่างรอบ"),
    "on-battery": ("ไม่ได้เสียบสายชาร์จ", "เสียบสายชาร์จ (ใช้แบตเครื่องจะช้าลง)"),
}

STAFF = {
    "start": "เริ่มเกม",
    "skip": "ข้ามบทพูด",
    "next": "ข้ามทั้งบท",
    "pause": "พัก / เล่นต่อ",
    "reset": "กลับหน้าแรก",
    "pick": "เลือกผู้เล่น",
}
CHAPTERS = {"coffee": "EP I", "slash": "EP II", "rival": "EP II (เก่า)"}
POSES = {
    "both-up": "🙌",
    "left-up": "✋ซ้าย",
    "right-up": "✋ขวา",
    "cross": "❌",
    "t-pose": "🤸",
}


@dataclass
class Day:
    """Today's events, folded into what the screen shows."""

    events: list[dict[str, Any]] = field(default_factory=list)
    open: dict[str, dict[str, Any]] = field(default_factory=dict)  # problem → its event
    visits: int = 0
    finished: int = 0
    abandoned: int = 0
    durations: list[float] = field(default_factory=list)
    pose_timeouts: int = 0
    poses: int = 0
    problems: int = 0
    errors: int = 0

    def add(self, e: dict[str, Any]) -> None:
        name = e.get("name")
        if name == "health":
            return  # periodic; the live line comes from status.json
        self.events.append(e)
        self.events = self.events[-500:]
        if name == "problem":
            self.open[str(e.get("problem"))] = e
            self.problems += 1
        elif name == "resolved":
            self.open.pop(str(e.get("problem")), None)
        elif name == "service-start":
            self.open.clear()  # a fresh service starts with no problems
        elif name == "visit-start":
            self.visits += 1
        elif name == "visit-end":
            self.finished += 1
            if isinstance(e.get("durationS"), int | float):
                self.durations.append(float(e["durationS"]))
        elif name == "visit-abandoned":
            self.abandoned += 1
        elif name == "pose":
            self.poses += 1
            if e.get("pose") is None:
                self.pose_timeouts += 1
        if e.get("level") == "error" and name != "problem":
            self.errors += 1


def clock(t: float) -> str:
    return datetime.fromtimestamp(t).strftime("%H:%M:%S")


def describe(e: dict[str, Any]) -> tuple[str, str]:
    """(color, text) of one event line."""
    name = e.get("name", "?")
    level = e.get("level", "info")
    color = RED if level == "error" else YELLOW if level == "warn" else ""
    ch = CHAPTERS.get(str(e.get("chapter")), str(e.get("chapter", "")))
    if name == "problem":
        title = PROBLEMS.get(str(e.get("problem")), (str(e.get("problem")), ""))[0]
        return color or YELLOW, f"⚠ ปัญหา: {title}{_extra(e)}"
    if name == "resolved":
        title = PROBLEMS.get(str(e.get("problem")), (str(e.get("problem")), ""))[0]
        return GREEN, f"✓ หายแล้ว: {title} (นาน {e.get('lastedS')} s)"
    if name == "visit-start":
        return BOLD, f"▶ เริ่มรอบ #{e.get('visit')}  {e.get('codename', '')}"
    if name == "visit-end":
        return BOLD, (
            f"■ จบรอบ #{e.get('visit')}  {_minutes(e.get('durationS'))}"
            f"  ฿{_baht(e.get('profit'))}  อันดับ {e.get('rank')}"
        )
    if name == "visit-abandoned":
        return YELLOW, f"↩ เดินออกกลางคัน รอบ #{e.get('visit')} ที่ {ch or 'ต้นเกม'}"
    if name == "visit-paused":
        return DIM, f"⏸ มองไม่เห็นผู้เล่น ({ch or 'ต้นเกม'})"
    if name == "visit-resumed":
        return DIM, f"⏵ ผู้เล่นกลับมา (หายไป {e.get('pausedS')} s)"
    if name == "chapter":
        return "", f"{ch} เริ่ม"
    if name == "chapter-done":
        return "", f"{ch} จบ  คะแนน {e.get('score')}  ฿{_baht(e.get('profit'))}"
    if name == "pose":
        if e.get("pose") is None:
            return YELLOW, f"{ch} ⏱ ไม่มีใครทำท่า หมดเวลา ({e.get('prompt')})"
        return (
            "",
            f"{ch} {POSES.get(str(e.get('pose')), e.get('pose'))} ทำได้ใน {_secs(e.get('waitMs'))}",
        )
    if name == "reset":
        return DIM, "F5 สตาฟกลับหน้าแรก"
    if name == "staff":
        what = STAFF.get(str(e.get("command")), str(e.get("command")))
        return BOLD, f"🛠 สตาฟสั่ง: {what}"
    if name in ("service-start", "service-stop", "app-connected", "app-disconnected"):
        size = f"{e.get('width')}x{e.get('height')}"
        label = {
            "service-start": f"ตัวจับท่าเริ่มทำงาน · {e.get('camera')} {size}",
            "service-stop": "ตัวจับท่าหยุด",
            "app-connected": "หน้าเกมเชื่อมต่อแล้ว",
            "app-disconnected": "หน้าเกมหลุดการเชื่อมต่อ",
        }[name]
        return color or DIM, label
    detail = " ".join(f"{k}={v}" for k, v in e.items() if k not in ("t", "src", "level", "name"))
    prefix = "✖ " if level == "error" else "⚠ " if level == "warn" else ""
    return color, f"{prefix}{name} {detail}".rstrip()


def _extra(e: dict[str, Any]) -> str:
    keys = ("fps", "ms", "appFps", "gpuC", "cpuC")
    parts = [f"{k} {e[k]}" for k in keys if k in e]
    return f" ({', '.join(parts)})" if parts else ""


def _baht(v: Any) -> str:
    return f"{v:,.0f}" if isinstance(v, int | float) else "-"


def _minutes(v: Any) -> str:
    return f"{v / 60:.1f} นาที" if isinstance(v, int | float) else "-"


def _secs(v: Any) -> str:
    return f"{v / 1000:.1f} s" if isinstance(v, int | float) else "-"


def health_line(status: dict[str, Any] | None, now: float) -> str:
    if status is None or now - status.get("t", 0) > STALE_S:
        return f"{RED}{BOLD}✖ ตัวจับท่าไม่ได้ทำงาน{RESET}  (เริ่มด้วย ./scripts/demo.sh start)"

    def val(v: Any, text: str, bad: bool, warn: bool = False) -> str:
        if v is None:
            label = text.split(" ")[0]
            return f"{DIM}{label} -{RESET}"
        color = RED if bad else YELLOW if warn else GREEN
        return f"{color}{text}{RESET}"

    fps, ms = status.get("fps"), status.get("inferenceMs")
    gpu, cpu, app = status.get("gpuC"), status.get("cpuC"), status.get("appFps")
    parts = [
        val(fps, f"กล้อง {fps} fps", (fps or 0) < 20, (fps or 0) < 24),
        val(ms, f"จับท่า {ms} ms", (ms or 0) > 40, (ms or 0) > 30),
        val(app, f"เกม {app} fps", (app or 0) < 30, (app or 0) < 45),
        val(gpu, f"GPU {gpu}°C", (gpu or 0) >= 85, (gpu or 0) >= 78),
        val(cpu, f"CPU {cpu}°C", (cpu or 0) >= 95, (cpu or 0) >= 85),
        f"ผู้เล่นในภาพ {status.get('people', 0)}",
    ]
    if status.get("mains") is False:
        parts.append(f"{RED}ใช้แบต{RESET}")
    return " · ".join(parts)


def render(day: Day, status: dict[str, Any] | None, now: float, width: int, height: int) -> str:
    rule = "─" * width
    out = [f"{BOLD}STAT_TEC live{RESET} · {clock(now)}", health_line(status, now), rule]

    if day.open:
        out.append(f"{RED}{BOLD}ปัญหาที่ยังไม่หาย ({len(day.open)}){RESET}")
        for name, e in day.open.items():
            title, todo = PROBLEMS.get(name, (name, ""))
            since = now - e.get("t", now)
            out.append(f"{RED}█ {title}{_extra(e)}  ตั้งแต่ {clock(e['t'])} ({since:.0f} s){RESET}")
            if todo:
                out.append(f"{RED}  → {todo}{RESET}")
    else:
        out.append(f"{GREEN}✓ ไม่มีปัญหา{RESET}")
    out.append(rule)

    avg = sum(day.durations) / len(day.durations) if day.durations else None
    summary = [
        f"วันนี้ {day.visits} รอบ (จบ {day.finished} · ออกกลางคัน {day.abandoned})",
        f"เฉลี่ย {_minutes(avg)}" if avg else "เฉลี่ย -",
        f"ท่าหมดเวลา {day.pose_timeouts}/{day.poses}",
        f"{RED if day.problems else ''}ปัญหา {day.problems}{RESET}",
        f"{RED if day.errors else ''}error {day.errors}{RESET}",
    ]
    out += [" · ".join(summary), rule]

    room = max(height - len(out) - 1, 3)
    for e in day.events[-room:]:
        color, text = describe(e)
        out.append(f"{DIM}{clock(e['t'])}{RESET}  {color}{text}{RESET}")
    return "\n".join(out)


class Follower:
    """Reads new lines of today's file, switching files at midnight."""

    def __init__(self, log_dir: Path) -> None:
        self.log_dir = log_dir
        self.path: Path | None = None
        self.offset = 0

    def read(self, now: float) -> list[dict[str, Any]]:
        path = today_file(self.log_dir, now)
        if path != self.path:
            self.path, self.offset = path, 0
        if not path.exists():
            return []
        with path.open("rb") as f:
            f.seek(self.offset)
            data = f.read()
        end = data.rfind(b"\n") + 1  # a half-written last line waits for the next read
        self.offset += end
        events = []
        for line in data[:end].splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events


def read_status(log_dir: Path) -> dict[str, Any] | None:
    path = log_dir / "status.json"
    try:
        status = json.loads(path.read_text(encoding="utf-8"))
        status.setdefault("t", path.stat().st_mtime)
        return status
    except (OSError, json.JSONDecodeError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(prog="stat-tec-log", description="live booth log")
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    parser.add_argument("--once", action="store_true", help="print one screen and exit")
    args = parser.parse_args()

    day = Day()
    follower = Follower(args.log_dir)
    seen_day = None
    try:
        while True:
            now = time.time()
            today = datetime.fromtimestamp(now).date()
            if today != seen_day:
                day, seen_day = Day(), today
            opened = len(day.open)
            for e in follower.read(now):
                day.add(e)
            size = shutil.get_terminal_size((100, 40))
            screen = render(day, read_status(args.log_dir), now, size.columns, size.lines)
            if args.once:
                print(screen)
                return
            bell = "\a" if len(day.open) > opened else ""
            sys.stdout.write(f"\033[H\033[2J{screen}{bell}")
            sys.stdout.flush()
            time.sleep(1)
    except KeyboardInterrupt:
        sys.stdout.write(RESET + "\n")


if __name__ == "__main__":
    main()
