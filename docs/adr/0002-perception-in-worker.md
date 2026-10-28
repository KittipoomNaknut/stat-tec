# ADR-0002: แยก Pose inference ไปไว้ใน Web Worker

- **Status:** Accepted — พิสูจน์แล้วใน Phase 1 (2026-10-28) · inference ย้ายไป perception service ใน [ADR-0007](0007-perception-service-rtmpose.md); worker ยังทำ PlayerLock/filter และเป็น fallback MediaPipe
- **Date:** 2026-10-28

## Context

Pose inference ใช้เวลา ~15–25 ms ต่อเฟรม ถ้ารันบน main thread ร่วมกับ render (งบ 16.7 ms/เฟรม) จะทำให้ fps ตกและภาพกระตุก

## Decision

รัน MediaPipe PoseLandmarker + PlayerLock + Filter + Normalizer ใน **Web Worker**
ส่ง `VideoFrame`/`ImageBitmap` เข้า worker แบบ transfer (zero-copy) และรับ `PoseFrame` กลับ
Render loop บน main thread ใช้ PoseFrame ล่าสุดเสมอ (ไม่รอ inference)

## Consequences

**ดี**
- Render 60 fps ได้อิสระจากความเร็ว inference
- Inference ช้าชั่วคราว = cursor หน่วงนิดหน่อย ไม่ใช่ภาพทั้งจอกระตุก

**ต้องระวัง**
- GPU delegate ใน worker ต้องใช้ WebGL ใน worker (OffscreenCanvas) — ต้องทดสอบว่าเสถียรบน Chromium/Linux/NVIDIA
- ต้องจัดการ worker crash/respawn (ARCHITECTURE §14)

## Fallback

ถ้า Phase 1 พบว่าใช้ไม่ได้: รัน inference บน main thread แบบ async ทุกเฟรมเว้นเฟรม + ลด render budget แล้วบันทึกผลเป็น ADR ใหม่ที่ supersede ฉบับนี้

## Result (Phase 1)

พิสูจน์บน Chrome 156 / Linux / RTX 4060 Laptop:

- `PoseLandmarker` ด้วย **GPU delegate ทำงานใน module worker** ได้ (ใช้ WASM แบบ ES module เพราะ module worker ไม่มี `importScripts`)
- เฟรมไหลจาก `MediaStreamTrackProcessor` → `ReadableStream` ที่ transfer เข้า worker — main thread ไม่แตะภาพ
- Render 60+ fps (165 fps บนจอโน้ตบุ๊ก) ขณะ inference 30 fps; worker → main thread < 1 ms นอกเหนือจาก inference
- ตัวเลขเต็ม: [docs/benchmarks/phase1.md](../benchmarks/phase1.md)

ไม่ต้องใช้ fallback
