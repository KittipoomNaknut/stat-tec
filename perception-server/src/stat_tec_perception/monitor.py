"""
Live event log for the booth (research 026): the service's health, the app's events and, above
all, problems — opened when something goes wrong, resolved when it recovers.

Writes one JSON object per line to `events-YYYY-MM-DD.jsonl` and the latest health to
`status.json`, both read live by `stat-tec-log`. Only names and numbers: never images, faces or
body coordinates (ARCHITECTURE §17).
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_LOG_DIR = Path.home() / ".cache" / "stat-tec" / "logs"

# App events: short names and flat values only, so a buggy page cannot flood the log
MAX_EVENT_FIELDS = 12
MAX_TEXT = 300


def today_file(log_dir: Path, now: float | None = None) -> Path:
    day = datetime.fromtimestamp(now if now is not None else time.time()).strftime("%Y-%m-%d")
    return log_dir / f"events-{day}.jsonl"


class EventLog:
    """Appends events to today's file and keeps `status.json` current (`log_dir=None`: memory)."""

    def __init__(self, log_dir: Path | None) -> None:
        self.log_dir = log_dir
        self.recent: list[dict[str, Any]] = []
        if log_dir:
            log_dir.mkdir(parents=True, exist_ok=True)

    def write(self, src: str, name: str, level: str = "info", **fields: Any) -> dict[str, Any]:
        record = {"t": round(time.time(), 3), "src": src, "level": level, "name": name, **fields}
        self.recent = [*self.recent[-199:], record]
        if self.log_dir:
            with today_file(self.log_dir, record["t"]).open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record

    def status(self, status: dict[str, Any]) -> None:
        if not self.log_dir:
            return
        tmp = self.log_dir / "status.json.tmp"
        tmp.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.log_dir / "status.json")


def clean_app_event(data: dict[str, Any]) -> tuple[str, str, dict[str, Any]] | None:
    """(name, level, fields) of an event the app sent, or None if it is not a valid one."""
    name = data.get("name")
    if not isinstance(name, str) or not 0 < len(name) <= 40:
        return None
    level = data.get("level", "info")
    if level not in ("info", "warn", "error"):
        level = "info"
    fields: dict[str, Any] = {}
    raw = data.get("fields")
    if isinstance(raw, dict):
        for key, value in list(raw.items())[:MAX_EVENT_FIELDS]:
            if not isinstance(key, str) or key in ("t", "src", "level", "name"):
                continue
            if isinstance(value, bool) or value is None or isinstance(value, int | float):
                fields[key[:40]] = value
            elif isinstance(value, str):
                fields[key[:40]] = value[:MAX_TEXT]
    return name, level, fields


@dataclass
class Rule:
    """A problem: opens after `bad` holds `open_s`, resolves after `ok` holds `close_s`."""

    name: str
    level: str
    open_s: float
    close_s: float
    since_bad: float | None = None
    since_ok: float | None = None
    opened_at: float | None = None


class Problems:
    """Debounced problems: one line when one starts, one when it ends (with how long it lasted)."""

    def __init__(self, log: EventLog) -> None:
        self._log = log
        self._rules: dict[str, Rule] = {}

    def rule(self, name: str, level: str = "warn", open_s: float = 3, close_s: float = 3) -> None:
        self._rules[name] = Rule(name, level, open_s, close_s)

    @property
    def open(self) -> list[str]:
        return [r.name for r in self._rules.values() if r.opened_at is not None]

    def check(self, name: str, bad: bool, ok: bool, now: float, **detail: Any) -> None:
        """`bad` and `ok` may both be false (the band between them): nothing changes then."""
        r = self._rules[name]
        r.since_bad = (now if r.since_bad is None else r.since_bad) if bad else None
        r.since_ok = (now if r.since_ok is None else r.since_ok) if ok else None
        if r.opened_at is None and r.since_bad is not None and now - r.since_bad >= r.open_s:
            r.opened_at = r.since_bad
            self._log.write("service", "problem", r.level, problem=name, **detail)
        elif r.opened_at is not None and r.since_ok is not None and now - r.since_ok >= r.close_s:
            lasted = round(now - r.opened_at, 1)
            r.opened_at = None
            self._log.write("service", "resolved", "info", problem=name, lastedS=lasted, **detail)


def gpu_reading() -> dict[str, float] | None:
    """NVIDIA GPU temperature (°C) and load (%), or None without one."""
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=temperature.gpu,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        ).stdout
        temp, load = (float(v) for v in out.splitlines()[0].split(","))
        return {"gpuC": temp, "gpuLoad": load}
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def cpu_temp() -> float | None:
    """CPU package temperature (°C) from hwmon, or None."""
    for hwmon in Path("/sys/class/hwmon").glob("hwmon*"):
        try:
            if (hwmon / "name").read_text().strip() in ("coretemp", "k10temp", "zenpower"):
                return int((hwmon / "temp1_input").read_text()) / 1000
        except (OSError, ValueError):
            continue
    return None


def on_mains() -> bool | None:
    """True on the charger, False on battery (a laptop slows down), None if unknown."""
    for supply in Path("/sys/class/power_supply").glob("*"):
        try:
            if (supply / "type").read_text().strip() == "Mains":
                return (supply / "online").read_text().strip() == "1"
        except OSError:
            continue
    return None
