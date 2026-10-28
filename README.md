# STAT_TEC — CEO 5 นาที 💼

ประสบการณ์ **Data Science แบบควบคุมด้วยร่างกาย** สำหรับงาน Open House
ผู้เล่นยืนหน้าจอใหญ่ กลายเป็น CEO และตัดสินใจทางธุรกิจด้วยข้อมูล ผ่านท่าทาง — ไม่มีเมาส์ ไม่มีคีย์บอร์ด

> สถานะ: 🚧 Phase 0 — วางรากฐาน

## Highlights

- 🖐️ **Computer Vision** — MediaPipe Pose จับร่างกาย 33 จุด แบบ real-time บน GPU
- 📊 **Data Storytelling** — 5 ฉากธุรกิจ: Pricing, Clustering, Fraud Detection, Forecasting
- ⚡ **60 fps** — inference แยก Web Worker, render ด้วย Three.js
- 🔒 **Privacy-first** — ไม่บันทึกภาพ ทุกอย่างประมวลผลในเครื่อง offline

## Documentation

| เอกสาร | เนื้อหา |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | สถาปัตยกรรมระบบแบบละเอียด |
| [Roadmap](docs/ROADMAP.md) | แผนงานแบ่ง Phase + Definition of Done |
| [Story](docs/STORY.md) | โครงเรื่องและบทพูด |
| [Contributing](docs/CONTRIBUTING.md) | Git workflow, commit, PR |
| [ADRs](docs/adr/) | บันทึกการตัดสินใจทางสถาปัตยกรรม |

## Quick start

> จะเพิ่มหลัง Phase 0 เสร็จ

```bash
docker compose --profile dev up      # dev server
docker compose up -d                 # production serve (127.0.0.1:8080)
./scripts/kiosk.sh                   # เปิด Chromium kiosk
```

## Requirements

- Linux + NVIDIA GPU (พัฒนาบน RTX 4060 Laptop)
- USB webcam 1080p@60
- Docker + Docker Compose, Chromium
