# Third-party notices

This project is proprietary (see [LICENSE](LICENSE)). The components below are
owned by their authors and used under their own licenses.

Keep this file up to date whenever an asset or runtime dependency is added — fonts and
sound effects in particular must have their license recorded here before they are used.

## Shipped with the app

| Component | Version | License | Used for |
|---|---|---|---|
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (`@mediapipe/tasks-vision`, incl. WASM runtime) | 1.1.1 | Apache-2.0 | Pose inference |
| MediaPipe Pose Landmarker models (`pose_landmarker_{lite,full,heavy}.task`, float16/1) | 1 | Apache-2.0 | Pose inference |

## Perception service (installed on the kiosk machine, not redistributed)

| Component | Version | License | Notes |
|---|---|---|---|
| [rtmlib](https://github.com/Tau-J/rtmlib) | 0.0.16 | Apache-2.0 | RTMPose/YOLOX inference wrapper |
| RTMPose-x body7 384×288 ONNX ([MMPose](https://github.com/open-mmlab/mmpose)) | 20230629 | Apache-2.0 (MMPose repository; weights carry no separate license) | Weights trained on Body7 (COCO, AI Challenger, CrowdPose, MPII, sub-JHMDB, Halpe, PoseTrack18) — some datasets restrict commercial use; this is a non-commercial open-house exhibit |
| YOLOX-m HumanArt ONNX (MMPose) | c2c7a14a | Apache-2.0 (MMPose repository) | Person detector |
| [ONNX Runtime GPU](https://github.com/microsoft/onnxruntime) | 1.31.0 | MIT | |
| NVIDIA TensorRT (`tensorrt-cu13`) | 10.16.1.11 | NVIDIA proprietary (TensorRT SLA) | Installed from PyPI on the machine; never committed or redistributed |
| NVIDIA CUDA / cuDNN runtime wheels | 13.x / 9.x | NVIDIA proprietary | Same as above |
| [OpenCV](https://github.com/opencv/opencv) (`opencv-python`) | 5.0.0.93 | Apache-2.0 | Camera capture |
| [websockets](https://github.com/python-websockets/websockets) | — | BSD-3-Clause | Version pinned when the service is added |

## Data pipeline (Docker image / offline tooling)

| Component | Version | License |
|---|---|---|
| [Polars](https://github.com/pola-rs/polars) | 2.1.0 | MIT |
| [NumPy](https://github.com/numpy/numpy) | 2.5.4 | BSD-3-Clause (and bundled MIT / Zlib / 0BSD / CC0-1.0 parts) |
| [scikit-learn](https://github.com/scikit-learn/scikit-learn) | 1.9.1 | BSD-3-Clause |

## Development only (not distributed)

Vite, TypeScript, ESLint, typescript-eslint, Prettier, Vitest, pytest, Ruff, uv — used to build and test; their licenses apply to those tools only.

## Pending (add before use)

- Fonts: Anuphan, JetBrains Mono (both SIL Open Font License 1.1 — verify the exact files when self-hosting)
- Sound effects (Phase 5)
- Any real-world dataset for scenes B / G / I (Phase 4+)
