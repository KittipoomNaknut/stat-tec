"""
Spike: MediaPipe Pose (heavy) vs RTMPose / RTMW on the same live webcam frames.

Runs every model on each captured frame, shows them side by side, and records keypoints
(never images) for the common body landmarks. Phases: 10 s standing still, then 20 s moving.

    uv run compare_live.py [--camera 0] [--models mediapipe,rtmpose:balanced,rtmw:performance]

Writes results/<timestamp>.npz and prints a summary. Press q to stop early.
"""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
MP_MODEL = HERE.parents[1] / "app" / "public" / "models" / "pose_landmarker_heavy.task"

# Common landmarks: nose, shoulders, elbows, wrists, hips (L, R)
COMMON = ["nose", "l_shoulder", "r_shoulder", "l_elbow", "r_elbow", "l_wrist", "r_wrist", "l_hip", "r_hip"]
MP_INDEX = [0, 11, 12, 13, 14, 15, 16, 23, 24]
COCO_INDEX = [0, 5, 6, 7, 8, 9, 10, 11, 12]  # RTMPose (COCO-17) and RTMW (COCO-WholeBody body part)
BONES = [(1, 2), (1, 3), (3, 5), (2, 4), (4, 6), (1, 7), (2, 8), (7, 8)]

STILL_S = 10
MOVE_S = 20


@dataclass
class Track:
    name: str
    xy: list[np.ndarray] = field(default_factory=list)  # (9, 2) px, NaN when no person
    score: list[np.ndarray] = field(default_factory=list)  # (9,)
    ms: list[float] = field(default_factory=list)


class MediaPipeModel:
    name = "mediapipe"

    def __init__(self) -> None:
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

        self._mp = __import__("mediapipe")
        opts = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MP_MODEL)),
            running_mode=RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = PoseLandmarker.create_from_options(opts)
        self._last_ms = -1

    def __call__(self, frame: np.ndarray, t_ms: int) -> tuple[np.ndarray, np.ndarray]:
        h, w = frame.shape[:2]
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        # VIDEO mode needs strictly increasing timestamps (warm-up reuses 0).
        self._last_ms = max(t_ms, self._last_ms + 1)
        result = self._landmarker.detect_for_video(image, self._last_ms)
        if not result.pose_landmarks:
            return np.full((9, 2), np.nan), np.zeros(9)
        lm = result.pose_landmarks[0]
        xy = np.array([[lm[i].x * w, lm[i].y * h] for i in MP_INDEX])
        score = np.array([lm[i].visibility for i in MP_INDEX])
        return xy, score


class RtmModel:
    """`rtmpose:<mode>` (COCO-17 body) or `rtmw:<mode>` (COCO-WholeBody 133), mode = performance|balanced|lightweight."""

    def __init__(self, name: str) -> None:
        import onnxruntime
        from rtmlib import Body, PoseTracker, Wholebody

        # Load CUDA/cuDNN from the nvidia-* wheels; without this ORT silently falls back to CPU.
        onnxruntime.preload_dlls()
        self.name = name
        family, _, mode = name.partition(":")
        solution = Wholebody if family == "rtmw" else Body
        # Person detection every 7th frame; keypoints every frame from the tracked box (as in production).
        self._model = PoseTracker(
            solution, det_frequency=7, tracking=False, mode=mode or "performance",
            backend="onnxruntime", device="cuda",
        )

    def __call__(self, frame: np.ndarray, _t_ms: int) -> tuple[np.ndarray, np.ndarray]:
        keypoints, scores = self._model(frame)
        if len(keypoints) == 0:
            return np.full((9, 2), np.nan), np.zeros(9)
        # The person with the largest body-keypoint box — the player standing in front.
        areas = [np.ptp(k[:17, 0]) * np.ptp(k[:17, 1]) for k in keypoints]
        p = int(np.argmax(areas))
        return keypoints[p][COCO_INDEX].astype(float), scores[p][COCO_INDEX].astype(float)


def draw(frame: np.ndarray, xy: np.ndarray, score: np.ndarray, label: str, ms: float, threshold: float) -> np.ndarray:
    out = cv2.flip(frame, 1)
    w = out.shape[1]
    pts = [(int(w - x), int(y)) if not np.isnan(x) else None for x, y in xy]
    for a, b in BONES:
        if pts[a] and pts[b] and score[a] >= threshold and score[b] >= threshold:
            cv2.line(out, pts[a], pts[b], (255, 224, 63), 4, cv2.LINE_AA)
    for p, s in zip(pts, score, strict=True):
        if p and s >= threshold:
            cv2.circle(out, p, 6, (255, 224, 63), -1, cv2.LINE_AA)
    cv2.putText(out, f"{label}  {ms:.1f} ms", (12, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--models", default="mediapipe,rtmpose:performance,rtmw:performance")
    args = parser.parse_args()

    names = args.models.split(",")
    models = [MediaPipeModel() if n == "mediapipe" else RtmModel(n) for n in names]
    # Each family's score means something different; these are the usual "keypoint is there" cut-offs.
    thresholds = {"mediapipe": 0.5}
    tracks = [Track(m.name) for m in models]

    cap = cv2.VideoCapture(args.camera, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cap.set(cv2.CAP_PROP_FPS, 30)
    if not cap.isOpened():
        raise SystemExit("Cannot open camera — close the browser tab using it first.")

    print("Warming up models…")
    ok, frame = cap.read()
    for m in models:
        for _ in range(3):
            m(frame, 0)

    phases: list[str] = []
    start = time.monotonic()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        elapsed = time.monotonic() - start
        if elapsed > STILL_S + MOVE_S:
            break
        phase = "still" if elapsed < STILL_S else "move"
        phases.append(phase)
        t_ms = int(elapsed * 1000)

        panels = []
        for m, tr in zip(models, tracks, strict=True):
            t0 = time.perf_counter()
            xy, score = m(frame, t_ms)
            ms = (time.perf_counter() - t0) * 1000
            tr.xy.append(xy)
            tr.score.append(score)
            tr.ms.append(ms)
            panels.append(cv2.resize(draw(frame, xy, score, m.name, ms, thresholds.get(m.name, 0.3)), (640, 360)))

        view = np.hstack(panels)
        if phase == "still":
            msg = f"STAND STILL  {STILL_S - elapsed:4.1f}s  (arms relaxed, ~2 m away, full body in view)"
        else:
            msg = f"MOVE: point around, raise arms, turn a bit  {STILL_S + MOVE_S - elapsed:4.1f}s"
        cv2.putText(view, msg, (12, view.shape[0] - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (80, 220, 255), 2, cv2.LINE_AA)
        cv2.imshow("pose model spike — q to quit", view)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()

    results = HERE / "results"
    results.mkdir(exist_ok=True)
    out = results / f"{time.strftime('%Y%m%d-%H%M%S')}.npz"
    np.savez_compressed(
        out,
        phases=np.array(phases),
        names=np.array([t.name for t in tracks]),
        **{f"{t.name}__xy": np.array(t.xy) for t in tracks},
        **{f"{t.name}__score": np.array(t.score) for t in tracks},
        **{f"{t.name}__ms": np.array(t.ms) for t in tracks},
    )
    print(f"Saved {out}")
    from analyze import summarize

    summarize(out)


if __name__ == "__main__":
    main()
