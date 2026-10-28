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

Caveat: every model processes every captured frame in turn, so all of them see the same
(lower) frame rate. Fair for comparing accuracy and stability, not for absolute fps.
