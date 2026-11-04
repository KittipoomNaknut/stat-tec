# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/)

## [Unreleased]

### Added

- `--zone left,right` for the pose service. People centered outside that band of the image are never posed, so a queue or passers-by cost no time and cannot take over the player. The player-cam dims outside the zone and edges it in pink (research 031).
- `--fourcc` for the pose service. The Xbox 360 Kinect has no MJPG and needs `--camera 2 --fourcc GRBG --width 640 --height 480`, which gives 30 fps color.
- A new `hands` intent (`HandsDetector`): raised hands as a joystick (turn, tilt, spread). The synthetic player can hold both wrists (`hands()`).

### Changed

- The visit is two chapters: ราคาเดียว (Regression) → ศึก 11.11 (Dynamic pricing). EP II คู่แข่งบุก (K-means) is removed. A visit is about 2.6 minutes, down from 3.2 (research 028).
- Setting the price with your hand lasts 15 s (was 20). The hints come at 5 and 10 s.
- Profit bases are ฿650k (coffee) and ฿750k (slash). The best and worst totals stay ฿1.4M and ฿560k.
- The booth log shows the slash chapter as EP II.
- EP II ends with a 3D profit surface (hour × price → profit) that you turn and zoom with your hands for 15 s. Move a raised hand sideways to turn it, raise it to tilt, and spread both hands to zoom. The gold ridge is the AI's price each hour. Pose still holds 30 fps (research 030).
- Every player is called CEO STAT, set in `codename:` in the story file. The random codenames (such as "เหยี่ยวหัวไว #79") are gone.
- The regression reveal is faster: all 13 days fly from the table onto the chart together, and the line search and revenue curve are quicker. From the first point to the end of EP I takes 13 s (was 23 s) (research 029).

### Fixed

- The game stuttered while slashing price tags. Every tag's canvas glow (`shadowBlur`) kept the GPU at 100%, which dropped the pose model to 11 fps. The glow is now drawn once per color and stamped. Pose holds 30 fps during play (research 029).

## [0.4.1] — 2026-11-03

The cursor fixed at the source, confirmed live: the camera now runs at 30 fps (it was 10–16), and the cursor no longer stays grey until the arm swings out. Also a staff guide, and the scenes that left the story are removed.

### Fixed

- **Grey cursor that wouldn't press, and a cursor that lagged the hand** (research 027).
  - The webcam was allowed to drop to 10–16 fps in dim light. The pose service now holds the frame rate (`exposure_auto_priority` off).
  - The person detector now runs on every frame with YOLOX-tiny: about 9 ms a frame, steady. Before, YOLOX-m ran every 7th frame and fast arms slipped out of the crop box.
  - A raised hand out to the side now counts as pointing without a fully stretched arm, the way Kinect engages a hand. Fidgeting still never activates it.
  - A grey cursor in EP III shows "กางแขนออกข้างตัว แล้วชี้".
- The playground also saves with **S** (F9 needs Fn on many laptops; the owner's recording never downloaded), and confirms on screen.
- Confirmed on the booth laptop: the camera at 30.3–30.5 fps with "frame rate held in dim light" in `perception.log`, and the owner's verdict "ใช้ได้แล้ว".

### Added

- `docs/STAFF_GUIDE.md`: a one-page booth guide for non-developers covering setup, start and stop, what each red problem means, and privacy answers.

### Removed

- Old scenes that left the story with Price Wars: chapter A (placeholder), EPISODE III segments, IV fraud and V forecast, plus the unused title-screen globe. EP II keeps their customer data and K-means (moved to `scenes/rival/segments.ts`; the elbow chart went). The build is 58 KB smaller in JS (−4.6%) and 10 KB in CSS (−21%).

### Changed

- Chapters come from a scene registry (`scenes/registry.ts`), and a unit test checks that every chapter in the story has a real scene. A missing scene used to fall back to a placeholder without a word.

## [0.4.0] — 2026-11-03

Phase 4 (Scenes), first release: **Price Wars**. One visit is three pricing battles told in about 3.2 minutes. The player answers with poses and sees themselves on screen. The booth now starts with one command, and a live log shows problems as they happen.

### Added

- **Price Wars story** (#53, research 023): three chapters about pricing, one visit ≤ 5 minutes.
  - EP I ราคาเดียว (Regression): set the coffee price with a raised hand.
  - EP II คู่แข่งบุก (Clustering): Empire Coffee opens at ฿49. K-means finds 3 customer groups, and you choose to cut prices for everyone, for one group, or for no one.
  - EP III ศึก 11.11 (Dynamic pricing): slash gold price tags (profitable and selling at that moment) while demand rushes. Then watch the AI's price through the day beat a flat price by 18%.
  - Each visit carries the chosen price from EP I into EP II.
- **Pose answers** (#55, research 025): five held poses answer the questions instead of pointing.
  - The poses are both hands up, left up, right up, T-pose and crossed arms.
  - Stick-figure cards fill up while the pose is held, and a hold of 0.7 s selects.
  - Every question times out on its own.
  - The script went from 52 lines to 33.
- **Player-cam** (#54, #56, #58): a mirrored camera picture with the tracked skeleton.
  - It sits in the top-right corner during the game and on the title screen, so passers-by see themselves.
  - Previews run at 24 fps and are never stored.
- **`scripts/demo.sh start | stop | status | log`** (#57, research 026).
  - `start` builds the game only when code changed, then starts the pose service, serves the build and opens a Chrome kiosk. Closing Chrome stops everything.
- **Live booth log** (#57, research 026).
  - The pose service watches its health: camera, fps, inference time, GPU and CPU temperature, charger, and the game's fps.
  - Problems are debounced: one line when one opens and one when it resolves.
  - The game reports visits, chapters, pose answers or timeouts, walk-offs and errors.
  - `stat-tec-log` shows open problems in a red box with what to do.
  - Logs hold names and numbers only.
- STAT WARS theme in the department's pink: layered starfield and nebula, crawl attract, INCOMING TRANSMISSION captions, laser-fill buttons, Bai Jamjuree + Orbitron with fixed-width digits (#45, research 016).
- Gestures: slap (a fast cursor sweep) and draw (pen = cursor), both also with the mouse (#48, research 019).
- Scenes built before Price Wars (#46, #47, #49, #50, research 017, 018, 020, 021): coffee pricing, K-means customer groups, fraud slashing and 11.11 forecasting. Coffee became EP I, and K-means lives on in EP II. Fraud and forecast stay in the code but are not part of the story.
- Cursor precision for held hands and a replay "cursor lab" for measuring cursor changes (#51, research 022).

### Changed

- **The cursor is always on while the player is tracked** (#54, research 024).
  - It follows the pointing hand, or the higher hand when none points. It is drawn faint and cannot select until the hand points.
  - When the wrist is briefly unseen, it holds its last position.
  - Compared with v0.3.0's cursor on recorded sessions:
    - The cursor is on screen 95% and 75% of tracked time (was 75% and 57%).
    - It sits 28 and 25 px from the hand (was 37 and 33 px).
    - Lag is 27% lower and selects are unchanged. Shake rose to 1.5–1.7 px.
- Cursor: screen-space 2D One Euro filter + deadband, drawn at 60 fps (#44, research 015).
- The visit is coffee → rival → slash (was five chapters A → V). Profit bases are ฿420k, ฿450k and ฿530k.
- E2E: the full visit is played with poses, and slash.spec plays EP III. The fraud and forecast specs were removed with those chapters (#53, #55).

### Fixed

- A pose held before its prompt appears still selects (#55).
- The pose service now stops cleanly on SIGTERM and logs `service-stop` (#58).
- E2E: a chosen pose card that is still fading out is no longer counted twice (#56).

### Known limitations

- Played live by the project owner only; the playtest with ≥ 3 other people (Phase 4 DoD) is still to do. The 0.7 s hold, pose detection for short children and the slash difficulty are not yet tuned on real visitors (step 4: tune from the booth log).
- Chapter A and the CEO report (4.3, 4.8) are unchanged from v0.3.0 apart from the theme; the QR still needs the course URL.
- The old scene code (A, segments, fraud, forecast) is kept but unused.
- `demo.sh` is not yet started by systemd at boot (6.3).
- Camera: the laptop's 720p30 webcam; a dark room drops it to ~17 fps.

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

[Unreleased]: https://github.com/KittipoomNaknut/stat-tec/compare/v0.4.1...develop
[0.4.1]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.4.1
[0.4.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.4.0
[0.3.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.3.0
[0.2.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.2.0
[0.1.0]: https://github.com/KittipoomNaknut/stat-tec/releases/tag/v0.1.0
