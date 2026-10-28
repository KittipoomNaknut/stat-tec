"""Little-endian binary arrays that the app loads straight into GPU buffers."""

from pathlib import Path

import numpy as np
import numpy.typing as npt

FLOAT32_LE = np.dtype("<f4")


def write_float32(path: Path, values: npt.ArrayLike) -> int:
    """Write values as little-endian float32 and return the number of elements written."""
    array = np.ascontiguousarray(values, dtype=FLOAT32_LE)
    path.parent.mkdir(parents=True, exist_ok=True)
    array.tofile(path)
    return int(array.size)


def read_float32(path: Path) -> npt.NDArray[np.float32]:
    return np.fromfile(path, dtype=FLOAT32_LE)
