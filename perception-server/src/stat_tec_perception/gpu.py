"""GPU setup for rtmlib: CUDA/cuDNN and TensorRT from the pip wheels, plus a `tensorrt` device."""

from __future__ import annotations

import ctypes
from pathlib import Path

_ready = False


def enable_gpu(trt_cache: Path) -> None:
    global _ready
    if _ready:
        return
    import onnxruntime

    # Without this, ONNX Runtime cannot find libcublas etc. and silently falls back to CPU.
    onnxruntime.preload_dlls()
    import tensorrt_libs

    libs = Path(tensorrt_libs.__file__).parent
    for name in ("libnvinfer.so.10", "libnvinfer_plugin.so.10", "libnvonnxparser.so.10"):
        ctypes.CDLL(str(libs / name), mode=ctypes.RTLD_GLOBAL)

    from rtmlib.tools.base import RTMLIB_SETTINGS

    trt_cache.mkdir(parents=True, exist_ok=True)
    RTMLIB_SETTINGS["onnxruntime"]["tensorrt"] = (
        "TensorrtExecutionProvider",
        {
            "trt_fp16_enable": True,
            "trt_engine_cache_enable": True,
            "trt_engine_cache_path": str(trt_cache),
            "trt_timing_cache_enable": True,
        },
    )
    _ready = True
