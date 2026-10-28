"""GPU setup for rtmlib: CUDA (default) or TensorRT FP16 via ONNX Runtime."""

from __future__ import annotations

import ctypes
from pathlib import Path

import onnxruntime

HERE = Path(__file__).resolve().parent
TRT_CACHE = HERE / "results" / "trt-cache"
_ready = False


def enable_gpu() -> None:
    """Load CUDA/cuDNN and TensorRT libraries from the pip wheels and register a `tensorrt` device."""
    global _ready
    if _ready:
        return
    # Without this, ORT cannot find libcublas etc. and silently falls back to CPU.
    onnxruntime.preload_dlls()
    import tensorrt_libs

    libs = Path(tensorrt_libs.__file__).parent
    for name in ("libnvinfer.so.10", "libnvinfer_plugin.so.10", "libnvonnxparser.so.10"):
        ctypes.CDLL(str(libs / name), mode=ctypes.RTLD_GLOBAL)

    from rtmlib.tools.base import RTMLIB_SETTINGS

    TRT_CACHE.mkdir(parents=True, exist_ok=True)
    RTMLIB_SETTINGS["onnxruntime"]["tensorrt"] = (
        "TensorrtExecutionProvider",
        {
            "trt_fp16_enable": True,
            "trt_engine_cache_enable": True,
            "trt_engine_cache_path": str(TRT_CACHE),
            "trt_timing_cache_enable": True,
        },
    )
    _ready = True
