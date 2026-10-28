# ADR-0006: Kiosk ใช้ Google Chrome (.deb) ล็อกเวอร์ชัน — พิจารณา Electron ใน Phase 6

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

Pipeline ภาพของเรา ([ADR-0002](0002-perception-in-worker.md)) ใช้ `MediaStreamTrackProcessor` บน window เพื่อส่งเฟรมกล้องเข้า worker โดยไม่ผ่าน main thread
ระหว่างทดสอบ เปิดใน Firefox แล้วใช้ไม่ได้ — Firefox ไม่มี API นี้บน window

ตัวเลือกที่พิจารณา:

| ตัวเลือก | Engine | ผล |
|---|---|---|
| Google Chrome (.deb) | Chromium | ✅ ทดสอบผ่าน, GPU/codec ดีสุด, มีบนเครื่องแล้ว — แต่อัปเดตตัวเอง |
| Electron | Chromium (ฝังในแอป) | ✅ ล็อกเวอร์ชันตายตัว, เป็นแอป kiosk จริง — แต่เพิ่มงาน packaging |
| Chromium (Ubuntu) | Chromium | ⚠️ มีแต่ Snap → ปัญหาสิทธิ์กล้อง/GPU บ่อย |
| Edge / Brave | Chromium | ใช้ได้แต่ไม่มีข้อดีเพิ่ม |
| Firefox | Gecko | ❌ ไม่มี `MediaStreamTrackProcessor` บน window |
| Tauri (Linux) | WebKitGTK | ❌ ไม่มี API ส่งเฟรม, WebGL อ่อนกว่า |

## Decision

- รองรับเฉพาะ **Chromium-based**; แอปตรวจ `MediaStreamTrackProcessor` ตอนเริ่มและแสดง error ชัดเจนถ้าไม่มี — **ไม่ทำ fallback**
- เครื่องหน้างานใช้ **Google Chrome แบบ .deb** และ **ล็อกเวอร์ชันที่ทดสอบผ่าน** (`apt-mark hold google-chrome-stable`, ปิด auto-update)
- ประเมิน **Electron** อีกครั้งใน Phase 6 (Hardening) — โค้ดย้ายได้ทันทีเพราะเป็น engine เดียวกัน

## Consequences

- หน้างานต้องมีขั้นตอนตรวจเวอร์ชัน Chrome ใน checklist (ARCHITECTURE §16.4)
- Dev ต้องเปิดใน Chrome เท่านั้น
- ถ้าต้องรองรับเบราว์เซอร์อื่นในอนาคต: เพิ่ม fallback ส่ง `ImageBitmap` จาก main thread (ช้ากว่า)
