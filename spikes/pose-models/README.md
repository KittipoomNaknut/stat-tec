# Spike: pose model comparison

Is a heavier model worth it over MediaPipe Pose heavy? Compares, **on the same live webcam
frames**, MediaPipe Pose Landmarker (heavy) against RTMPose (COCO-17) and RTMW (whole body,
133 keypoints incl. fingers) from OpenMMLab via [rtmlib](https://github.com/Tau-J/rtmlib),
running on the GPU with ONNX Runtime (CUDA).

Not part of the app. Records **keypoints only — never images** (`results/*.npz`).

```bash
# Close any browser tab using the camera first
cd spikes/pose-models
uv sync
uv run compare_live.py                       # mediapipe, rtmpose:performance, rtmw:performance
uv run compare_live.py --models mediapipe,rtmpose:balanced,rtmw:balanced
uv run analyze.py results/<file>.npz         # re-print a summary
```

Phases: 10 s standing still (jitter), 20 s moving (flicker, coverage).

### Fair run (recommended): `guided.py`

Each model runs **alone at full camera rate**, with on-screen guidance: stand still 8 s →
move 12 s → hide both hands behind your back 6 s. The analysis applies the app's own One Euro
filter and visibility stabilizer (same parameters) and reports raw vs filtered jitter, flicker,
and how honestly each model reports hands it cannot see. RTMW also reports index fingertips.

```bash
uv run guided.py
uv run analyze_guided.py results/guided-<timestamp>.npz
```

MediaPipe's Python package has no GPU delegate on Linux, so its timing here is CPU; use the
browser benchmark (`/?bench`, ~17 ms on GPU) for MediaPipe speed.

### GPU setup (`gpu.py`) — measured, RTX 4060 Laptop

| Part | CUDA | TensorRT FP16 |
|---|---|---|
| RTMPose-x pose | 11.5 ms | **3.9 ms** |
| RTMW-x pose | 10.8 ms | **4.5 ms** |
| YOLOX-m detector | 22.2 ms | fails (in-graph NMS, TopK > 3840) |
| YOLOX-x detector | 51.8 ms | fails |

So: pose on TensorRT, detector YOLOX-m on CUDA every 7th frame → live loop 30.4 fps,
8.2 ms avg / 29.7 ms p95 / 31 ms max. FP16 vs FP32 keypoints differ by 0.55 px mean (small
sample; `guided.py` re-checks it). The first TensorRT run builds engines into
`results/trt-cache/` (takes a minute).

Camera must be opened as MJPEG: uncompressed YUYV at 720p only delivers 10 fps.

Caveat: every model processes every captured frame in turn, so all of them see the same
(lower) frame rate. Fair for comparing accuracy and stability, not for absolute fps.

## Result (2026-10-28) → decision: RTMPose-x (ADR-0007)

`guided.py`, each model alone at the camera's 30 fps (built-in 720p webcam), owner standing ~2 m:

| model | ms avg / p95 | fps | jitter raw → filtered (px) | flips raw → stabilized | hidden while moving | wrists "seen" while hidden |
|---|---|---|---|---|---|---|
| MediaPipe heavy (CPU here) | 35.9 / 39.6 | 21.0 | 10.09 → 8.87 | 3.8 → 1.3 | 36% | 0% |
| **RTMPose-x** (TRT FP16) | **7.5 / 25.3** | 30.6 | 4.29 → **1.45** | 8.7 → **0.0** | **3%** | 100% |
| RTMW-x (TRT FP16) | 7.7 / 25.5 | 30.6 | 5.09 → 1.29 | 0.0 → 0.0 | 0% | 100% |

- FP16 vs FP32 keypoints: RTMPose 0.69 px mean / 3.7 px max (104 frames); RTMW 0.57 / 8.1 (107 frames)
- RTMW index fingertips: 59 → 28.5 px jitter — not usable for pointing at 2 m with a 720p camera
- Owner's visual judgement: RTMPose and RTMW clearly better than MediaPipe; chose RTMPose-x
- Caveats: RTM models never admit a hidden wrist (100% "seen" behind the back); the app's
  stabilizer is still needed (raw flips 8.7 → 0)
