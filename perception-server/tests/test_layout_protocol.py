import numpy as np
import pytest

from stat_tec_perception.layout import COCO_TO_APP, to_app_layout
from stat_tec_perception.protocol import (
    HEADER_SIZE,
    Detections,
    decode_detections,
    encode_detections,
)


def test_maps_coco_points_and_normalizes():
    kp = np.zeros((1, 17, 2))
    kp[0, 9] = [640, 360]  # left wrist at frame center
    sc = np.full((1, 17), 0.8)
    sc[0, 0] = 1.2  # RTMPose can exceed 1
    out = to_app_layout(kp, sc, 1280, 720).reshape(1, 33, 4)
    assert out[0, 15, :2].tolist() == pytest.approx([0.5, 0.5])
    assert out[0, 0, 3] == 1.0  # clamped
    assert out[0, 15, 3] == pytest.approx(0.8)
    unmapped = sorted(set(range(33)) - set(COCO_TO_APP.values()))
    assert (out[0, unmapped, 3] == 0).all()


def test_empty_frame():
    assert to_app_layout(np.zeros((0, 17, 2)), np.zeros((0, 17)), 1280, 720).size == 0


def test_round_trip_and_alignment():
    lm = np.arange(2 * 33 * 4, dtype=np.float32)
    d = Detections(7, 1.73e12, 7.5, 1280, 720, 2, lm)
    msg = encode_detections(d)
    assert HEADER_SIZE % 4 == 0
    back = decode_detections(msg)
    assert (back.frame_id, back.people, back.width) == (7, 2, 1280)
    assert back.captured_at_ms == pytest.approx(1.73e12)
    np.testing.assert_array_equal(back.landmarks, lm)


def test_rejects_wrong_size():
    with pytest.raises(ValueError):
        encode_detections(Detections(0, 0, 0, 1, 1, 1, np.zeros(5, np.float32)))


def test_matches_the_shared_fixture_byte_for_byte():
    """The app decodes this same file in app/tests/unit/server-protocol.test.ts."""
    from pathlib import Path

    fixture = Path(__file__).parents[2] / "app/tests/fixtures/server/std1-two-people.bin"
    d = Detections(42, 1761650000123.5, 7.25, 1280, 720, 2, np.arange(264, dtype=np.float32) * 0.5)
    assert encode_detections(d) == fixture.read_bytes()
