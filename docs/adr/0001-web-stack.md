# ADR-0001: ใช้ Web stack (TypeScript + Three.js) รันใน Chromium

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

ต้องการระบบที่ สวย (กราฟ/ภาพระดับสูง) ลื่น (60 fps) และจับท่าทางแม่นยำ บนเครื่อง Linux + NVIDIA RTX 4060
ทางเลือกหลักคือ (1) Web ใน Chromium, (2) Python (OpenCV + pygame/PyQt), (3) Game engine (Unity/Godot)

## Decision

ใช้ **TypeScript + Vite + Three.js + MediaPipe Tasks Vision** รันใน **Chromium kiosk mode**

## Consequences

**ดี**
- MediaPipe มี GPU delegate บนเว็บ, เร็วพอ 30+ fps
- Ecosystem visualization บนเว็บ (Three.js, shader, GSAP) แข็งแรงที่สุดสำหรับงานกราฟข้อมูล
- ข้อความไทยแสดงผลถูกต้องผ่าน DOM
- Debug ง่ายด้วย DevTools, CI/E2E ด้วย Playwright + fake camera

**ต้องระวัง**
- ต้องจัดการ performance เอง (zero-allocation, worker, adaptive resolution)
- ต้อง bundle model/WASM/font ไว้ในเครื่องเพื่อทำงาน offline

## Alternatives

- **Python + pygame/PyQt** — ทำ visualization 3D สวยระดับเดียวกันยากกว่ามาก, GUI ไทยมีปัญหาบ่อยกว่า
- **Unity/Godot** — กราฟิกดี แต่ทำ data viz ยาก, MediaPipe integration ไม่เป็นทางการ, ทีมดูแลยากกว่า
