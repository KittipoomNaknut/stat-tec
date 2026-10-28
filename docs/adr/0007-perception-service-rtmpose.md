# ADR-0007: Pose inference ย้ายไป Perception Service (RTMPose-x บน GPU) — MediaPipe เป็นทางสำรอง

- **Status:** Accepted
- **Date:** 2026-10-28
- **Supersedes:** ส่วน "inference ในเบราว์เซอร์" ของ [ADR-0002](0002-perception-in-worker.md) และ [ADR-0005](0005-pose-model-heavy.md) (โครง worker / PlayerLock / filter ยังใช้ต่อ)

## Context

เจ้าของงานทดลองเล่นแล้วบอกว่า skeleton จาก MediaPipe heavy "หลุด ๆ ติดบ้างไม่ติดบ้าง ไม่แม่น" และต้องการ "ติดตลอด แม่น คม นิ่ง"
หลังแก้การกะพริบฝั่งแสดงผลแล้ว (PR #22) ได้ทำ spike เทียบโมเดลบนกล้องเดียวกัน ([spikes/pose-models](../../spikes/pose-models/README.md), PR #23):

| (30 fps, ผ่าน filter ของแอปแล้ว) | MediaPipe heavy | **RTMPose-x** |
|---|---|---|
| jitter ตอนยืนนิ่ง | 8.87 px | **1.45 px** |
| กะพริบตอนขยับ | 1.3 | **0** |
| ส่วนที่หายตอนขยับ | 36% | **3%** |
| inference (avg / p95) | 17 ms (browser GPU) | **7.5 / 25.3 ms** |

เจ้าของงานดูทั้งสามโมเดลเทียบกันแล้วเลือก RTMPose-x

RTMPose ไม่มีเวอร์ชันที่รันในเบราว์เซอร์ได้เร็วพอ — ใช้ ONNX Runtime + TensorRT บน GPU ของเครื่อง (RTX 4060)

## Decision

### 1. Perception Service (`perception-server/`, Python)

```
USB camera (MJPEG 720p30)
  → YOLOX-m (CUDA, ทุก 7 เฟรม) + RTMPose-x 384×288 (TensorRT FP16, ทุกเฟรม), สูงสุด 3 คน
  → แปลง COCO-17 → layout 33 จุดของแอป, visibility = clamp(score, 0, 1)
  → WebSocket 127.0.0.1:8765 (binary)
```

- **Raw detections เท่านั้น** — PlayerLock, stabilizer, One Euro, body space, gestures ยังอยู่ฝั่งแอป (ทดสอบไว้แล้ว ไม่ต้องเขียนใหม่ใน Python)
- จุดที่ COCO-17 ไม่มี (นิ้ว, ส้นเท้า, ปลายเท้า, ตาใน/นอก) ส่ง visibility = 0
- `visibility = clamp(score, 0, 1)`: วัดแล้ว score ของ RTMPose อยู่ช่วงเดียวกับ MediaPipe visibility (จุดที่เห็นชัด 0.5–1.05) → threshold เดิมของ PlayerLock / stabilizer / cursor ใช้ได้
- รันบน **host** (ไม่ใช่ Docker) ด้วย `uv` + systemd user unit — เหตุผลเดียวกับ [ADR-0004](0004-hybrid-docker.md): ต้องเข้าถึงกล้องและ GPU โดยตรง
- Bind เฉพาะ `127.0.0.1`; ภาพกล้องไม่ออกจากเครื่อง

### 2. ฝั่งแอป

- Perception worker มี 2 source: **`server`** (default — รับ raw detections ทาง WebSocket ใน worker) และ **`mediapipe`** (เดิม)
- ถ้าเชื่อม server ไม่ได้ตอนเริ่ม → **fallback เป็น MediaPipe อัตโนมัติ** และ overlay แสดง source ที่ใช้อยู่; บังคับได้ด้วย `?perception=server|mediapipe`
- `PoseDetections` และรูปแบบไฟล์อัด (`*.pose.json.gz`) **ไม่เปลี่ยน** → recorder, replay test, overlay ใช้ต่อได้

### 3. ภาพกล้องสำหรับ debug

กล้องเปิดได้ทีละโปรแกรม (ทดสอบแล้ว: process ที่สองเปิดไม่ได้) → เมื่อใช้ server เบราว์เซอร์เปิดกล้องเองไม่ได้
Debug overlay ขอภาพตัวอย่าง (JPEG ย่อ ~10 fps) จาก server เฉพาะตอนเปิด F1 — ไม่ส่งเมื่อไม่ขอ

## Consequences

**ดี**
- skeleton นิ่งขึ้น ~6 เท่า, แทบไม่หาย — ตรงกับที่เจ้าของงานต้องการ
- inference เร็วขึ้น (7.5 ms) — งบเหลือสำหรับกล้อง 60 fps ในอนาคต (ตัวหาคนต้องย้ายไปรันขนาน)
- โค้ดฝั่งแอปที่ทดสอบแล้วใช้ต่อได้เกือบทั้งหมด

**ต้องระวัง / ต้องทำ**
- **เพิ่ม service ที่ต้องดูแลหน้างาน** — systemd `Restart=always`, health check, fallback MediaPipe
- **RTMPose ไม่ยอมรับว่ามองไม่เห็น:** ข้อมือที่ซ่อนหลังตัวยังได้ score 0.45–0.85 → ห้ามใช้ score อย่างเดียวตัดสินว่ามือ "อยู่" — gestures ต้องพึ่งกฎเชิงท่าทาง (cursor: ยกสูง + แขนเหยียด) และต้องยืนยันด้วย replay จาก session ใหม่
- **ต้องอัด fixtures ใหม่ด้วย RTMPose** แล้วรัน replay test ชุดเดิม; fixtures ของ MediaPipe เก็บไว้ทดสอบ fallback
- TensorRT engine ถูกสร้างครั้งแรก (~1 นาที) → cache ไว้ในเครื่อง; เปลี่ยนเวอร์ชัน TensorRT/ORT = สร้างใหม่
- ต้องใช้ NVIDIA GPU + driver บนเครื่องหน้างาน (เครื่องเป้าหมายมี)
- เวอร์ชันที่ต้อง pin ให้เข้ากัน: onnxruntime-gpu 1.31.0 ↔ TensorRT **10** (`tensorrt-cu13==10.16.1.11`) ↔ CUDA 13 wheels

## Alternatives considered

| ทางเลือก | เหตุผลที่ไม่เลือก |
|---|---|
| คง MediaPipe + จูน filter ต่อ | jitter หลังกรองยังสูงกว่า RTMPose ~6 เท่า; ส่วนที่หายตอนขยับ 36% (filter แก้ไม่ได้) |
| RTMW-x (133 จุด รวมนิ้ว) | นิ่งพอ ๆ กัน แต่นิ้วสั่น 28 px ที่ 2 m / 720p → ประโยชน์หลักยังใช้ไม่ได้; เก็บไว้พิจารณาเมื่อได้กล้อง 1080p |
| ONNX Runtime Web + WebGPU ในเบราว์เซอร์ | ไม่มี TensorRT, ต้องมีตัวหาคนแยก, ช้ากว่ามาก |
| ใส่ perception service ใน Docker | ต้องส่งต่อกล้อง + GPU เข้า container — เปราะหน้างาน (ADR-0004) |
