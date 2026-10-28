# ADR-0003: Scene รับคำสั่งผ่าน Intent Bus เท่านั้น

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

ถ้า Scene อ่าน landmark จากกล้องโดยตรง จะ (1) ผูกตรรกะท่าทางกับฉาก แก้ยาก, (2) ทดสอบไม่ได้ถ้าไม่มีคน, (3) ไม่มีทางสำรองเมื่อกล้องมีปัญหาหน้างาน

## Decision

สร้างชั้น **Intent** (`cursor`, `select`, `raise`, `throw`, `slap`, `draw`, …) ที่มีความหมายระดับการใช้งาน
Scene subscribe Intent จาก **IntentBus** เท่านั้น — ไม่รู้ว่ามาจากกล้อง, เมาส์ หรือ replay

แหล่งที่ส่ง Intent ได้: `GestureEngine` (pose), `MouseAdapter` (staff/dev), `ReplayAdapter` (test)

## Consequences

**ดี**
- จูน/เปลี่ยนท่าทางได้โดยไม่แตะ Scene
- Staff สลับไปใช้เมาส์ได้ทันที (F2)
- เขียน test ฉากได้ด้วย intent ปลอม และ test ท่าทางได้ด้วย pose replay

**ต้องระวัง**
- Intent บางแบบ (เช่น `draw`) ต้องออกแบบให้ทั้ง pose และ mouse แปลงมาได้สมเหตุสมผล
