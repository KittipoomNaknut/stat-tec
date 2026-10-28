import numpy as np

from stat_tec_pipeline.export.binary import read_float32, write_float32


def test_float32_round_trip(tmp_path):
    path = tmp_path / "scene" / "values.bin"
    values = [0.0, 1.5, -2.25, 1e6]

    count = write_float32(path, values)

    assert count == 4
    assert path.stat().st_size == 4 * 4
    np.testing.assert_array_equal(read_float32(path), np.array(values, dtype=np.float32))


def test_writes_little_endian(tmp_path):
    path = tmp_path / "one.bin"
    write_float32(path, [1.0])

    assert path.read_bytes() == b"\x00\x00\x80\x3f"
