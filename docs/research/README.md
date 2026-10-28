# Research log — สมุดบันทึกการทดลอง

ทุกครั้งที่ตรวจปัญหา จูนค่า หรือเลือกระหว่างทางเลือก ให้บันทึกที่นี่ **ระหว่างทำ** ไม่ใช่ทีหลัง
หนึ่งไฟล์ต่อหนึ่งการทดลอง ตั้งเลขต่อกัน (`NNN-หัวข้อ.md`) และ commit ไปกับ PR ที่เกี่ยวข้อง

> บันทึก 001–009 เขียนย้อนหลังจาก PR / ADR / ผลวัดที่เก็บไว้ (2026-10-28) — ตัวเลขทุกตัวมาจากแหล่งที่อ้างอิง ไม่ได้เขียนจากความจำ

## สารบัญ

| # | หัวข้อ | ข้อสรุป | อ้างอิง |
|---|---|---|---|
| [001](001-mediapipe-model-benchmark.md) | Benchmark MediaPipe lite / full / heavy | heavy นิ่งสุด, ช้ากว่า lite ~2 ms → ใช้ heavy | PR #9, #11, ADR-0005 |
| [002](002-one-euro-filter.md) | ตัวกรอง One Euro | jitter ตอนนิ่ง ↓ ~87% (heavy 4.56 → 0.58 px) | PR #8, #9 |
| [003](003-player-lock-ghosts.md) | PlayerLock กับ "ผี" ของ MediaPipe | ตัดสินซ้ำด้วย box containment + scale EMA; ผีไม่นับเป็นคนอื่น | PR #16, #19 |
| [004](004-cursor-rules-v1.md) | เกณฑ์ cursor รอบแรก | เริ่มยาก–ค้างง่าย; เกาหัวไม่ติด, มือห้อยไม่แย่ง | PR #21 |
| [005](005-skeleton-flicker-stabilizer.md) | เส้น skeleton กะพริบ | smoothing + hysteresis + hold: 27–76 → 0–6 ครั้ง/คลิป | PR #22 |
| [006](006-pose-model-spike.md) | เทียบโมเดล MediaPipe / RTMPose / RTMW | RTMPose-x นิ่งกว่า ~6 เท่า → ADR-0007 | PR #23, ADR-0007 |
| [007](007-rtmpose-performance.md) | ทำ RTMPose ให้ทัน 30 fps | MJPEG + YOLOX-m + TensorRT FP16 → 7.5 ms avg | PR #23, #25 |
| [008](008-onnxruntime-cpu-overwrite.md) | ONNX Runtime CPU ทับตัว GPU | ตัด `onnxruntime` ออก + service ไม่ยอมเริ่มถ้าไม่อยู่บน TensorRT | PR #25 |
| [009](009-cursor-rtmpose-calibration.md) | Cursor กับ RTMPose: กอดอก, แขนตรง, เกณฑ์แยกตามแหล่ง | กฎแขนตรง; RTMPose 0.8 / MediaPipe 0.7 | PR #27 |
| [010](010-dwell-failures.md) | ทำไมปุ่มบางครั้งไม่ติด | *กำลังทำ* | – |

## แม่แบบ

```markdown
# NNN — หัวข้อ

- **วันที่:** YYYY-MM-DD · **สถานะ:** กำลังทำ | สรุปแล้ว | ยกเลิก
- **เกี่ยวข้อง:** PR / ADR / ไฟล์

## คำถาม / สมมติฐาน
สงสัยอะไร คาดว่าเป็นเพราะอะไร

## ข้อมูลที่ใช้
session / กล้อง / สภาพแวดล้อม / ไฟล์ข้อมูลดิบ

## การทดลอง
### รอบที่ 1 — ปรับอะไร
ผลวัด (ตัวเลข) → พอใจไหม เพราะอะไร
### รอบที่ 2 — ...

## ทางเลือกที่ไม่เลือก
อะไร และทำไม

## ข้อสรุป
## ข้อจำกัด / ต้องทดสอบต่อ
```
