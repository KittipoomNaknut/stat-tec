"""
Analysis of a guided.py recording, raw **and after the app's own smoothing** (One Euro filter
and visibility stabilizer, ported from app/src/perception — same parameters).
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

JITTER_POINTS = [0, 1, 2, 5, 6]  # nose, shoulders, wrists
WRISTS = [5, 6]
WATCHED = [3, 4, 5, 6, 7, 8]  # elbows, wrists, hips
# app/src/config/perception.ts and config/tracking.ts
ONE_EURO = {"min_cutoff": 0.8, "beta": 3.0, "d_cutoff": 1.0}
SMOOTH_MS = 120


def threshold(name: str) -> float:
    return 0.5 if name == "mediapipe" else 0.3


def one_euro(xy: np.ndarray, t_ms: np.ndarray, scale_px: np.ndarray) -> np.ndarray:
    """One Euro over (frames, points, 2); speed divided by body scale like the app."""
    out = xy.copy()
    prev = None
    speed = np.zeros(xy.shape[1:])
    for i in range(len(xy)):
        if np.isnan(xy[i]).any() or prev is None:
            prev = None if np.isnan(xy[i]).any() else xy[i].copy()
            speed[:] = 0
            continue
        dt = max((t_ms[i] - t_ms[i - 1]) / 1000, 1e-3)
        a_d = _alpha(ONE_EURO["d_cutoff"], dt)
        speed = speed + ((xy[i] - prev) / dt - speed) * a_d
        cutoff = ONE_EURO["min_cutoff"] + ONE_EURO["beta"] * np.abs(speed / max(scale_px[i], 1))
        a = _alpha(cutoff, dt)
        prev = prev + (xy[i] - prev) * a
        out[i] = prev
    return out


def _alpha(cutoff, dt: float):
    tau = 1 / (2 * math.pi * cutoff)
    return 1 / (1 + tau / dt)


def stabilized_shown(score: np.ndarray, t_ms: np.ndarray, thr: float) -> np.ndarray:
    """Visibility smoothing + hysteresis, thresholds shifted to each model's score scale."""
    show, hide = thr + 0.1, thr - 0.2
    v = score[0].copy()
    shown = v >= show
    out = [shown.copy()]
    for i in range(1, len(score)):
        a = 1 - math.exp(-(t_ms[i] - t_ms[i - 1]) / SMOOTH_MS)
        v = v + (score[i] - v) * a
        shown = np.where(shown, v >= hide, v >= show)
        out.append(shown.copy())
    return np.array(out)


def flips(mask: np.ndarray) -> float:
    return float(np.abs(np.diff(mask.astype(int), axis=0)).sum(axis=0)[WATCHED].mean())


def jitter(xy: np.ndarray, points=JITTER_POINTS) -> float:
    return float(np.nanmean(np.linalg.norm(np.diff(xy[:, points], axis=0), axis=2)))


def summarize(path: Path) -> None:
    data = np.load(path)
    print(f"\n{path.name}\n")
    head = (
        f"{'model':<20}{'ms avg':>7}{'p95':>7}{'fps':>6}"
        f"{'jitter raw':>12}{'filtered':>10}{'flips raw':>11}{'stabilized':>12}"
        f"{'hidden(move)':>14}{'hands-hidden seen':>19}"
    )
    print(head)
    print("-" * len(head))
    for name in [str(n) for n in data["names"]]:
        t = data[f"{name}__t"]
        phase = data[f"{name}__phase"]
        xy = data[f"{name}__xy"]
        score = data[f"{name}__score"]
        ms = data[f"{name}__ms"]
        thr = threshold(name)
        scale = np.linalg.norm(xy[:, 1] - xy[:, 2], axis=1)  # shoulder width px
        filtered = one_euro(xy, t, scale)

        still, move, hidden = phase == "still", phase == "move", phase == "hidden"
        fps = still.sum() / max((t[still][-1] - t[still][0]) / 1000, 1e-3)
        raw_mask = score >= thr
        stab_mask = stabilized_shown(score, t, thr)
        seen_hidden = raw_mask[hidden][:, WRISTS].mean() * 100

        cpu = " (CPU)" if name == "mediapipe" else ""
        print(
            f"{name + cpu:<20}{ms.mean():>7.1f}{np.percentile(ms, 95):>7.1f}{fps:>6.1f}"
            f"{jitter(xy[still]):>12.2f}{jitter(filtered[still]):>10.2f}"
            f"{flips(raw_mask[move]):>11.1f}{flips(stab_mask[move]):>12.1f}"
            f"{(1 - raw_mask[move][:, WATCHED].mean()) * 100:>13.0f}%{seen_hidden:>18.0f}%"
        )

        tips = data[f"{name}__tips"]
        if not np.isnan(tips).all():
            tip_scale = scale[:, None]
            ft = one_euro(tips, t, tip_scale[:, 0])
            print(
                f"{'  index fingertips':<20}{'':>20}"
                f"{jitter(tips[still], [0, 1]):>12.2f}{jitter(ft[still], [0, 1]):>10.2f}"
            )

    print(
        "\njitter: mean frame-to-frame movement while standing still (px, lower = steadier)"
        "\nflips: show/hide changes per elbow/wrist/hip while moving (lower = less flicker)"
        "\nhands-hidden seen: % of frames a wrist was reported visible while hidden behind the back"
        " (lower = more honest)"
    )


if __name__ == "__main__":
    summarize(Path(sys.argv[1]))
