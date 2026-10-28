# STAT_TEC — Roadmap

> ไม่มี deadline — เน้นคุณภาพ แต่ละ Phase ต้องผ่าน **Definition of Done (DoD)** ก่อนขึ้น Phase ถัดไป
> งานแต่ละข้อ = 1 branch / 1 PR (ชื่อ branch ตาม [CONTRIBUTING.md](CONTRIBUTING.md))

## ภาพรวม

```
Phase 0  Foundation            ── repo, CI, Docker, โครงโปรเจกต์
Phase 1  Perception Spike      ── กล้อง → skeleton → วัดตัวเลขจริง        ◀ จุดตัดสินใจทางเทคนิค
Phase 2  Gesture & Input       ── ท่าทาง + Intent Bus + recorder/replay
Phase 3  Core Experience       ── state machine, narrative, HUD, design system
Phase 4  Scenes                ── A → C → D → F → H → Z (ทีละฉาก)
Phase 5  Polish                ── เสียง, transition, leaderboard, attract
Phase 6  Hardening & Field     ── soak test, playtest, ซ้อมหน้างาน      ◀ v1.0.0
```

| Release | หลัง Phase | ความหมาย |
|---|---|---|
| `v0.1.0` | 1 | เห็น skeleton บนจอ + ตัวเลข performance จริง |
| `v0.2.0` | 2 | คุม cursor/ท่าทางด้วยร่างกายได้แม่นยำ |
| `v0.3.0` | 3 | เล่นได้ครบ flow (ฉาก placeholder) |
| `v0.4.0`–`v0.9.0` | 4–5 | เพิ่มฉากจริงทีละฉาก + polish |
| `v1.0.0` | 6 | พร้อมใช้ในงานจริง |

---

## Phase 0 — Foundation

| # | งาน | Branch |
|---|---|---|
| 0.1 | `git init`, สร้าง repo `KittipoomNaknut/stat-tec` (public), push เอกสาร | `main` (initial commit) |
| 0.2 | สร้าง `develop`, ตั้ง branch protection (`main`, `develop`) | – |
| 0.3 | Scaffold `app/` (Vite + TS strict + ESLint + Prettier + Vitest) | `chore/scaffold-app` |
| 0.4 | Scaffold `data-pipeline/` (uv + polars + pytest) | `chore/scaffold-pipeline` |
| 0.5 | Docker: `app.Dockerfile`, `pipeline.Dockerfile`, `docker-compose.yml`, nginx | `chore/docker-setup` |
| 0.6 | GitHub Actions CI: lint → typecheck → test → build (app + pipeline) | `ci/github-actions` |
| 0.7 | PR template, issue templates, labels, LICENSE | `chore/repo-templates` |

**DoD**
- [ ] `docker compose --profile dev up` แล้วเปิดหน้าเปล่าได้
- [ ] CI เขียวบน PR แรก
- [ ] Branch protection ทำงาน (push ตรงเข้า `main` ไม่ได้)

---

## Phase 1 — Perception Spike ⚠️ จุดตัดสินใจ

**เป้าหมาย:** พิสูจน์ R1, R5 (ดู ARCHITECTURE §18) บนเครื่องจริงก่อนลงทุนต่อ
**ต้องมี:** กล้อง USB 1080p@60

| # | งาน | Branch |
|---|---|---|
| 1.1 | Camera module + เลือก device + reconnect | `feature/perception-camera` |
| 1.2 | Perception Worker + PoseLandmarker (GPU) + bundle model/WASM offline | `feature/perception-worker` |
| 1.3 | Debug overlay: skeleton, fps, inferenceMs, render frame time | `feature/debug-overlay` |
| 1.4 | Benchmark `full` vs `heavy` × resolution → บันทึกผลใน `docs/benchmarks/phase1.md` | `chore/perception-benchmark` |
| 1.5 | วัด motion-to-photon latency (LED/จับเวลาด้วยกล้องมือถือ slow-mo) | `chore/latency-measurement` |
| 1.6 | ADR ผลการตัดสินใจ (worker vs main, model) | `docs/adr-perception-results` |

**DoD**
- [x] Render ≥ 60 fps และ inference ≥ 30 fps พร้อมกัน — 165 / 30.5 fps ([ผลวัด](benchmarks/phase1.md))
- [ ] Latency p95 ≤ 100 ms — ⏭ เลื่อนไปวัดพร้อมกล้อง 1080p60 ตัวจริง (เว็บแคมในตัวเป็นตัวกำหนด latency หลัก)
- [~] Skeleton เสถียร — วัดที่ ~2 m แล้ว (jitter 0.58 px หลังกรอง); 1.8 / 3 m วัดพร้อมกล้องตัวจริง
- [x] Tag `v0.1.0`

**ผล:** R1 ปิดแล้ว ([ADR-0002](adr/0002-perception-in-worker.md)), เลือกโมเดล heavy ([ADR-0005](adr/0005-pose-model-heavy.md)), เบราว์เซอร์ kiosk ([ADR-0006](adr/0006-kiosk-browser.md))
งาน 2.1 (One Euro filter) ถูกดึงมาทำใน Phase 1 เพราะ skeleton สั่นมาก

---

## Phase 2 — Gesture & Input

| # | งาน | Branch |
|---|---|---|
| 2.1 | ~~OneEuroFilter + BodyNormalizer~~ ✅ (#8, #15) | `feature/perception-filtering` |
| 2.2 | ~~PlayerLock~~ ✅ (#16, #19) | `feature/perception-player-lock` |
| 2.3 | ~~Pose recorder~~ ✅ (#18) | `feature/tools-pose-recorder` |
| 2.4 | อัด fixture set ขั้นต่ำ — ✅ ชุดแรก (#19); ⏳ คนอื่น/ระยะอื่น/กล้องจริง | `test/pose-fixtures` |
| 2.5 | ~~Intent Bus + types + MouseAdapter~~ ✅ (#20) | `feature/input-intent-bus` |
| 2.6 | ~~Gesture: cursor + dwell~~ ✅ + playground เบื้องต้น | `feature/gesture-cursor-dwell` |
| 2.6a | ~~Stabilizer: ไม่ให้ skeleton กะพริบ~~ ✅ (#22) | `feature/perception-visibility-stability` |
| 2.6b | ~~Spike เทียบโมเดล → RTMPose-x~~ ✅ (#23, ADR-0007) | `spike/pose-model-comparison` |
| 2.6c | ~~Perception service (Python): กล้อง → RTMPose-x → WebSocket~~ ✅ (#25) | `feature/perception-server` |
| 2.6d | ~~Worker source `server` + fallback MediaPipe + preview ใน overlay~~ ✅ | `feature/perception-server-client` |
| 2.6e | ~~อัด fixtures ใหม่ด้วย RTMPose + replay test ชุดเดิม~~ ✅ (เกณฑ์ cursor แยกตามแหล่ง pose) | `test/rtmpose-fixtures` |
| 2.7 | Gesture: raise, raise-both | `feature/gesture-raise` |
| 2.8 | Gesture: throw | `feature/gesture-throw` |
| 2.9 | Gesture: slap | `feature/gesture-slap` |
| 2.10 | Gesture: draw | `feature/gesture-draw` |
| 2.11 | Gesture: swipe, lean, zoom (สำหรับฉากเสริม) | `feature/gesture-extended` |
| 2.12 | Gesture playground (หน้าทดสอบทุกท่า + แสดงค่า threshold สด) | `feature/debug-gesture-playground` |
| 2.13 | จูน threshold ด้วย replay → อัปเดต `config/gestures.ts` | `chore/gesture-tuning` |

**DoD**
- [ ] Replay suite ผ่านทั้งหมด: ทุกท่า detect ถูก, negative fixtures = 0 intent
- [ ] Dwell-select สำเร็จ ≥ 95% (ทดสอบคนจริง ≥ 5 คน)
- [ ] Mouse mode ใช้แทนได้ทุกท่า
- [ ] Tag `v0.2.0`

---

## Phase 3 — Core Experience

| # | งาน | Branch |
|---|---|---|
| 3.1 | Design tokens + ฟอนต์ self-host + global styles | `feature/hud-design-system` |
| 3.2 | Renderer: Three.js + postprocessing + adaptive resolution + background grid | `feature/render-core` |
| 3.3 | HUD: caption (typewriter), progress, profit counter, cursor, dwell ring, mini-skeleton | `feature/hud-components` |
| 3.4 | App state machine (XState) + paused/resume + staff hotkeys | `feature/core-app-machine` |
| 3.5 | Story schema (zod) + loader + template engine | `feature/narrative-schema` |
| 3.6 | Narrative Engine (beat runner) + tutorial ghost | `feature/narrative-engine` |
| 3.7 | SceneModule interface + scene manager + crossfade transition | `feature/scene-manager` |
| 3.8 | Scoring + CEO style + codename generator | `feature/scoring` |
| 3.9 | Watchdog + error recovery | `feature/core-watchdog` |
| 3.10 | Placeholder scenes เพื่อทดสอบ flow ครบรอบ | `feature/scene-placeholders` |
| 3.11 | E2E: Playwright + fake camera `.y4m` | `test/e2e-fake-camera` |

**DoD**
- [ ] เล่นได้ครบ attract → welcome → 5 ฉาก (placeholder) → outro → attract ด้วยร่างกาย
- [ ] เดินออกกลางคัน → paused → กลับมา resume / หายนาน → attract
- [ ] E2E ผ่านใน CI
- [ ] Tag `v0.3.0`

---

## Phase 4 — Scenes

แต่ละฉากทำตามลำดับเดียวกัน: **data (pipeline) → scene logic → visual → narrative → playtest**

| # | ฉาก | งานหลัก | Branch |
|---|---|---|---|
| 4.1 | Attract | Particle globe/ข้อความเชิญ | `feature/scene-attract` |
| 4.2 | Welcome | สอนชี้ + ยกมือ, แสดง codename | `feature/scene-welcome` |
| 4.3 | A — น้องคือลูกค้า | skeleton → particles, live data stream, heatmap | `feature/scene-a-you-are-data` |
| 4.4 | C — ตั้งราคากาแฟ | synth demand, live regression, particle customers | `feature/data-coffee` → `feature/scene-c-coffee-pricing` |
| 4.5 | D — แบ่งกลุ่มลูกค้า | synth RFM 10k, K-means ใน browser (animated), personas | `feature/data-segmentation` → `feature/scene-d-segmentation` |
| 4.6 | F — จับโกง | synth 1M transactions, slap game, โมเดลรันจริง + จับเวลา | `feature/data-fraud` → `feature/scene-f-fraud` |
| 4.7 | H — ทายยอดขาย 11.11 | synth sales 3 ปี, forecast model, draw vs AI | `feature/data-forecast` → `feature/scene-h-forecast` |
| 4.8 | Z — รายงาน CEO | summary, style, leaderboard, QR | `feature/scene-z-ceo-report` |

**DoD ต่อฉาก**
- [ ] 60 fps ตลอดฉาก
- [ ] ข้อมูลติดป้าย จริง/จำลอง, manifest + license ครบ
- [ ] Playtest ≥ 3 คน: เข้าใจโจทย์โดยไม่ต้องมีคนอธิบาย
- [ ] Design review ผ่าน
- [ ] Tag minor version ใหม่ทุกฉากที่เสร็จ

---

## Phase 5 — Polish

| # | งาน | Branch |
|---|---|---|
| 5.1 | ใส่เสียงจริง (จากที่คุณหามา) + license | `feature/audio-integration` |
| 5.2 | ปรับ transition ระหว่างฉาก, micro-interactions | `feature/polish-transitions` |
| 5.3 | Leaderboard ประจำวัน + reset อัตโนมัติ | `feature/storage-leaderboard` |
| 5.4 | Session stats + export (F9) | `feature/storage-session-stats` |
| 5.5 | Final copy pass บทพูดทั้งหมด (หลังคุณแก้) + ชื่อ AI | `content/story-final` |
| 5.6 | (ถ้ามีเวลา) ฉากเสริม B / E / G / I | `feature/scene-*` |

---

## Phase 6 — Hardening & Field

| # | งาน |
|---|---|
| 6.1 | Soak test 8 ชม. (replay วนอัตโนมัติ) |
| 6.2 | Playtest ใหญ่ ≥ 10 คน หลากหลายอายุ/ส่วนสูง → แก้ตาม feedback |
| 6.3 | Kiosk script + systemd + ปิด sleep/update |
| 6.4 | สำรวจสถานที่จริง: แสง, ระยะ, ตำแหน่งกล้อง, จอ |
| 6.5 | ซ้อมติดตั้ง (dress rehearsal) บนเครื่อง/จอจริง |
| 6.6 | คู่มือ staff 1 หน้า (`docs/STAFF_GUIDE.md`) + ป้าย privacy |
| 6.7 | Release `v1.0.0` |

### ท้ายโปรเจค (ตามที่เจ้าของงานกำหนด)

| # | งาน | หมายเหตุ |
|---|---|---|
| 6.8 | ทดลองแยกท่ามือ **กำ = ไม่มี cursor / ชี้นิ้ว = cursor** | ต้องใช้กล้อง 1080p + โมเดลมือแบบตัดภาพ; วัดความแม่นก่อนใช้ (เกณฑ์ ≥ 95%) — ดู [research 010](research/010-dwell-failures.md), [006](research/006-pose-model-spike.md) |

**DoD**
- [ ] ผ่าน checklist ก่อนวันงาน (ARCHITECTURE §16.4) ครบทุกข้อ
- [ ] Soak test ผ่าน
- [ ] Staff ที่ไม่ใช่ dev เปิด/ปิด/แก้ปัญหาพื้นฐานได้เองจากคู่มือ

---

## สิ่งที่ต้องได้จากคุณ (blocking)

| อะไร | ต้องการก่อน |
|---|---|
| กล้อง USB 1080p@60 | Phase 1 |
| ชื่อผู้ช่วย AI | Phase 5 (ใช้ `[AI_NAME]` ไปก่อน) |
| แก้บทพูดใน STORY.md | Phase 4 (ทีละฉาก) |
| ไฟล์เสียง effect | Phase 5 |
| URL หลักสูตรสำหรับ QR | Phase 4.8 |
| ข้อมูลสถานที่จัดงาน (ขนาดจอ, แสง) | Phase 6 |
