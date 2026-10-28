# 008 — ONNX Runtime ตัว CPU ทับตัว GPU

- **วันที่:** 2026-10-28 · **สถานะ:** สรุปแล้ว
- **เกี่ยวข้อง:** PR #25 · `perception-server/pyproject.toml` · `spikes/pose-models/pyproject.toml`

## คำถาม / สมมติฐาน
`uv sync --extra gpu` แล้ว import ได้ `onnxruntime` **1.31.1** ทั้งที่ pin `onnxruntime-gpu==1.31.0`

## การตรวจ
- `get_available_providers()` → `['AzureExecutionProvider', 'CPUExecutionProvider']` — **ไม่มี GPU**
- `uv tree`: rtmlib ขอ `onnxruntime` (ตัว CPU) ซึ่งติดตั้งลงโมดูล `onnxruntime` เดียวกับตัว GPU แล้วทับ
- spike ก่อนหน้าทำงานได้เพราะ**ลำดับการติดตั้งบังเอิญถูก** — ไว้ใจไม่ได้สำหรับเครื่องหน้างาน

## การแก้
1. `[tool.uv] exclude-dependencies = ["onnxruntime"]` (uv 0.12.5 รองรับ) — lockfile ไม่มีตัว CPU แล้ว
2. ติดตั้งตัว GPU ใหม่ (`--reinstall-package onnxruntime-gpu`) → providers มี TensorRT + CUDA
3. **กันซ้ำ:** `RtmPoseEstimator` ไม่ยอมเริ่มถ้า pose model ไม่ได้อยู่บน TensorRT (error ชัดแทนการช้าเงียบ ๆ)
4. ใช้วิธีเดียวกันกับ spike

## ตรวจซ้ำ
- CI-like env (ไม่มี extra gpu): ไม่มี package GPU เลย (ตรวจด้วย `find_spec` ในโฟลเดอร์ env จริง — `uv pip list` ครั้งแรกไปอ่าน `.venv` ผิดตัว ได้เลข 5 ที่ไม่ถูก)

## บทเรียน
- `uv run` ต้องใส่ `--extra gpu` เสมอ ไม่งั้นจะ sync สภาพแวดล้อมค่าเริ่มต้นก่อนรัน
- อย่าเชื่อว่า "ใช้ GPU อยู่" จนกว่าจะเช็ก provider จริง
