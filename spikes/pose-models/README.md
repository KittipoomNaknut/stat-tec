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

Caveat: every model processes every captured frame in turn, so all of them see the same
(lower) frame rate. Fair for comparing accuracy and stability, not for absolute fps.
