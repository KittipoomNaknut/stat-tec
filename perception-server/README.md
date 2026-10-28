# STAT_TEC perception service

Camera → **RTMPose-x** (TensorRT FP16) + YOLOX-m person detector (CUDA, every 7th frame) →
WebSocket `ws://127.0.0.1:8765`. Decision and evidence: [ADR-0007](../docs/adr/0007-perception-service-rtmpose.md).

Sends **raw detections only** (up to 3 people, mapped to the app's 33-landmark layout). The app
does player lock, smoothing and gestures. Camera images never leave the machine; a small JPEG
preview is sent only to a local client that asks for it (debug overlay).

## Requirements

- Linux, NVIDIA GPU + driver (developed on RTX 4060 Laptop), CUDA 13 wheels are installed by uv
- USB webcam (V4L2). The camera can only be used by one program — close browser tabs using it.

## Run

```bash
cd perception-server
uv sync --extra gpu
uv run --extra gpu stat-tec-perception            # --camera 0 --port 8765 --det-every 7 --max-people 3
```

Always pass `--extra gpu` to `uv run`; without it uv syncs the CPU-only environment first.
The first start builds TensorRT engines into `~/.cache/stat-tec/trt` (about a minute).

## Measured (RTX 4060 Laptop, built-in 720p30 webcam)

| | |
|---|---|
| Frame rate | 30.7 fps (camera-bound), no dropped frames over 461 |
| Inference | 7.2 ms avg / 25.4 ms p95 (p95 = detector frames) |
| Frame read → client | 7.5 ms avg / 25.9 ms p95 |

## Protocol

See `src/stat_tec_perception/protocol.py`. Binary detections (`STD1`, 28-byte header +
float32 landmarks), binary preview (`STJ1` + JPEG), JSON text messages (`hello`, `status`
once per second, client `preview` toggle). Only pages from `localhost` / `127.0.0.1` may
connect (others get HTTP 403), so other websites in the same browser cannot read poses.

## Notes

- `onnxruntime` (CPU) is excluded in `pyproject.toml`: rtmlib depends on it and it installs into
  the same module as `onnxruntime-gpu`, silently removing the GPU providers.
- The estimator refuses to start if the pose model is not on TensorRT, instead of running slowly.
- TensorRT cannot build YOLOX's in-graph NMS, so the detector runs on CUDA.

## Develop

```bash
uv sync            # no GPU needed for tests
uv run pytest
uv run ruff check . && uv run ruff format --check .
```
