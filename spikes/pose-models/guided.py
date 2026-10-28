"""
Fair comparison: each model runs **alone** at full camera rate, with on-screen guidance.

For every model: stand still (jitter) → move (flicker) → hands hidden behind the back
(does the model admit it cannot see them?). Keypoints only are saved, never images.

    uv run guided.py [--models mediapipe,rtmpose:performance,rtmw:performance]

Writes results/guided-<timestamp>.npz and prints the analysis (analyze_guided.py).
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import cv2
import numpy as np

from compare_live import BONES, MediaPipeModel, RtmModel

HERE = Path(__file__).resolve().parent
PHASES = [
    ("still", 8, "STAND STILL - arms relaxed"),
    ("move", 12, "MOVE - point around, raise arms, turn a little"),
    ("hidden", 6, "HIDE BOTH HANDS BEHIND YOUR BACK"),
]
COUNTDOWN_S = 3
# COCO-WholeBody index fingertips (left hand 91-111, right hand 112-132; tip = base + 8)
RTMW_FINGERTIPS = [99, 120]


class RtmwWithFingers(RtmModel):
    """RTMW that also returns both index fingertips (for cursor precision)."""

    def full(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        keypoints, scores = self._model(frame)
        if len(keypoints) == 0:
            nan = np.full((9, 2), np.nan)
            return nan, np.zeros(9), np.full((2, 2), np.nan), np.zeros(2)
        areas = [np.ptp(k[:17, 0]) * np.ptp(k[:17, 1]) for k in keypoints]
        p = int(np.argmax(areas))
        from compare_live import COCO_INDEX

        return (
            keypoints[p][COCO_INDEX].astype(float),
            scores[p][COCO_INDEX].astype(float),
            keypoints[p][RTMW_FINGERTIPS].astype(float),
            scores[p][RTMW_FINGERTIPS].astype(float),
        )


def banner(frame: np.ndarray, lines: list[str], color=(80, 220, 255)) -> np.ndarray:
    out = frame.copy()
    cv2.rectangle(out, (0, out.shape[0] - 40 - 48 * len(lines)), (out.shape[1], out.shape[0]), (20, 12, 5), -1)
    for i, text in enumerate(lines):
        y = out.shape[0] - 24 - 48 * (len(lines) - 1 - i)
        cv2.putText(out, text, (24, y), cv2.FONT_HERSHEY_SIMPLEX, 1.2, color, 3, cv2.LINE_AA)
    return out


def skeleton(frame: np.ndarray, xy: np.ndarray, score: np.ndarray, threshold: float) -> np.ndarray:
    out = cv2.flip(frame, 1)
    w = out.shape[1]
    pts = [(int(w - x), int(y)) if not np.isnan(x) else None for x, y in xy]
    for a, b in BONES:
        if pts[a] and pts[b] and score[a] >= threshold and score[b] >= threshold:
            cv2.line(out, pts[a], pts[b], (255, 224, 63), 5, cv2.LINE_AA)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--models", default="mediapipe,rtmpose:performance,rtmw:performance")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    if not cap.isOpened():
        raise SystemExit("Cannot open camera — close the browser tab using it first.")
    window = "pose model benchmark - q to quit"

    saved: dict[str, np.ndarray] = {}
    names = args.models.split(",")
    for n, name in enumerate(names, 1):
        ok, frame = cap.read()
        cv2.imshow(window, banner(cv2.flip(frame, 1), [f"Loading model {n}/{len(names)}: {name} ..."]))
        cv2.waitKey(1)
        if name == "mediapipe":
            model = MediaPipeModel()
        elif name.startswith("rtmw"):
            model = RtmwWithFingers(name)
        else:
            model = RtmModel(name)
        for _ in range(5):
            ok, frame = cap.read()
            model(frame, 0)
        threshold = 0.5 if name == "mediapipe" else 0.3

        rows = {k: [] for k in ("t", "phase", "xy", "score", "ms", "tips", "tip_score")}
        start = None
        schedule = []
        t_acc = 0.0
        for phase, seconds, text in PHASES:
            schedule.append((t_acc, t_acc + COUNTDOWN_S, None, f"Next: {text}"))
            t_acc += COUNTDOWN_S
            schedule.append((t_acc, t_acc + seconds, phase, text))
            t_acc += seconds

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            now = time.monotonic()
            start = start or now
            elapsed = now - start
            current = next((s for s in schedule if s[0] <= elapsed < s[1]), None)
            if current is None:
                break
            _, end, phase, text = current

            t0 = time.perf_counter()
            if isinstance(model, RtmwWithFingers):
                xy, score, tips, tip_score = model.full(frame)
            else:
                xy, score = model(frame, int(elapsed * 1000))
                tips, tip_score = np.full((2, 2), np.nan), np.zeros(2)
            ms = (time.perf_counter() - t0) * 1000

            if phase:
                rows["t"].append(elapsed * 1000)
                rows["phase"].append(phase)
                rows["xy"].append(xy)
                rows["score"].append(score)
                rows["ms"].append(ms)
                rows["tips"].append(tips)
                rows["tip_score"].append(tip_score)

            label = f"{name} ({n}/{len(names)})"
            lines = [label, f"{text}   {end - elapsed:4.1f}s"]
            color = (80, 220, 255) if phase else (180, 180, 180)
            cv2.imshow(window, banner(skeleton(frame, xy, score, threshold), lines, color))
            if cv2.waitKey(1) & 0xFF == ord("q"):
                raise SystemExit("Stopped.")

        for key, values in rows.items():
            saved[f"{name}__{key}"] = np.array(values)
        del model

    cap.release()
    cv2.destroyAllWindows()
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    out = results / f"guided-{time.strftime('%Y%m%d-%H%M%S')}.npz"
    np.savez_compressed(out, names=np.array(names), **saved)
    print(f"Saved {out}")
    from analyze_guided import summarize

    summarize(out)


if __name__ == "__main__":
    main()
