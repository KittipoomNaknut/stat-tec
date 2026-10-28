# 006 — เทียบโมเดล MediaPipe / RTMPose / RTMW

- **วันที่:** 2026-10-28 · **สถานะ:** สรุปแล้ว → [ADR-0007](../adr/0007-perception-service-rtmpose.md)
- **เกี่ยวข้อง:** PR #23 · [spikes/pose-models](../../spikes/pose-models/README.md)

## คำถาม / สมมติฐาน
เจ้าของงานต้องการ "ติดตลอด แม่น คม นิ่ง" และถามว่าเครื่องแรงขนาดนี้ใช้โมเดลโหดกว่าได้ไหม
สมมติฐาน: โมเดลที่แม่นกว่า (RTMPose / RTMW จาก OpenMMLab) ให้ skeleton ดีกว่า — แต่ต้องวัดหลังผ่าน filter ของแอป เพราะความนิ่งอาจมาจาก filter มากกว่าโมเดล

## ข้อมูลที่ใช้
กล้องเดียวกัน เฟรมเดียวกัน, เจ้าของงานยืน, เก็บแค่ keypoints (ไม่บันทึกภาพ)

## การทดลอง
### รอบที่ 1 — `compare_live.py` ทั้ง 3 โมเดลพร้อมกัน
jitter ทุกตัว 16–23 px (สูงกว่า browser หลายเท่า), RTMW flips 0, MediaPipe ซ่อน 23–26%
→ **ตัดสินไม่ได้**: (1) รันต่อกันได้ ~10 fps, (2) ไม่ได้ผ่าน filter ของแอป, (3) MediaPipe Python รันบน CPU
(ข้อสังเกต: ตัวเลข ms ของ test1/test2 ที่เจ้าของงานส่งมาตรงกันทุกตัว ทั้งที่ jitter ต่าง)

### รอบที่ 2 — `guided.py` ทีละโมเดล + port filter/stabilizer ของแอป
ทุกตัวได้ **10.3 fps** → ไล่หาสาเหตุ: OpenCV เปิดกล้องแบบ YUYV (ดู [007](007-rtmpose-performance.md))
ผล (ที่ 10 fps): RTMPose jitter 3.67 → 1.98, MediaPipe 25.95 → 23.15, RTMPose p95 61 ms

### รอบที่ 3 — แก้เป็น MJPEG 30 fps + TensorRT แล้ววัดใหม่
| | MediaPipe (CPU ใน Python) | **RTMPose-x** | RTMW-x |
|---|---|---|---|
| jitter raw → filtered | 10.09 → 8.87 px | 4.29 → **1.45** | 5.09 → 1.29 |
| flips raw → stabilized | 3.8 → 1.3 | 8.7 → **0.0** | 0.0 → 0.0 |
| ซ่อนตอนขยับ | 36% | **3%** | 0% |
| ms avg / p95 | 35.9 / 39.6 | **7.5 / 25.3** | 7.7 / 25.5 |
| ซ่อนมือไว้หลังตัวแล้ว "ยังเห็น" | 0% | 100% | 100% |
| ปลายนิ้วชี้ (RTMW) | – | – | 59 → 28.5 px |

เจ้าของงานดูเทียบด้วยตาแล้วชอบ RTMPose / RTMW → เลือก **RTMPose-x**

## ทางเลือกที่ไม่เลือก
- RTMW: นิ่งพอ ๆ กัน แต่นิ้ว (ข้อดีหลัก) สั่น 28 px ที่ 2 m / 720p
- ONNX Runtime Web + WebGPU ในเบราว์เซอร์: ไม่มี TensorRT, ช้ากว่ามาก
- MediaPipe Python + GPU: ไม่มี GPU delegate บน Linux (ทดสอบแล้ว error `kGpuService`)

## ข้อสรุป
RTMPose-x ผ่าน perception service (Python, GPU) + MediaPipe ในเบราว์เซอร์เป็น fallback

## ข้อจำกัด / ต้องทดสอบต่อ
- RTMPose ไม่ยอมรับว่ามองไม่เห็น (ข้อมือที่ซ่อนได้ score 0.45–0.85) → gesture ต้องไม่พึ่ง score อย่างเดียว
- คนเดียว ห้องเดียว เว็บแคมในตัว
