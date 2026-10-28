# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [0.1.0] — 2026-10-28

Phase 0 (Foundation) and Phase 1 (Perception spike). The camera sees a person, skeletons are drawn in real time, and the numbers are measured.

### Added
- Project docs: architecture, roadmap, story draft, contributing guide, ADR-0001 … 0006
- `app/`: Vite 8 + TypeScript 6 (strict), ESLint, Prettier, Vitest
- `data-pipeline/`: uv + Python 3.12, polars, numpy, scikit-learn, pytest, ruff; little-endian float32 export
- Docker: `web` (nginx), `dev` (Vite), `pipeline` services; containers run as uid 1000; ports bound to 127.0.0.1
- CI: app / pipeline / docker checks required on `main` and `develop`
- Camera module with auto-reconnect and label-based selection (`?camera=`)
- Pose inference in a module Web Worker with MediaPipe PoseLandmarker on the GPU; frames streamed via `MediaStreamTrackProcessor`
- Offline assets: WASM copied from node_modules, pose models downloaded and SHA-256 verified
- One Euro filter on the player's landmarks (speed in shoulder widths/s), ~87% less jitter when still
- Debug overlay (F1): skeletons, raw-vs-filtered (F3), camera, GPU, inference, jitter, latency, render stats
- Benchmark mode (`?bench`) comparing lite / full / heavy with charts and JSON export
- Phase 1 benchmark report (`docs/benchmarks/phase1.md`)

### Decided
- `heavy` pose model by default (ADR-0005)
- Chromium-only; Google Chrome .deb pinned on the kiosk (ADR-0006)

### Known limitations
- Measured with the laptop's built-in 720p30 webcam; re-measure with the target 1080p60 camera
- One person very close to the camera can be detected twice (fixed by PlayerLock in Phase 2)
- Worker crash recovery is not implemented yet (Phase 3 watchdog)

[0.1.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.1.0
