# 007 — ทำ RTMPose ให้ทัน 30 fps

- **วันที่:** 2026-10-28 · **สถานะ:** สรุปแล้ว
- **เกี่ยวข้อง:** PR #23, #25 · `perception-server/src/stat_tec_perception/{camera,estimator,gpu}.py`

## คำถาม / สมมติฐาน
รอบแรก RTMPose p95 = 61 ms และทุกโมเดลได้แค่ 10 fps — ต้องการ 30 fps เต็มและไม่มีเฟรมสะดุด

## การทดลอง (แต่ละขั้นวัดก่อนเปลี่ยน)
| ขั้น | วัดได้ | การตัดสินใจ |
|---|---|---|
| 1. เปิดกล้อง | YUYV (ค่าเริ่มต้น OpenCV) = **10.3 fps**; MJPEG = **30.7 fps** | บังคับ MJPEG |
| 2. ลอง RTMPose บน "GPU" | 700 ms/เฟรม — ตกไป CPU เพราะหา `libcublasLt.so.13` ไม่เจอ | เรียก `onnxruntime.preload_dlls()` |
| 3. แยกเวลา detector / pose (ป้อน bbox คงที่ ไม่ต้องมีคน) | YOLOX-x **51.8 ms**, RTMPose-x 11.5 ms (CUDA) | detector คือตัวการ p95 |
| 4. TensorRT สำหรับทุกตัว | YOLOX-x/m **สร้าง engine ไม่ได้** (NMS ในกราฟ: TopK > 3840) | detector อยู่ CUDA |
| 5. ติดตั้ง TensorRT | ORT 1.31.0 ลิงก์ `libnvinfer.so.10` แต่ `tensorrt-cu13` ล่าสุดเป็น 11.x | ใช้ `10.16.1.11` |
| 6. Pose บน TensorRT FP16 | RTMPose-x **3.9 ms**, RTMW 4.5 ms | ใช้ FP16 |
| 7. Detector เบาลง | YOLOX-m **22.2 ms** | ใช้ YOLOX-m ทุก 7 เฟรม |
| 8. FP16 แม่นพอไหม | ต่างจาก FP32 0.55 px (แค่ 2 เฟรมมีคน → ตัวอย่างน้อย) → วัดซ้ำใน guided: **0.69 px / 104 เฟรม** | ยอมรับ |
| 9. รวมกับกล้องจริง | **30.4 fps**, 8.2 / 29.7 ms (avg/p95), สูงสุด 31 ms < งบ 33 ms | ✅ |

ใน service จริง (PR #25): 30.7 fps, ไม่มีเฟรมหายใน 461 เฟรม, inference 7.2 / 25.4 ms, อ่านภาพ → client 7.5 / 25.9 ms

## ทางเลือกที่ไม่เลือก
- YOLOX-x: แม่นกว่าแต่ 52 ms
- ใช้ `PoseTracker` ของ rtmlib ตรง ๆ: เขียน detector-every-N เองเพื่อคุมพฤติกรรมและเขียน test ได้

## ข้อสรุป
MJPEG + YOLOX-m (CUDA, ทุก 7 เฟรม) + RTMPose-x (TensorRT FP16)

## ข้อจำกัด / ต้องทดสอบต่อ
กล้อง 60 fps: เฟรมที่รัน detector (~26 ms) จะเกินงบ 16.7 ms → ต้องรัน detector ขนานกัน
