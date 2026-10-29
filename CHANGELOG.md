# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

Phase 4 (Scenes), first part: the STAT WARS theme and EPISODE II–V as real, played scenes, plus a steadier cursor.

### Added

- STAT WARS theme in the department's pink: layered starfield and nebula, crawl attract, INCOMING TRANSMISSION captions, laser-fill buttons, Bai Jamjuree + Orbitron with fixed-width digits (#45) — research 016
- EPISODE II ศึกราคากาแฟ (Regression): set the price with a raised hand, the AI's line retries until SSE falls, revenue curve (#46) — research 017
- EPISODE III สามกลุ่มแห่งลูกค้า (K-means): drop magnets by holding still, the AI's blind start and rounds, Elbow (Kneedle) k = 3, choose the ad group on the map (#47) — research 018
- Gestures: slap (a fast cursor sweep) and draw (pen = cursor), both also with the mouse (#48) — research 019
- EPISODE IV จับโกงข้ามกาแล็กซี (Anomaly Detection): slash fraud with a laser, a 1,000,000-transaction storm scored for real in the browser, set the outlier ring with your hand against a U-shaped damage curve (#49) — research 020
- EPISODE V พยากรณ์ 11.11 (Forecasting): draw the next 12 months, the AI builds trend → folded seasons → trend × season with a band, the real year draws in, then order 11.11 stock and run the sale day (#50) — research 021
- Cursor precision for held hands (PRISM-style gain, gap ≤ 60 px, off while drawing) and a replay "cursor lab" for measuring cursor changes (#51) — research 022

### Changed

- Cursor: screen-space 2D One Euro + deadband, drawn at 60 fps (#44) — research 015 · with precision: shake 6.3 → 1.05 px, held-still spread 13.6 → 9.4 px, same selects
- Full-visit E2E: only EPISODE III's ad choice is still a dwell button; the other chapters are played with raise / slap / draw (fraud.spec, forecast.spec)
- Only chapter A remains a placeholder scene

## [0.3.0] — 2026-10-29

Phase 3 (Core Experience): the whole visit is playable — attract → welcome → 5 placeholder chapters → CEO report → attract — driven by the body through the real gesture engine.

### Added

- Design system: self-hosted Anuphan + JetBrains Mono, vh-based tokens, HUD panels with corner brackets, dwell buttons that fill as you hold (`?styleguide`) — research 011
- Renderer: Three.js stage (scrolling grid with scan pulse, dust, horizon glow), SMAA + bloom + vignette + noise, adaptive resolution, 1440p internal cap (`?maxh`), context-loss handling — research 012
- Story: `content/story.th.yaml` validated by a zod schema in CI (every `{var}` must have a provider, lines fit one caption line); template engine with Thai number formatting, `**bold**`, `when` conditions and cues
- App state machine (XState): pause when the player is lost, resume where they were, 8 s timeout, new person = new visit, F5 reset
- Narrative engine: grapheme-aware typewriter, hints, tutorial wait, play countdown, skip to checkpoints, blocking cues; time-outs wait while the player is mid-selection
- HUD: narrator caption, chapter progress, profit count-up, header, countdown ring, skip, mini skeleton, pause/reconnect notice
- Scenes: data-globe attract, scan-ring welcome with the pointing tutorial, five placeholder chapters with choices, CEO report (profit, style, daily rank, QR placeholder); additive crossfades
- Scoring: profit model (every player earns ฿560k–1.4M), CEO style, codenames, daily leaderboard
- Watchdog: errors → attract, repeated errors / silent perception / heap growth → reload
- E2E: Playwright with a synthetic body (`?player=synthetic`) — full visit, pause/resume, walk-away, F5 — required in CI — research 013, 014

### Changed

- The visitor experience is the default route; the old debug view moved to `?debug`
- HUD panels no longer use `backdrop-filter` (halved the frame rate over WebGL)

### Fixed

- A button appearing under a still-raised hand no longer selects itself; it must be entered first
- Choice target ids are unique per set (a reused id inherited the previous select's cooldown)

### Known limitations

- Chapters are placeholders; real scenes and gestures (raise, throw, slap, draw) come in Phase 4, with the tutorial ghost
- Not yet played by a real person in front of the camera with the new UI
- 4K performance must be measured on the kiosk (headless numbers are compositor-bound)

## [0.2.0] — 2026-10-29

Phase 2 (Gesture & Input) as a milestone: the player controls the screen with their body — point and hold to select.

### Added

- RTMPose-x perception service (`perception-server/`, Python, TensorRT FP16 + YOLOX-m): 30 fps, 7.2 ms avg; WebSocket to the app, local origins only; MediaPipe stays as an automatic in-browser fallback (ADR-0007)
- PlayerLock: one player, duplicates and "ghost" fits merged, robust body scale when turning
- Landmark stabilizer: visibility smoothing + hysteresis + brief holds (arm/hip flicker 76 → ≤ 6 per clip)
- Body-space normalizer (shoulder-width units)
- Intent bus, target registry, mouse/keyboard adapter (F2)
- Cursor gesture: straight-arm rule, per-pose-source calibration, side interaction zone, keep while raised
- Dwell-to-select (1.2 s), `?playground` with attempt log and session recording (F9)
- Guided pose recorder (`?record`) and replay test harness; 3 recorded sessions (MediaPipe, RTMPose, playground)
- Research log `docs/research/` (001–010)

### Changed

- Primary pose model: MediaPipe heavy → RTMPose-x (spike: jitter 8.87 → 1.45 px after filtering)

### Known limitations

- Dwell success 23/29 (79%) for one adult on a laptop screen; remaining failures are cursor drift with the side zone
- Raising both arms looks like pointing; scenes must disable the cursor while that gesture is active
- Gestures other than point/dwell (raise, throw, slap, draw, swipe) move to Phase 4
- All measurements: one adult, built-in 720p30 webcam

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

[0.2.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.2.0
[0.1.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.1.0
