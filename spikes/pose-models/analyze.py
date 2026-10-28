"""Summarize a compare_live.py recording: speed, coverage, jitter and flicker per model."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

COMMON = ["nose", "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist", "l_hip", "r_hip"]
JITTER_POINTS = [0, 1, 2, 5, 6]  # nose, shoulders, wrists — same as the app's jitter meter
THRESHOLDS = {"mediapipe": 0.5}
DEFAULT_THRESHOLD = 0.3


def flips(visible: np.ndarray) -> np.ndarray:
    """Show/hide changes per landmark."""
    return np.abs(np.diff(visible.astype(int), axis=0)).sum(axis=0)


def summarize(path: Path) -> None:
    data = np.load(path)
    phases = data["phases"]
    still = phases == "still"
    move = phases == "move"
    print(f"\n{path.name}: {len(phases)} frames ({still.sum()} still, {move.sum()} moving)\n")
    header = f"{'model':<17}{'ms avg':>8}{'ms p95':>8}{'found':>7}{'jitter still px':>17}{'flips/landmark (move)':>23}{'hidden (move)':>15}"
    print(header)
    print("-" * len(header))
    for name in data["names"]:
        xy = data[f"{name}__xy"]
        score = data[f"{name}__score"]
        ms = data[f"{name}__ms"]
        found = ~np.isnan(xy[:, 0, 0])
        visible = score >= THRESHOLDS.get(str(name), DEFAULT_THRESHOLD)

        s = xy[still][:, JITTER_POINTS]
        step = np.linalg.norm(np.diff(s, axis=0), axis=2)
        jitter = np.nanmean(step)

        mv = visible[move]
        print(
            f"{name!s:<17}{ms.mean():>8.1f}{np.percentile(ms, 95):>8.1f}{found.mean() * 100:>6.0f}%"
            f"{jitter:>17.2f}{flips(mv).mean():>23.1f}{(1 - mv.mean()) * 100:>14.0f}%"
        )

    print("\nFlips during movement, per landmark:")
    print(f"{'':<17}" + "".join(f"{c:>11}" for c in COMMON))
    for name in data["names"]:
        visible = data[f"{name}__score"] >= THRESHOLDS.get(str(name), DEFAULT_THRESHOLD)
        print(f"{name!s:<17}" + "".join(f"{v:>11}" for v in flips(visible[move])))


if __name__ == "__main__":
    summarize(Path(sys.argv[1]))
