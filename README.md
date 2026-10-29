# STAT_TEC — STAT WARS: Data Awakens ✨

ประสบการณ์ **Data Science แบบควบคุมด้วยร่างกาย** สำหรับงาน Open House ภาควิชาสถิติประยุกต์
ผู้เล่นยืนหน้าจอใหญ่ กลายเป็น CEO คนใหม่ แล้วตัดสินใจทางธุรกิจด้วยข้อมูลผ่านท่าทาง ไม่มีเมาส์ ไม่มีคีย์บอร์ด

> สถานะ: 🚧 Phase 4 (ฉากจริง) — EPISODE II–V เสร็จและลองสดแล้ว · ฉาก A ยังเป็นฉากชั่วคราว · release ล่าสุด `v0.3.0`

## Highlights

- 🖐️ **Computer Vision** — RTMPose-x บน TensorRT (perception service บน GPU ของเครื่อง, 30 fps) · MediaPipe ในเบราว์เซอร์เป็นตัวสำรอง
- 🎯 **ควบคุมด้วยร่างกาย** — ชี้ / ชี้ค้าง / ยกมือ / ปัด / วาด · cursor ผ่าน smoothing + precision ([research 015](docs/research/015-cursor-smoothing.md), [022](docs/research/022-cursor-precision.md))
- 📊 **Data Storytelling** — ทุกตัวเลขบนจอมาจากโมเดลจริงในเบราว์เซอร์

  | ตอน         | เรื่อง             | แนวคิด                               |
  | ----------- | ------------------ | ------------------------------------ |
  | EPISODE II  | ศึกราคากาแฟ        | Regression                           |
  | EPISODE III | สามกลุ่มแห่งลูกค้า | K-means + Elbow                      |
  | EPISODE IV  | จับโกงข้ามกาแล็กซี | Anomaly Detection (1,000,000 รายการ) |
  | EPISODE V   | พยากรณ์ 11.11      | Time-Series Forecasting              |

- ⚡ **60 fps** — วัดทั้งบทบน GPU จริง · Three.js + canvas
- 🔒 **Privacy-first** — ไม่บันทึกภาพ ทุกอย่างประมวลผลในเครื่อง offline

## Documentation

| เอกสาร                                  | เนื้อหา                                                 |
| --------------------------------------- | ------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)    | สถาปัตยกรรมระบบแบบละเอียด                               |
| [Roadmap](docs/ROADMAP.md)              | แผนงานแบ่ง Phase + Definition of Done                   |
| [Story](docs/STORY.md)                  | โครงเรื่องและบทพูด                                      |
| [Contributing](docs/CONTRIBUTING.md)    | Git workflow, commit, PR                                |
| [ADRs](docs/adr/)                       | บันทึกการตัดสินใจทางสถาปัตยกรรม                         |
| [Benchmarks](docs/benchmarks/phase1.md) | ผลวัดโมเดลและ pipeline                                  |
| [Research log](docs/research/README.md) | บันทึกทุกการทดลองและการจูน (สมมติฐาน → ผลวัด → ข้อสรุป) |
| [Changelog](CHANGELOG.md)               | การเปลี่ยนแปลงแต่ละเวอร์ชัน                             |

## Quick start

```bash
# 1. Pose service on the host GPU (owns the camera) — see perception-server/README.md
cd perception-server && uv sync --extra gpu && uv run --extra gpu stat-tec-perception

# 2. App
docker compose --profile dev up dev            # dev server → http://127.0.0.1:5173
docker compose --profile data run --rm pipeline # build scene data → app/public/data
docker compose up -d web                       # production → http://127.0.0.1:8080
./scripts/kiosk.sh                             # Chromium kiosk (Phase 6)
```

Without the service the app falls back to MediaPipe in the browser automatically
(`?perception=mediapipe` forces it). Without Docker: `cd app && pnpm install && pnpm dev` / `cd data-pipeline && uv sync && uv run stat-tec-pipeline build`

### Dev / review

| URL / ปุ่ม                                            | ใช้ทำอะไร                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `?chapter=coffee` · `segments` · `fraud` · `forecast` | กระโดดเข้าบทนั้นทันทีเมื่อเริ่มเล่น                          |
| `?playground`                                         | ลองชี้ / ชี้ค้างปุ่ม 1–6 · **F9** ดาวน์โหลด session ไว้วัดผล |
| `?player=synthetic`                                   | ร่างกายสังเคราะห์ (E2E) ไม่ใช้กล้อง                          |
| **F2**                                                | สลับเป็นเมาส์ (คลิก = ชี้ค้าง, ลาก = วาด, สะบัด = ตบ)        |
| **F1**                                                | overlay debug (โครงกระดูก, กล้อง, สถานะ service)             |
| **F5**                                                | รีเซ็ตกลับหน้า attract                                       |
| `?styleguide` · `?debug` · `?bench` · `?record`       | ชิ้นส่วน HUD · overlay โครงกระดูก · benchmark · อัด fixture  |

## Requirements

- Linux + NVIDIA GPU + driver (พัฒนาบน RTX 4060 Laptop) — สำหรับ perception service
- USB webcam 1080p@60
- Docker + Docker Compose, Chromium

## License

Copyright © 2026 Kittipoom. **All rights reserved** — viewable only; see [LICENSE](LICENSE).
Third-party components keep their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
