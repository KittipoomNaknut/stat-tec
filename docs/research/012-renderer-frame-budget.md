# 012 — Renderer: frame budget, backdrop blur และจอ 4K

- **วันที่:** 2026-10-29 · **สถานะ:** สรุปแล้ว (4K ต้องวัดซ้ำบนเครื่องหน้างาน)
- **เกี่ยวข้อง:** `app/src/render/{renderer,stage,adaptive-resolution}.ts` · `app/src/config/render.ts` · ARCHITECTURE §11.1

## คำถาม

Stage WebGL (พื้นกริด + ฝุ่น + bloom/SMAA/vignette/noise) กับ HUD แบบ DOM ซ้อนกันแล้วยังได้ 60 fps ไหม

## วิธีวัด

Chrome headless + `--use-angle=vulkan` (ได้ GPU จริง: RTX 4060 Laptop) · เปิด `?styleguide` · เก็บช่วงห่าง requestAnimationFrame 300 เฟรม → median / p95 (60 Hz ปกติ = 16.7)

## การทดลอง

### รอบที่ 1 — stage อย่างเดียว vs มี HUD (panel ใช้ `backdrop-filter: blur(12px)` ตาม ARCHITECTURE)

| จอ        | ฉาก              | median   | p95                 |
| --------- | ---------------- | -------- | ------------------- |
| 1920×1080 | stage อย่างเดียว | 16.7     | 16.8                |
| 1920×1080 | + HUD (blur)     | 16.7     | **33.4** ← เฟรมหลุด |
| 1920×1080 | + HUD ไม่มี blur | 16.7     | 16.8                |
| 3840×2160 | + HUD (blur)     | **83.3** | 83.4 ← 12 fps       |
| 3840×2160 | + HUD ไม่มี blur | 33.3     | 33.4                |

**สาเหตุ:** blur ต้องอ่าน canvas WebGL ข้างหลังทุกเฟรมแล้วเบลอใหม่ — ทุก panel × ทุกเฟรม
**แก้:** เลิกใช้ `backdrop-filter`; panel เป็นสีทึบขึ้น (`rgb(10 28 58 / 78%)`) + ไล่แสงด้านบน + มุมวงเล็บ → บนพื้นมืดยังดูเป็นกระจก · กล่องบทพูดใช้ 90% เพราะเส้นกริดวิ่งผ่านหลังตัวอักษร

### รอบที่ 2 — 4K ช้าเพราะอะไร

| 3840×2160                        | p95                |
| -------------------------------- | ------------------ |
| internal 1440p + HUD             | 33.4               |
| internal 1080p + HUD             | 33.4               |
| internal 1080p, stage อย่างเดียว | 33.4 (median 16.7) |
| internal 720p, stage อย่างเดียว  | 33.4 (median 16.7) |
| หน้าเปล่า (ไม่มี canvas)         | 16.7               |

ลด internal resolution แล้ว**ไม่ดีขึ้นเลย** → คอขวดไม่ใช่การเรนเดอร์ของเรา แต่เป็นการ composite canvas 4K ใน headless (Chrome log "GPU stall due to ReadPixels" — headless อ่านภาพกลับทุกเฟรม) → **ตัวเลข 4K จาก headless เชื่อไม่ได้** ต้องวัดบนเครื่อง kiosk แบบเปิดหน้าต่างจริง

### รอบที่ 3 — หน้าตา stage

รอบแรกมืดและแบนเกิน (เส้นไม่ถึงเกณฑ์ bloom) → เส้นหลักสว่าง 1.6× (HDR, half-float buffer) ให้ bloom จับ, ฝุ่น 1400 → 2200 จุด, เพิ่มคลื่นสแกนวิ่งเข้าหาผู้ชมทุก 7 วินาที และแสงหลังตรงกลางจอ (หายใจช้า ๆ) — ยัง 16.7 / 16.8

![stage](assets/012-stage.png)

## ข้อสรุป

- HUD **ห้ามใช้ `backdrop-filter`** บนฉากที่มี WebGL (เครื่องมือ debug ยังใช้ได้ เพราะไม่มี canvas ข้างหลัง)
- Adaptive resolution ตัดสินจาก **ช่วงห่างของเฟรม** (p95 > 20 ms = เฟรมหลุด) แทน "frame time > 15 ms" ใน ARCHITECTURE — เวลา GPU วัดไม่ได้ถ้าไม่มี timer query; ลดทีละ 10% (ต่ำสุด 0.6), ขึ้นเมื่อว่างต่อเนื่อง และรอนานขึ้นเท่าตัวทุกครั้งที่ต้องลด (กันขึ้น–ลงสลับไปมา) — unit test 4 กรณี
- เพดาน internal resolution 1440p ปรับหน้างานได้ด้วย `?maxh=1080`
- stage ทั้งหมดเคลื่อนใน shader จาก uniform เวลาเดียว → ไม่มี allocation / upload ต่อเฟรม

## ข้อจำกัด / ต้องทดสอบต่อ

- วัด 4K บนทีวี + เครื่องจริงแบบ headful (Phase 6)
- เพิ่มฉาก 3D จริงใน Phase 4 แล้ววัดซ้ำ
