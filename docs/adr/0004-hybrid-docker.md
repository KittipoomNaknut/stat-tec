# ADR-0004: Docker แบบผสม — เบราว์เซอร์ kiosk รันบน host

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

ต้องการสภาพแวดล้อมที่ทำซ้ำได้ (reproducible) ด้วย Docker แต่แอปต้องเข้าถึง **กล้อง + GPU + จอ** ผ่านเบราว์เซอร์
การรัน Chromium ใน container ต้อง passthrough `/dev/video*`, NVIDIA (nvidia-container-toolkit) และ X11/Wayland — เปราะบาง, debug ยากหน้างาน, อาจเพิ่ม latency

## Decision

| ส่วน | รันที่ |
|---|---|
| Data pipeline (Python) | Docker |
| Dev server, test, build, CI | Docker |
| เสิร์ฟ static build (nginx) | Docker, bind `127.0.0.1:8080` |
| **Chromium kiosk + กล้อง + GPU** | **Host โดยตรง** (systemd user service) |

## Consequences

**ดี**
- Dependency ของ Node/Python ทำซ้ำได้ทุกเครื่อง
- ส่วนที่เสี่ยงที่สุด (กล้อง/GPU) ไม่มีชั้น container คั่น → เสถียรและเร็วที่สุด
- หน้างาน: `docker compose up -d` + `systemctl --user start stat-tec-kiosk`

**ต้องระวัง**
- เครื่องหน้างานต้องติดตั้ง Chromium + NVIDIA driver บน host (บันทึกใน STAFF_GUIDE)
