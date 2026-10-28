# ADR-0005: ใช้ PoseLandmarker `heavy` เป็นโมเดลหลัก

- **Status:** Superseded by [ADR-0007](0007-perception-service-rtmpose.md) (RTMPose-x เป็นหลัก) — heavy ยังเป็นโมเดลของ fallback MediaPipe
- **Date:** 2026-10-28

## Context

MediaPipe PoseLandmarker มี 3 ขนาด (`lite` 5.8 MB, `full` 9.4 MB, `heavy` 30.7 MB) แลกระหว่างความแม่นกับความเร็ว
ผู้ใช้เห็น skeleton สั่นมากในการทดสอบแรก และเครื่องเป้าหมายมี RTX 4060

## Decision

ใช้ **`heavy`** เป็นค่า default (`config/perception.ts`) — เปลี่ยนได้ด้วย `?model=` เพื่อทดสอบ

## Evidence

จาก [Phase 1 benchmark](../benchmarks/phase1.md) (ยืนนิ่ง 2 m, 457 เฟรม/โมเดล):

| Model | Inference avg / p95 | Jitter raw → filtered |
|---|---|---|
| lite | 14.9 / 22.2 ms | 5.78 → 0.77 px |
| full | 15.6 / 20.8 ms | 5.34 → 0.71 px |
| heavy | 16.9 / **18.8 ms** | **4.56 → 0.58 px** |

heavy นิ่งที่สุดและ p95 ต่ำสุด แลกกับเวลาเฉลี่ยเพิ่มแค่ ~2 ms เพราะเวลาส่วนใหญ่เป็นค่าใช้จ่ายคงที่ของ pipeline

## Consequences

- โหลดโมเดลตอนเริ่มนานขึ้นเล็กน้อย (30 MB, อยู่ในเครื่อง ไม่ผ่านเน็ต)
- **ต้องวัดซ้ำกับกล้อง 60 fps:** งบต่อเฟรมจะเหลือ 16.7 ms ซึ่ง p95 ของ heavy (18.8 ms) เกิน — ถ้าไม่ผ่าน ทางเลือกคือ (1) ลดค่าใช้จ่ายคงที่ของ pipeline, (2) รับ inference 30 fps แต่ render 60 fps (interpolate), (3) กลับไปใช้ `full`

## Alternatives considered

- **`full` / `lite`** — เร็วกว่าเล็กน้อยแต่สั่นกว่า ไม่คุ้ม
- **โมเดลนอก MediaPipe (RTMPose/RTMW ผ่าน ONNX + WebGPU)** — แม่นกว่าต่อภาพ แต่ไม่มี temporal tracking (สั่นกว่าถ้าไม่กรอง), ต้องมี person detector แยก, latency และงานเพิ่มมาก → เก็บเป็นแผนสำรองถ้า playtest พบว่าความแม่นไม่พอ
