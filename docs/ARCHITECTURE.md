# STAT_TEC — Architecture

> Gesture-controlled data storytelling kiosk สำหรับงาน Open House สาขา Data Science
> ผู้เล่น 1 คนยืนหน้าจอใหญ่ ควบคุมกราฟและฉากธุรกิจด้วยร่างกาย (ไม่มีเมาส์/คีย์บอร์ด)

สถานะเอกสาร: **Draft v0.2** (อัปเดตหลัง Phase 1) — แก้ไขผ่าน PR เท่านั้น การตัดสินใจสำคัญบันทึกใน [`docs/adr/`](adr/)

---

## สารบัญ

1. [เป้าหมายและตัวชี้วัด](#1-เป้าหมายและตัวชี้วัด)
2. [ภาพรวมระบบ](#2-ภาพรวมระบบ)
3. [Tech Stack](#3-tech-stack)
4. [โครงสร้าง Repository](#4-โครงสร้าง-repository)
5. [เลเยอร์ทีละชั้น](#5-เลเยอร์ทีละชั้น)
6. [Data Contracts](#6-data-contracts)
7. [Gesture Catalogue](#7-gesture-catalogue)
8. [App State Machine](#8-app-state-machine)
9. [Narrative Engine](#9-narrative-engine)
10. [Scoring Model](#10-scoring-model)
11. [Rendering และ Design System](#11-rendering-และ-design-system)
12. [Audio](#12-audio)
13. [Data Pipeline](#13-data-pipeline)
14. [Robustness](#14-robustness)
15. [Testing Strategy](#15-testing-strategy)
16. [Deployment](#16-deployment)
17. [Privacy](#17-privacy)
18. [Risks และสิ่งที่ต้องพิสูจน์](#18-risks-และสิ่งที่ต้องพิสูจน์)

---

## 1. เป้าหมายและตัวชี้วัด

| เป้าหมาย | ตัวชี้วัด (ต้องวัดได้จริง) | วิธีวัด |
|---|---|---|
| **ลื่น** | Render ≥ 60 fps คงที่ (p95 frame time ≤ 16.7 ms) | Debug overlay + perf log |
| **แรง** | Pose inference ≥ 30 fps บนเครื่องเป้าหมาย | `inferenceMs` ใน `PoseFrame` |
| **แม่นยำ** | Motion-to-photon latency ≤ 100 ms (p95) | วัดด้วยกล้องความเร็วสูง/LED test (Phase 1) |
| **แม่นยำ** | Gesture false-trigger ≤ 1 ครั้ง / 5 นาทีเล่น | Pose replay test suite |
| **แม่นยำ** | Dwell-select สำเร็จ ≥ 95% ในครั้งแรก | Playtest กับคนจริง ≥ 10 คน |
| **สวย** | ผ่าน design review ทุกฉาก + ไม่มี jank ระหว่าง transition | Review checklist |
| **ทนทาน** | Soak test 8 ชม. ไม่ crash, memory ไม่โตเกิน 10% | Soak test (Phase 6) |

### Performance budget (ต่อเฟรม)

```
Capture (camera exposure + USB)     ~16–33 ms   ← เลือกกล้อง 60fps เพื่อลดตรงนี้
Inference (Worker, GPU)             ~15–25 ms   ← วิ่งขนานกับ render
Filter + Player Lock + Gesture        < 1 ms
Render (main thread)                ≤ 16.7 ms
Display (TV input lag)              ~10–30 ms   ← ตั้ง TV เป็น Game Mode
──────────────────────────────────────────────
เป้ารวม                              ≤ 100 ms
```

**เครื่องเป้าหมาย (dev + เครื่องหน้างาน):** Linux, NVIDIA RTX 4060 Laptop 8 GB
**กล้องที่แนะนำ:** USB webcam 1080p@60 มุมกว้าง (เช่น Logitech Brio / C922) — *ยังต้องจัดหา*

---

## 2. ภาพรวมระบบ

```
 ┌──────────────────── PERCEPTION SERVICE (Python, host, GPU) — ADR-0007 ─────┐
 │ USB camera (MJPEG) → YOLOX-m (CUDA, every 7th frame)                        │
 │                    → RTMPose-x (TensorRT FP16, every frame, ≤ 3 people)     │
 │                    → COCO-17 → 33-point layout, visibility = clamp(score)   │
 └──────────────────────────────────┬─────────────────────────────────────────┘
                                    │ WebSocket 127.0.0.1:8765 (binary, raw detections)
                       ┌────────────▼───────────────────────────────┐
                       │ PERCEPTION WORKER (Web Worker)             │
                       │  source: server (default)                  │
                       │       or MediaPipe heavy (fallback, GPU)   │
                       │  → PlayerLock (เลือก/ล็อกผู้เล่น 1 คน)       │
                       │  → Stabilizer + OneEuroFilter               │
                       │  → BodyNormalizer (หน่วย = ความกว้างไหล่)     │
                       └──────────────────┬─────────────────────────┘
                                          │ PoseFrame (postMessage)
 ┌────────────────────────────────────────▼──────────────────────────────┐
 │ MAIN THREAD                                                           │
 │                                                                       │
 │  GestureEngine ──┐                                                    │
 │  MouseAdapter ───┼──▶ IntentBus ──▶ AppStateMachine (XState)          │
 │  ReplayAdapter ──┘        │              │                            │
 │                           │              ▼                            │
 │                           │        NarrativeEngine ◀── story.th.yaml  │
 │                           │              │                            │
 │                           └────────▶ Active Scene ◀── data/*.bin      │
 │                                          │                            │
 │                     ┌────────────────────┼──────────────────┐         │
 │                     ▼                    ▼                  ▼         │
 │              Render (Three.js)     HUD (DOM overlay)    Audio (Howler) │
 └───────────────────────────────────────────────────────────────────────┘
```

### หลักการออกแบบ 5 ข้อ

1. **Perception แยก thread** — inference หนักแค่ไหน render ก็ไม่สะดุด ([ADR-0002](adr/0002-perception-in-worker.md))
2. **Scene ไม่รู้จักกล้อง** — Scene รับแค่ `Intent` จาก IntentBus ([ADR-0003](adr/0003-intent-bus.md))
3. **เนื้อหาแยกจากโค้ด** — บทพูดอยู่ใน YAML, ข้อมูลอยู่ใน `.bin` ที่ pipeline สร้าง
4. **ทุกอย่าง offline** — โมเดล, WASM, ฟอนต์, เสียง, ข้อมูล อยู่ในเครื่อง ไม่พึ่งอินเทอร์เน็ตหน้างาน
5. **ทดสอบได้โดยไม่ต้องมีคน** — อัดท่าเป็นไฟล์แล้ว replay ใน test ได้

---

## 3. Tech Stack

| หมวด | เลือกใช้ | เหตุผล |
|---|---|---|
| Runtime | Google Chrome .deb (kiosk mode, ล็อกเวอร์ชัน) | WebGL2/WebGPU, MediaPipe GPU delegate, MediaStreamTrackProcessor ([ADR-0006](adr/0006-kiosk-browser.md)) |
| Language | TypeScript (`strict: true`) | Data contract ชัด, refactor ปลอดภัย |
| Build | Vite | Dev เร็ว, รองรับ Worker เป็น module |
| Package manager | pnpm | เร็ว, lockfile เข้ม |
| Pose (หลัก) | Perception service: RTMPose-x + YOLOX-m ผ่าน rtmlib, ONNX Runtime GPU + TensorRT FP16 | นิ่งกว่า MediaPipe ~6 เท่า, 7.5 ms/เฟรม ([ADR-0007](adr/0007-perception-service-rtmpose.md)) |
| Pose (สำรอง) | `@mediapipe/tasks-vision` — PoseLandmarker heavy ในเบราว์เซอร์ | ใช้เมื่อ service ล่ม; ไม่ต้องติดตั้งอะไรเพิ่ม |
| 3D | Three.js (WebGL2) | Ecosystem ใหญ่, เสถียร |
| Post-processing | `postprocessing` (pmndrs) | Bloom/SMAA ประสิทธิภาพดีกว่า EffectComposer เดิม |
| Animation | GSAP | Timeline แม่นยำ, ease สวย |
| State machine | XState v5 | State ของแอปชัดเจน, visualize ได้, test ได้ |
| Validation | zod | ตรวจ `story.th.yaml` และ data manifest ตอน build |
| Audio | Howler.js | Sprite, fade, ducking |
| Lint/Format | ESLint + Prettier | มาตรฐาน |
| Unit test | Vitest | เร็ว, เข้ากับ Vite |
| E2E | Playwright + Chromium fake camera (`.y4m`) | ทดสอบทั้งระบบโดยไม่ต้องมีกล้อง |
| Data pipeline | Python 3.12 + uv + polars + numpy + scikit-learn | Reproducible, เร็ว |
| Container | Docker + Compose | Dev/CI/pipeline/serve ([ADR-0004](adr/0004-hybrid-docker.md)) |
| CI | GitHub Actions | lint → typecheck → test → build |

> เวอร์ชันทุกตัว pin แบบ exact ใน `package.json` / `pyproject.toml` และ lockfile — ห้ามใช้ `^` หรือ `latest`

---

## 4. โครงสร้าง Repository

```
stat-tec/
├── app/                            # Frontend (Vite + TS)
│   ├── public/
│   │   ├── models/                 # pose_landmarker_*.task (bundled, offline)
│   │   ├── wasm/                   # MediaPipe WASM (bundled, offline)
│   │   ├── fonts/                  # self-hosted fonts
│   │   ├── audio/                  # sound effects
│   │   └── data/                   # ← output ของ data-pipeline (gitignored บางส่วน)
│   ├── src/
│   │   ├── main.ts                 # bootstrap
│   │   ├── config/                 # ค่า threshold, feature flags (typed)
│   │   ├── core/
│   │   │   ├── bus.ts              # typed event bus
│   │   │   ├── app-machine.ts      # XState machine
│   │   │   ├── loop.ts             # RAF loop + frame timing
│   │   │   └── watchdog.ts
│   │   ├── perception/
│   │   │   ├── perception.worker.ts
│   │   │   ├── camera.ts
│   │   │   ├── player-lock.ts
│   │   │   ├── one-euro.ts
│   │   │   └── body-normalizer.ts
│   │   ├── gestures/
│   │   │   ├── engine.ts           # รัน detector ทั้งหมด → intents
│   │   │   ├── detectors/          # cursor, dwell, swipe, raise, lean, throw, slap, draw, zoom
│   │   │   └── hysteresis.ts
│   │   ├── input/
│   │   │   ├── intent-bus.ts
│   │   │   ├── mouse-adapter.ts
│   │   │   └── replay-adapter.ts
│   │   ├── narrative/
│   │   │   ├── engine.ts           # beat runner
│   │   │   ├── schema.ts           # zod schema ของ story
│   │   │   └── template.ts         # แทนค่า {price} {rank} ฯลฯ
│   │   ├── scoring/
│   │   ├── render/
│   │   │   ├── renderer.ts         # Three.js + postprocessing + adaptive resolution
│   │   │   ├── shaders/
│   │   │   └── materials/
│   │   ├── viz/                    # component ใช้ซ้ำ: ParticleField, Bars3D, LineChart3D, Globe
│   │   ├── hud/                    # DOM overlay: caption, progress, profit, cursor, dwell ring, mini-skeleton
│   │   ├── audio/
│   │   ├── scenes/
│   │   │   ├── types.ts            # SceneModule interface
│   │   │   ├── attract/
│   │   │   ├── welcome/
│   │   │   ├── a-you-are-data/
│   │   │   ├── c-coffee-pricing/
│   │   │   ├── d-segmentation/
│   │   │   ├── f-fraud/
│   │   │   ├── h-forecast/
│   │   │   └── z-ceo-report/
│   │   ├── storage/                # IndexedDB: leaderboard, session stats
│   │   └── debug/                  # overlay, perf graph, pose recorder
│   ├── tests/
│   │   ├── unit/
│   │   ├── replay/                 # pose replay tests
│   │   ├── e2e/
│   │   └── fixtures/poses/         # *.pose.json.gz
│   └── index.html
├── content/
│   ├── story.th.yaml               # บทพูดทั้งหมด
│   └── audio.json                  # manifest เสียง
├── data-pipeline/
│   ├── pyproject.toml
│   ├── src/stat_tec_pipeline/
│   │   ├── sources/                # ดึงข้อมูลจริง
│   │   ├── synth/                  # สร้างข้อมูลจำลอง (fixed seed)
│   │   ├── models/                 # regression / forecast ที่ precompute
│   │   └── export/                 # เขียน .bin + manifest.json
│   └── tests/
├── tools/
│   └── pose-recorder/              # CLI/หน้าเว็บสำหรับอัด fixture
├── docker/
│   ├── app.Dockerfile
│   ├── pipeline.Dockerfile
│   └── nginx.conf
├── scripts/
│   ├── kiosk.sh                    # เปิด Chromium kiosk
│   └── stat-tec-kiosk.service      # systemd user unit
├── docs/
├── .github/
│   ├── workflows/ci.yml
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/
├── docker-compose.yml
└── README.md
```

---

## 5. เลเยอร์ทีละชั้น

### 5.1 Capture — `perception/camera.ts`

> ตั้งแต่ [ADR-0007](adr/0007-perception-service-rtmpose.md): กล้องเป็นของ perception service (เปิดได้ทีละโปรแกรม) — ส่วนนี้ใช้เฉพาะ source `mediapipe` (fallback)

- `getUserMedia({ video: { width: 1920, height: 1080, frameRate: { ideal: 60 } } })`
- เลือกกล้องจาก `deviceId` ที่บันทึกใน config (กันเลือกกล้องผิดตัวเมื่อเสียบหลายตัว)
- ใช้ `MediaStreamTrackProcessor` อ่าน `VideoFrame` แล้ว **transfer** ไป Worker (ไม่ copy)
- ส่ง `ReadableStream` ของ processor ไปทั้งก้อน — worker อ่านเฟรมเอง main thread ไม่แตะภาพเลย
- ไม่ทำ fallback สำหรับเบราว์เซอร์ที่ไม่มี `MediaStreamTrackProcessor` (เช่น Firefox) — แสดง error ชัดเจนแทน ([ADR-0006](adr/0006-kiosk-browser.md))
- Downscale ก่อน inference ที่ ~640 px ด้านยาว (MediaPipe resize ภายในอยู่แล้ว ลด bandwidth)
- ติดตาม `track.onended` / `readyState` → แจ้ง Watchdog

### 5.2 Perception Worker — `perception/perception.worker.ts`

> source `server`: worker เชื่อม WebSocket ไปที่ perception service แล้วป้อน raw detections เข้า `PoseTracker` ตัวเดียวกัน; source `mediapipe`: ตามรายละเอียดด้านล่าง

- โหลด `PoseLandmarker` จาก `/models/` และ `/wasm/` ในเครื่อง
- `runningMode: 'VIDEO'`, `delegate: 'GPU'`, `numPoses: 3`
- `numPoses: 3` ไม่ใช่เพื่อเล่นหลายคน แต่เพื่อ **รู้ว่ามีใครอื่นในเฟรม** แล้วไม่ให้เขาแย่งคุม
- ใช้โมเดล **`heavy`** — นิ่งที่สุดและยังอยู่ในงบ ([ADR-0005](adr/0005-pose-model-heavy.md), [ผลวัด](benchmarks/phase1.md))
- ใช้ WASM แบบ ES module (`forVisionTasks(base, true)`) เพราะ module worker เรียก `importScripts` ไม่ได้
- ส่งออก `PoseFrame` ทุกเฟรม (รวม `inferenceMs` สำหรับ telemetry)
- ถ้า Worker crash → main thread respawn อัตโนมัติ (ดู §14)

### 5.3 Player Lock — `perception/player-lock.ts`

เลือก "CEO" 1 คน แล้วล็อกไว้จนกว่าเขาจะเดินออก

```
score(candidate) = 0.6 · centeredness + 0.4 · closeness
  centeredness = 1 − |torsoCenter.x − 0.5| / 0.5
  closeness    = clamp(shoulderWidthPx / frameWidth / 0.25, 0, 1)

สถานะ: SEARCHING → CANDIDATE (score ≥ 0.6 ต่อเนื่อง 500 ms) → LOCKED
LOCKED: จับคู่ข้ามเฟรมด้วย torso centroid ที่ใกล้ที่สุด (ระยะ < 0.15 ของเฟรม)
LOCKED → LOST เมื่อหาไม่เจอ > 300 ms
LOST   → LOCKED ถ้าคนเดิมกลับมาภายใน 1.5 s (จับคู่จากตำแหน่ง/ขนาดล่าสุด)
LOST   → SEARCHING หลัง 1.5 s
```

- **ห้ามสลับผู้เล่นขณะ LOCKED** แม้จะมีคนที่ score สูงกว่า
- **ขนาดตัว (scale)** = max(ความกว้างไหล่, 0.65 × ความยาวลำตัว) — ตอนหันข้างไหล่ซ้อนกันแต่ลำตัวไม่หด (ใช้ทั้ง PlayerLock, ตัวกรอง และ BodyNormalizer)
- **Detection ซ้ำ:** กรอบที่ซ้อนอยู่ในอีกกรอบ ≥ 85% = คนเดียวกัน เก็บกรอบที่ใหญ่กว่า (ครบกว่า)
- **"ผี" ของผู้เล่น:** MediaPipe บางครั้งให้ fit เพี้ยนตัวเล็กของผู้เล่นเอง (หันข้าง, ชูสองแขน, ปัดมือเร็ว) — ถ้าลำตัวอยู่ในกรอบผู้เล่น (+1 SW) และเล็กกว่า 1/1.7 เท่า → ไม่นับเป็นคนอื่น, ไม่ใช้เป็นตำแหน่งผู้เล่น แต่นับว่าผู้เล่นยังอยู่
- จับคู่ผู้เล่นข้ามเฟรมด้วยตำแหน่ง **และ** ขนาด (ต่างจากขนาดเฉลี่ยแบบ EMA ไม่เกิน 1.7×) — fit เพี้ยนเฟรมเดียวลากค่าอ้างอิงไม่ได้
- ทั้งหมดนี้ยืนยันด้วย replay test จาก session ที่อัดจริง (`app/tests/replay/`)
- **แนวทางวางปุ่ม (สำรอง, research 010):** จากภาพ 2 มิติ "แขนชี้ตรงเข้ากล้อง" กับ "มือหน้าอก" แยกกันแทบไม่ได้ — หลีกเลี่ยงการวางปุ่มที่ *ต้องกด* ตรงตำแหน่งที่ผู้เล่นต้องชี้เข้ากล้อง (หน้าตัว/ใต้กล้อง); ปุ่มสำคัญวางขอบบนและสองข้างก่อน
- **ท่าชูสองแขนทำงานเหมือนท่าชี้** (แขนตรง ยกสูง) → ฉากที่มีทั้งปุ่มและท่าชูแขนต้องปิด cursor ระหว่างช่วงชูแขน (`activeGestures`)
- ตรวจ "พื้นที่ยืน": torso ต้องอยู่ในช่วง x ∈ [0.25, 0.75] ของเฟรมจึงเป็น candidate ได้

### 5.4 Filtering — `perception/one-euro.ts`

- One Euro Filter ต่อ landmark ต่อแกน (33 × 3 ตัว) รันใน worker
- ความเร็วหารด้วยความกว้างไหล่ → `beta` มีหน่วยเป็น **SW/s** ใช้ได้เท่ากันทุกระยะ
- ค่าเริ่มต้น: `minCutoff = 0.8 Hz`, `beta = 3`, `dCutoff = 1.0 Hz` (ลด jitter ~87% ตอนยืนนิ่ง — [ผลวัด](benchmarks/phase1.md)) — จูนความหน่วงตอนขยับเร็วใน Phase 2 ด้วย replay
- Reset เมื่อผู้เล่นหายเกิน 500 ms
- Landmark ที่ `visibility < 0.5` → คงค่าเดิม (hold) ไม่เกิน 200 ms แล้ว mark ว่าไม่ valid
- Mirror แกน x (ภาพแบบกระจก ผู้เล่นยกมือขวา cursor ไปทางขวา)

### 5.5 Body Normalizer — `perception/body-normalizer.ts`

ทำให้ท่าทางทำงานเหมือนกันทั้งเด็กตัวเล็กและผู้ใหญ่ ยืนใกล้หรือไกล

```
origin = midpoint(leftShoulder, rightShoulder)
unit   = distance(leftShoulder, rightShoulder)       // "SW" = shoulder width
p_body = (p_image − origin) / unit
```

threshold ของท่าทางทั้งหมดใช้หน่วย **SW** และ **SW/s** (ไม่ใช้ pixel)

### 5.6 Gesture Engine — `gestures/`

- Detector แต่ละตัวเป็น state machine เล็กๆ: `idle → arming → active → cooldown`
- ใช้ **hysteresis** เสมอ (threshold เข้า > threshold ออก) กันสั่น
- Scene ประกาศว่าตอนนี้ใช้ท่าอะไรบ้าง (`activeGestures`) → engine รันเฉพาะตัวนั้น ลด false trigger
- รายละเอียดแต่ละท่าใน [§7](#7-gesture-catalogue)

### 5.7 Intent Bus — `input/intent-bus.ts`

- Typed pub/sub: `bus.emit(intent)` / `bus.on('select', handler)`
- 3 แหล่งที่ส่งเข้ามาได้: `pose` (GestureEngine), `mouse` (MouseAdapter), `replay` (ReplayAdapter)
- MouseAdapter map: เลื่อนเมาส์ → `cursor`, คลิก → `select`, ลาก → `draw`, wheel → `zoom`, ปุ่มลูกศร → `swipe`/`scrub`
- เปิด MouseAdapter ด้วย hotkey ของ staff (`F2`) — ใช้ได้ทันทีถ้ากล้องมีปัญหา

### 5.8 App State Machine — ดู [§8](#8-app-state-machine)

### 5.9 Narrative Engine — ดู [§9](#9-narrative-engine)

### 5.10 Scenes — `scenes/`

```ts
interface SceneModule {
  id: SceneId;
  activeGestures: GestureKind[];           // ท่าที่ฉากนี้ใช้
  preload(ctx: SceneContext): Promise<void>; // โหลด data/texture ล่วงหน้า (ตอน attract)
  enter(ctx: SceneContext): Promise<void>;   // animate in
  onBeat(beat: StoryBeat): void;             // narrative แจ้งว่าเข้าจังหวะไหน
  onIntent(intent: Intent): void;
  update(dt: number, t: number): void;       // ทุกเฟรม
  result(): SceneResult;                     // ส่งให้ scoring + template
  exit(): Promise<void>;                     // animate out
  dispose(): void;                           // คืน GPU memory
}
```

- **Preload ทุกฉากตั้งแต่ boot** แล้วเก็บไว้ใน GPU → ไม่มีการโหลดระหว่างเล่น
- Transition ระหว่างฉาก: crossfade ด้วย render target 2 ชุด (ไม่มีจอดำ)

---

## 6. Data Contracts

```ts
// ---------- Perception → Main ----------
interface Landmark { x: number; y: number; z: number; visibility: number }

interface TrackedPlayer {
  id: number;                       // เปลี่ยนเมื่อเป็นคนใหม่
  image: Landmark[];                // 33 จุด, normalized [0,1], mirrored, filtered
  body: Landmark[];                 // 33 จุด, หน่วย SW, origin = กลางไหล่
  world: Landmark[];                // 33 จุด, เมตร (จาก MediaPipe)
  shoulderWidth: number;            // สัดส่วนของความกว้างเฟรม (ใช้ประมาณระยะ)
  confidence: number;               // เฉลี่ย visibility ของจุดสำคัญ
}

interface PoseFrame {
  frameId: number;
  t: number;                        // performance.now() ตอนถ่าย (ms)
  inferenceMs: number;
  lock: 'searching' | 'candidate' | 'locked' | 'lost';
  player: TrackedPlayer | null;
  others: number;                   // จำนวนคนอื่นในเฟรม
}

// ---------- Input → App ----------
type IntentSource = 'pose' | 'mouse' | 'replay';
type Hand = 'left' | 'right';

type Intent = { t: number; source: IntentSource } & (
  | { type: 'presence'; state: 'enter' | 'lost' | 'return' | 'leave' }
  | { type: 'cursor'; x: number; y: number; hand: Hand; visible: boolean }   // screen [0,1]
  | { type: 'dwell'; targetId: string; progress: number }                    // 0..1
  | { type: 'select'; targetId: string }
  | { type: 'swipe'; dir: 'left' | 'right' | 'up' | 'down'; speed: number }
  | { type: 'raise'; hand: Hand | 'both'; level: number }                    // 0..1
  | { type: 'lean'; value: number }                                          // -1..1
  | { type: 'zoom'; scale: number }                                          // relative
  | { type: 'throw'; x: number; y: number; vx: number; vy: number }
  | { type: 'slap'; x: number; y: number; speed: number }
  | { type: 'draw'; phase: 'start' | 'move' | 'end'; x: number; y: number }
);

// ---------- Scene → Scoring / Narrative ----------
interface SceneResult {
  sceneId: SceneId;
  score: number;                    // 0..1 (ความใกล้เคียงคำตอบที่ดีที่สุด)
  vars: Record<string, string | number>; // สำหรับแทนค่าในบทพูด เช่น { price: 75 }
  style: Partial<Record<CeoStyle, number>>;
}
```

---

## 7. Gesture Catalogue

หน่วย: **SW** = ความกว้างไหล่, **SW/s** = ความเร็ว. ค่าทั้งหมดเป็น **ค่าเริ่มต้น** อยู่ใน `config/gestures.ts` และจูนด้วย replay ใน Phase 2

| ท่า | Intent | เงื่อนไขตรวจจับ | Hysteresis / Cooldown | ใช้ในฉาก |
|---|---|---|---|---|
| **ยืนเข้าจุด** | `presence` | PlayerLock = LOCKED | lost > 300 ms, leave > 8 s | ทุกฉาก |
| **ชี้ (cursor)** | `cursor` | **เริ่ม:** ข้อมือสูงกว่าสะโพก ≥ 0.8 SW, แขนเหยียด (ข้อมือ–ไหล่) ≥ 0.9 SW **และแขนตรง** (ไหล่–ข้อมือ ÷ (ต้นแขน+ปลายแขน)) ≥ 0.8 (RTMPose) / 0.7 (MediaPipe) ต่อเนื่อง 100 ms · **ค้าง:** สูง ≥ 0.3 SW, ตรง ≥ 0.5, และเหยียด ≥ 0.6 SW **หรือ** แขนดูสั้นแต่ยังตรง ≥ 0.65 (ชี้เข้ากล้อง) · แปลงตำแหน่งข้อมือใน**พื้นที่ข้างตัว** x ∈ [0.4, 1.7] SW ออกด้านข้าง, y ∈ [−1.2, 0.3] SW (มือซ้ายสะท้อน) เป็นจอ · ชี้อยู่แล้ว มือสูงกว่าสะโพก ≥ 1.0 SW = ชี้ต่อเสมอ | เริ่มยาก–ค้างง่าย; กอดอก/เกาหัวถูกกันด้วย "แขนตรง" (กอดอกใน RTMPose ระยะถึง 1.1 SW แต่ศอกงอ); เกณฑ์แยกตามแหล่ง pose (`cursorConfigFor`); ไม่สลับมือระหว่างชี้ — ค่ามาจาก session ที่อัดจริงทั้ง 2 แหล่ง; พื้นที่ข้างตัวแก้ปุ่มหน้าตัวกดไม่ได้ (research 010) | ทุกฉาก |
| **ชี้ค้าง (dwell)** | `dwell` → `select` | cursor อยู่บนเป้า (+0.02 padding) ต่อเนื่อง 1200 ms | หลุดเป้า ≤ 150 ms ไม่นับ; เกินนั้น reset (ส่ง progress 0); เป้าเดิม cooldown 800 ms | เมนู, เลือกกลุ่ม, ข้าม |
| **ปัด** | `swipe` | ข้อมือเคลื่อนแนวนอน > 1.2 SW ภายใน 400 ms, ความเร็วสูงสุด > 2.5 SW/s | cooldown 600 ms | สำรอง/ฉากเสริม |
| **ยกมือ** | `raise` | level = ตำแหน่ง y ข้อมือ map จากเอว (0) → เหนือหัว 0.5 SW (1) | smoothing เพิ่ม + dead zone 0.05 | C ราคา, welcome |
| **ยกสองแขน** | `raise both` | ข้อมือทั้งสอง สูงกว่าจมูก > 0.3 SW ต่อเนื่อง 300 ms | ออกเมื่อต่ำกว่าจมูก | ยืนยัน/ฉลอง |
| **เอียงตัว** | `lean` | มุมของเส้น กลางสะโพก→กลางไหล่ กับแนวดิ่ง; dead zone ±5°, เต็มสเกล ±20° | low-pass เพิ่ม | ฉากเสริม (B, G) |
| **ขว้าง** | `throw` | ความเร็วข้อมือพีค > 3.0 SW/s แล้วลดลง > 50% ใน 100 ms → จุดปล่อย + เวกเตอร์ | cooldown 500 ms | D แม่เหล็ก |
| **ตบ** | `slap` | ความเร็วข้อมือ > 3.0 SW/s และ cursor อยู่ในเป้า | cooldown ต่อมือ 250 ms | F จับโกง |
| **วาดเส้น** | `draw` | "ปากกาลง" เมื่อข้อมือสูงกว่าไหล่; ยกเลิกเมื่อต่ำกว่าไหล่ > 200 ms; sample 30 Hz | ปากกาลง/ขึ้นใช้ threshold ต่างกัน 0.2 SW | H พยากรณ์ |
| **กาง/หุบแขน** | `zoom` | ทั้งสองมืออยู่ใน comfort box; scale = ระยะสองมือตอนนี้ / ตอนเริ่ม | เริ่มเมื่อสองมือขึ้นพร้อมกัน ≤ 300 ms | ฉากเสริม (I) |

**การป้องกัน false trigger**

- Scene เปิดเฉพาะท่าที่ใช้ (`activeGestures`)
- ช่วง mission/reveal/lesson ปิดท่าเล่นทั้งหมด เหลือแค่ `dwell` บนปุ่ม "ข้าม"
- ทุก intent ต้องมาจาก player ที่ LOCKED และ `confidence ≥ 0.6`

---

## 8. App State Machine

```
           ┌──────────┐
           │   boot   │  preload models/data/fonts/audio, warm-up GPU
           └────┬─────┘
                ▼
           ┌──────────┐ presence:enter (stable 500ms)
     ┌────▶│ attract  │────────────────────────────┐
     │     └──────────┘                            ▼
     │                                       ┌──────────┐
     │                                       │ welcome  │ สุ่ม codename, สอนชี้/ยกมือ
     │                                       └────┬─────┘
     │                                            ▼
     │                                ┌───────────────────────┐
     │                                │ chapter[i]            │
     │                                │  mission → tutorial → │
     │                                │  play → reveal →      │
     │                                │  lesson → transition  │
     │                                └───────────┬───────────┘
     │                                     i < N  │  i == N
     │                                    (loop)  ▼
     │                                       ┌──────────┐
     │                                       │ outro    │ CEO report + leaderboard + QR
     │                                       └────┬─────┘
     │                                  timeout 20s / leave
     └────────────────────────────────────────────┘

Global (จากทุก state ยกเว้น boot/attract):
  presence:lost  → paused   (ข้อความ "กลับมายืนตรงจุดนี้นะครับ")
  paused + return (≤ 8s) → resume state เดิม
  paused + 8s           → attract (บันทึก session เป็น abandoned)
  staff:reset (F5)      → attract
```

- implement ด้วย XState v5, export diagram ไว้ใน docs ได้
- Session = 1 รอบเล่น มี `sessionId`, `codename`, เวลาเริ่ม/จบ, ผลแต่ละฉาก

---

## 9. Narrative Engine

### 9.1 Beat types

| Beat | หน้าที่ | ท่าที่เปิด | จบเมื่อ |
|---|---|---|---|
| `mission` | AI เล่าโจทย์ | `dwell` (ข้าม) | ครบทุกบรรทัด / ข้าม |
| `tutorial` | เงาคนโปร่งแสงสาธิตท่า | ท่าของฉาก | ผู้เล่นทำท่าสำเร็จ 1 ครั้ง / 8 s |
| `play` | เล่นจริง | ท่าของฉาก | ครบเวลา / scene บอกว่าเสร็จ |
| `reveal` | ตัวเลขใหญ่ + ผลลัพธ์ | `dwell` (ข้าม) | ครบบรรทัด |
| `lesson` | การ์ด "สิ่งที่น้องทำคือ…" | `dwell` (ข้าม) | ครบบรรทัด |
| `transition` | กำไรวิ่ง → ฉากถัดไป | – | animation จบ |

### 9.2 Story file — `content/story.th.yaml`

```yaml
meta:
  aiName: "[AI_NAME]"
  locale: th
chapters:
  - id: coffee
    scene: c-coffee-pricing
    beats:
      - type: mission
        lines:
          - "บริษัทเรามีร้านกาแฟชื่อ 'ดาต้าคาเฟ่'"
          - "ตอนนี้ขายแก้วละ 60 บาท"
      - type: tutorial
        gesture: raise
        lines: ["ยกมือขึ้น = ขึ้นราคา  ลดมือลง = ลดราคา"]
      - type: play
        durationSec: 30
        hints:
          - { afterSec: 6, text: "ดูลูกค้าที่เดินเข้าร้านสิครับ" }
      - type: reveal
        lines: ["ท่านตั้งราคา ฿{price}", "โมเดลแนะนำ ฿{optimalPrice}"]
      - type: lesson
        lines: ["เส้นนี้เรียกว่า Demand Curve"]
```

- ตรวจด้วย zod (`narrative/schema.ts`) ใน unit test — บทพูดผิดรูปแบบ = CI fail
- Template `{var}` แทนค่าจาก `SceneResult.vars`; แต่ละบทประกาศ `vars:` ที่ฉากส่งให้ → ตัวแปรที่ไม่มีใครส่ง = test fail
- บรรทัดเขียนได้เป็นข้อความ หรือ `{ text, cue, when }`: `cue` สั่งฉากเล่น animation, `when: close` / `'!close'` แสดงตามผลของฉาก
- ความยาว ≤ 52 ตัวอักษรที่กินที่ (ไม่นับสระบน/ล่าง วรรณยุกต์) → ลง 1 บรรทัดของกล่องบทพูด
- Typewriter: ~35 ตัวอักษร/วินาที, ค้างบรรทัดละ `max(1.8s, ความยาว × 60ms)`
- **กติกาข้อความ**: ≤ 12 คำ/บรรทัด, แสดงพร้อมกันไม่เกิน 2 บรรทัด

---

## 10. Scoring Model

- ทุกฉากคืน `score ∈ [0,1]` = ความใกล้คำตอบที่ดีที่สุด (นิยามเฉพาะฉาก)
- กำไรต่อฉาก = `base × (0.4 + 0.6 × score)` → **ทุกคนได้กำไรเสมอ** (เด็กต้องรู้สึกดี)
- `base` ต่อฉากตั้งใน config รวมแล้วอยู่ในหลักล้านบาท (ดูอลังการ)
- **CEO Style** สะสมจากพฤติกรรม: `analyst` (ใกล้คำตอบโมเดล), `risk-taker` (เลือกสุดโต่ง), `intuitive` (ตัดสินใจเร็ว)
- Leaderboard: เรียงตามกำไรรวม, รีเซ็ตทุกวัน (key ตามวันที่), เก็บใน localStorage (≤ 500 รายการ/วัน — เล็กพอ, sync, ไม่ต้องใช้ IndexedDB), แสดง codename เท่านั้น
- `base` ต่อบท: data 120k · coffee 280k · segments 320k · fraud 300k · forecast 380k → สูงสุด ฿1.4M, ต่ำสุด ฿560k (`config/scoring.ts`)

| ฉาก | นิยาม score |
|---|---|
| A | ไม่มีคะแนน (warm-up) — ได้ base คงที่ |
| C | `1 − |price − optimal| / range` |
| D | ความเหมาะสมของกลุ่มที่เลือกยิงโฆษณา (ROI จำลอง) |
| F | F1-score ของการตบ (จับถูก vs ตบลูกค้าดี) |
| H | `1 − MAPE` ของเส้นที่วาดเทียบค่าจริง (clamp) |

---

## 11. Rendering และ Design System

### 11.1 Renderer

- `WebGLRenderer` + `postprocessing`: Bloom (selective), SMAA, Vignette, Noise เบาๆ
- **Adaptive resolution**: ถ้า p95 frame time > 15 ms ใน 2 วินาที → ลด render scale ทีละ 10% (ขั้นต่ำ 0.6), กลับขึ้นเมื่อว่าง
- จอ 4K: render ภายในที่ ~1440p แล้ว upscale (ข้อความ HUD ยังคมเพราะเป็น DOM)
- ข้อมูลจำนวนมาก: `InstancedMesh` / `Points` + custom shader, อัปเดตด้วย attribute buffer ไม่สร้าง object ใหม่ต่อเฟรม
- **Zero allocation ใน hot loop** (ไม่สร้าง Vector3/Array ใหม่ทุกเฟรม → ไม่มี GC กระตุก)
- จัดการ `webglcontextlost` / `restored`

### 11.2 HUD — DOM overlay

- ข้อความไทยใช้ DOM (shaping/สระ/วรรณยุกต์ ถูกต้อง 100% ซึ่ง text ใน WebGL ทำได้ไม่ดี)
- animate ด้วย `transform`/`opacity` เท่านั้น (compositor-only, ไม่ trigger layout)
- Label ที่ผูกกับวัตถุ 3D ใช้ `CSS2DRenderer`

### 11.3 Design tokens — สไตล์ "Holographic HUD"

| Token | ค่า | ใช้กับ |
|---|---|---|
| `--bg` | `#050B18` | พื้นหลัง (กรมท่าเกือบดำ) |
| `--bg-grid` | `#0D1B33` | เส้นกริดพื้นหลัง |
| `--panel` | `rgba(12, 32, 64, 0.55)` + blur 12px | กล่องข้อความ (glass) |
| `--primary` | `#3FE0FF` | เส้นเรืองแสง, cursor, ข้อมูลหลัก |
| `--accent` | `#FFC857` | เงิน/กำไร/ไฮไลต์ |
| `--positive` | `#3DFFA2` | ขึ้น/ถูก |
| `--negative` | `#FF4D6D` | ลง/โกง/ผิด |
| `--text` | `#E6F1FF` | ข้อความหลัก |
| `--text-dim` | `#7E93B5` | ข้อความรอง |

**Typography** (self-hosted, offline)
- Thai/UI: **Anuphan** (หัวข้อ, ข้อความ AI)
- ตัวเลข/ticker: **JetBrains Mono** (tabular figures — ตัวเลขวิ่งไม่ดิ้น)

**ขนาดตามระยะยืน 2–2.5 m** (คิดจากความสูงจอ, หน่วย `vh`)

| ระดับ | ขนาด | ตัวอย่าง |
|---|---|---|
| Hero number | 16–20 vh | "฿1,240,000" ตอน reveal |
| Headline | 8 vh | ชื่อบท |
| Caption (AI) | 5 vh | ข้อความ AI — **ขั้นต่ำ** |
| HUD label | 3.5 vh | progress, กำไร (อ่านโดยคนดูด้านหลังด้วย) |

**Motion**
- Ease หลัก: `expo.out` (เข้า), `power2.in` (ออก)
- ระยะเวลา: micro 200 ms / UI 500 ms / ฉาก 1200 ms
- **ห้ามกะพริบเร็วเกิน 3 ครั้ง/วินาที** (photosensitive safety)

---

## 12. Audio

- Howler.js, เสียงทั้งหมดลงทะเบียนใน `content/audio.json`
- หมวด: `ui` (hover/dwell/select), `sfx` (ตบ/ขว้าง/เงินไหล), `stinger` (reveal), `ambient` (ดนตรีพื้นหลังเบาๆ)
- Ducking: ambient ลดเสียง 50% ระหว่าง stinger
- Master volume ใน config + hotkey staff
- **Placeholder** ไปก่อนจนกว่าจะได้ไฟล์จริง; ทุกไฟล์ต้องมี license (CC0/ซื้อสิทธิ์) บันทึกใน `app/public/audio/LICENSES.md`

---

## 13. Data Pipeline

### 13.1 Flow

```
sources/ (ข้อมูลจริง)  ─┐
synth/   (จำลอง, seed) ─┼─▶ clean/transform (polars) ─▶ models/ (precompute) ─▶ export/
                        │                                                       │
                        └───────────────────────────────────────────────────────┘
                                                    ▼
                              app/public/data/<scene>/*.bin + manifest.json
```

- รันใน Docker: `docker compose run --rm pipeline build`
- **Reproducible**: seed คงที่, ผลลัพธ์มี sha256 ใน manifest, CI ตรวจว่า manifest ตรงกับ build

### 13.2 รูปแบบ output

- ตัวเลขเป็น `Float32Array` / `Uint32Array` เขียนเป็น `.bin` (little-endian) → frontend โหลดด้วย `fetch → arrayBuffer` แล้วส่งขึ้น GPU ตรงๆ
- `manifest.json`: schema ต่อไฟล์ (ชื่อคอลัมน์, dtype, จำนวนแถว, stride), แหล่งที่มา, license, `real | simulated`

### 13.3 ข้อมูลรายฉาก

| ฉาก | ประเภท | แหล่ง / วิธี | สิ่งที่คำนวณใน browser (live) |
|---|---|---|---|
| A | Live | ข้อมูลจากตัวผู้เล่นเอง | นับจำนวนตัวเลขที่เก็บได้จริง |
| C | Simulated | Demand แบบ log-linear + noise + ฤดูกาล | Fit regression สดจากราคาที่ผู้เล่นลอง |
| D | Simulated | ลูกค้า 10,000 คนจาก Gaussian mixture (RFM: recency, frequency, monetary) | **K-means รันจริงใน browser** (animate ทุก iteration) |
| F | Simulated | ธุรกรรม 1,000,000 รายการ, anomaly ~0.5% | **รันโมเดลจริงใน browser แล้วจับเวลาจริง** (ตัวเลขที่โชว์เป็นของจริง) |
| H | Simulated | ยอดขายรายวัน 3 ปี: trend + weekly/annual seasonality + spike 11.11/12.12 | เทียบเส้นที่วาดกับค่าจริง; เส้นโมเดล precompute (SARIMA/GBM) |
| B, G, I (เสริม) | Real | ต้องตรวจ license ก่อนใช้ (Phase 4+) | – |

> บนจอทุกฉากติดป้าย **"ข้อมูลจริง"** หรือ **"ข้อมูลจำลอง"** ชัดเจน

---

## 14. Robustness

| เหตุการณ์ | การตรวจจับ | การกู้คืน |
|---|---|---|
| กล้องหลุด / ถูกถอด | `track.onended`, ไม่มีเฟรม > 1 s | หน้าจอ "กำลังเชื่อมต่อกล้อง…", retry `getUserMedia` ทุก 2 s |
| Worker crash / ค้าง | `error` event, ไม่มี PoseFrame > 2 s | terminate + respawn, เกิน 3 ครั้ง/นาที → reload หน้า |
| WebGL context lost | `webglcontextlost` | สร้าง resource ใหม่ตอน `restored`, ไม่ได้ใน 3 s → reload |
| FPS ตก | p95 frame time | adaptive resolution (§11.1) |
| Memory รั่ว | `performance.memory` sampling | log + reload ตอนกลับเข้า attract ถ้าเกินเกณฑ์ |
| JS error ไม่คาดคิด | `window.onerror` / `unhandledrejection` | log + กลับ attract; error ซ้ำ → reload |
| Chromium ปิด | systemd `Restart=always` | เปิดใหม่อัตโนมัติ |
| มีคนแทรกเข้าเฟรม | `others > 0` | ไม่เปลี่ยนผู้เล่น; AI พูดสุภาพ (ครั้งเดียว) |
| แสงย้อน / confidence ต่ำ | `confidence < 0.6` ต่อเนื่อง | ข้อความแนะนำให้ขยับเข้ามา; staff แก้หน้างาน |

**Staff hotkeys** (ซ่อน ไม่แสดงบนจอ)

| ปุ่ม | ทำอะไร |
|---|---|
| `F1` | Debug overlay (FPS, latency, skeleton, lock state, confidence) |
| `F2` | สลับ Mouse mode |
| `F3` | แสดง skeleton ดิบ (ก่อนกรอง) ซ้อนบน debug overlay |
| `F5` | กลับ attract ทันที |
| `F8` | Pose recorder (dev build เท่านั้น) |
| `F9` | Export สถิติวันนี้เป็น JSON · ใน `?playground`: ดาวน์โหลดผลการกดปุ่ม + ท่าที่อัด (research 010) |
| `F10` / `F11` | ลด / เพิ่มเสียง |

---

## 15. Testing Strategy

| ระดับ | เครื่องมือ | ครอบคลุม |
|---|---|---|
| Unit | Vitest | OneEuroFilter, BodyNormalizer, PlayerLock, gesture detectors, scoring, template, story schema |
| Pose replay | Vitest + `tests/fixtures/poses/*.pose.json.gz` | ป้อนท่าที่อัดจริงเข้า GestureEngine → ตรวจ intent ที่ออกมา (เช่น "ไฟล์ `swipe-left-kid-01` ต้องได้ swipe left 1 ครั้ง, false trigger 0") |
| Negative replay | เหมือนบน | ไฟล์ "ยืนเฉยๆ", "เดินผ่าน", "เกาหัว" → **ต้องไม่มี intent** |
| E2E | Playwright + `--use-file-for-fake-video-capture=*.y4m` | เปิดแอปจริง + วิดีโอปลอม → ผ่าน attract → welcome → ฉากแรก |
| Data | pytest | schema output, seed คงที่ได้ผลเดิม, ไม่มี NaN |
| Performance | สคริปต์วัด + debug overlay | fps/latency บนเครื่องเป้าหมาย ก่อน merge เข้า `main` |
| Soak | รันวนอัตโนมัติด้วย replay 8 ชม. | memory, crash |
| Playtest | คนจริง (เด็ก/ผู้ใหญ่ ≥ 10 คน) | ความเข้าใจท่าทาง, อ่านทันไหม, สนุกไหม |

**Fixture set ขั้นต่ำ**: ผู้ใหญ่ 3 คน + (ถ้าได้รับอนุญาต) วัยรุ่น 2 คน, แต่ละท่า × 3 ระยะ (1.8 / 2.3 / 3 m) × 2 สภาพแสง
— เก็บแค่ landmark ไม่เก็บภาพ (§17)

---

## 16. Deployment

### 16.1 Docker แบบผสม ([ADR-0004](adr/0004-hybrid-docker.md))

```yaml
# docker-compose.yml (โครงร่าง)
services:
  web:        # nginx เสิร์ฟ app/dist ที่ build แล้ว
    ports: ["127.0.0.1:8080:80"]
    restart: always
  dev:        # vite dev server (profile: dev)
  pipeline:   # python data pipeline (profile: data)
```

- **เบราว์เซอร์ kiosk รันบน host โดยตรง** (กล้อง + GPU ไม่ผ่าน container)
- **Perception service รันบน host โดยตรง** (`uv` + systemd user unit, `Restart=always`) — ต้องใช้กล้องและ GPU ([ADR-0007](adr/0007-perception-service-rtmpose.md))
- Bind เฉพาะ `127.0.0.1` — ไม่เปิดพอร์ตออกเครือข่าย

### 16.2 Kiosk — `scripts/kiosk.sh`

```bash
google-chrome \
  --kiosk --app=http://127.0.0.1:8080 \
  --use-fake-ui-for-media-stream \          # อนุญาตกล้องอัตโนมัติ
  --autoplay-policy=no-user-gesture-required \
  --ignore-gpu-blocklist --enable-gpu-rasterization \
  --noerrdialogs --disable-session-crashed-bubble \
  --disable-features=Translate --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.stat-tec-kiosk"
```

- systemd user unit `stat-tec-kiosk.service` (`Restart=always`)
- ปิด screen blanking / sleep ของ OS

### 16.3 Release

- Build จาก tag `vX.Y.Z` บน `main` เท่านั้น
- เครื่องหน้างาน: `git checkout vX.Y.Z && docker compose up -d --build`

### 16.4 Checklist ก่อนวันงาน (ย่อ — ฉบับเต็มใน ROADMAP Phase 6)

- [ ] TV เปิด Game Mode, ปิด motion smoothing
- [ ] กล้องติดตั้งกลางจอ, ติดเทปจุดยืน 2.3 m
- [ ] ตรวจแสง: ไม่มีหน้าต่าง/ไฟจ้าข้างหลังผู้เล่น
- [ ] เปิด F1 ดู fps ≥ 60, inference ≥ 30, confidence ≥ 0.8 ที่จุดยืน
- [ ] ทดสอบเล่นครบ 1 รอบ + ทดสอบดึงกล้องออกแล้วเสียบกลับ
- [ ] ตั้งเครื่องไม่ให้ sleep / auto-update
- [ ] Chrome เป็นเวอร์ชันที่ทดสอบผ่าน และ `apt-mark hold google-chrome-stable` แล้ว

---

## 17. Privacy

- **ภาพจากกล้องไม่ออกจากเครื่อง และไม่ถูกบันทึก** — ประมวลผลในหน่วยความจำแล้วทิ้ง
- ไม่ถ่ายรูป ไม่เก็บใบหน้า ไม่เก็บชื่อจริง; leaderboard ใช้ codename สุ่ม
- Session stats เก็บแค่: เวลา, ฉากที่เล่นถึง, คะแนน — ไม่ระบุตัวตน
- Pose recorder ใช้เฉพาะ dev build, เก็บแค่ landmark, อัดเฉพาะผู้ที่ยินยอม (ผู้เยาว์ต้องได้ความยินยอมจากผู้ปกครอง)
- มีป้ายหน้างาน: "กล้องใช้จับท่าทางเท่านั้น ไม่มีการบันทึกภาพ" (สอดคล้อง PDPA)

---

## 18. Risks และสิ่งที่ต้องพิสูจน์

| # | ความเสี่ยง | ผลกระทบ | แผนพิสูจน์/รับมือ | Phase |
|---|---|---|---|---|
| R1 | ~~MediaPipe GPU delegate ใน Web Worker อาจมีข้อจำกัด~~ | – | ✅ **ปิดแล้ว** — GPU delegate ทำงานใน module worker บน RTX 4060 ([ADR-0002](adr/0002-perception-in-worker.md)) | 1 |
| R2 | ยังไม่มีกล้องตัวจริง (ตอนนี้ใช้เว็บแคมในตัว 720p30) | latency/fps ที่วัดได้ยังไม่ใช่ของหน้างาน | จัดหา webcam 1080p@60 แล้ววัดซ้ำ (`/?bench`) | 1–6 |
| R3 | ความแม่นยำของ pose ที่ระยะ 2–3 m กับเด็กตัวเล็ก | ท่าทางพลาด | Body-normalized thresholds + playtest กับวัยรุ่น | 2, 6 |
| R4 | แสงหน้างานไม่ดี | confidence ต่ำ | สำรวจสถานที่ล่วงหน้า, เตรียมไฟส่องหน้า | 6 |
| R5 | Latency รวมเกิน 100 ms | รู้สึกหน่วง | กล้อง 60fps, TV game mode, วัดจริง | 1 |
| R6 | ลิขสิทธิ์ข้อมูลจริง/เสียง | ใช้ไม่ได้ | ตรวจ license ก่อนใช้, บันทึกใน manifest | 4, 5 |
| R7 | Font ไทยใน kiosk offline | ตัวอักษรเพี้ยน | self-host ฟอนต์ทั้งหมด | 3 |
| R8 | Perception service ล่มหน้างาน | ไม่มี skeleton | systemd restart + fallback MediaPipe อัตโนมัติ + health ใน overlay | 2, 6 |
| R9 | RTMPose ให้ score สูงกับข้อมือที่ซ่อนอยู่ (0.45–0.85) | cursor/ท่าทางจากมือที่ "เดา" | gestures พึ่งกฎเชิงท่าทาง ไม่ใช่ score; ยืนยันด้วย replay จาก session RTMPose | 2 |
