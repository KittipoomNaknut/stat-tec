import numpy as np

from stat_tec_perception.estimator import boxes_from_keypoints, largest_first


def test_box_from_confident_keypoints_expanded_and_clipped():
    kp = np.array([[[100, 100], [200, 300], [5000, 5000]]], float)
    sc = np.array([[0.9, 0.9, 0.1]])  # third point is not confident
    (box,) = boxes_from_keypoints(kp, sc, 1280, 720)
    # 100..200 x 100..300, expanded 25% around the center (150, 200)
    np.testing.assert_allclose(box, [87.5, 75, 212.5, 325])
    edge = np.array([[[0, 0], [1279, 719]]], float)
    np.testing.assert_allclose(
        boxes_from_keypoints(edge, np.ones((1, 2)), 1280, 720)[0], [0, 0, 1279, 719]
    )


def test_skips_people_with_too_few_points():
    assert boxes_from_keypoints(np.zeros((1, 17, 2)), np.zeros((1, 17)), 1280, 720).shape == (0, 4)


def test_largest_first_and_limit():
    boxes = np.array([[0, 0, 10, 10], [0, 0, 100, 100], [0, 0, 50, 50]], np.float32)
    np.testing.assert_array_equal(largest_first(boxes, 2)[:, 2], [100, 50])


def _estimator_with(detections):
    """An RtmPoseEstimator with fake models: the detector returns `detections` in turn."""
    from stat_tec_perception.estimator import RtmPoseEstimator

    est = object.__new__(RtmPoseEstimator)
    seen = iter(detections)
    est._det = lambda frame: next(seen)
    est.crops = []

    def pose(frame, bboxes):
        est.crops.append(bboxes)
        kp = np.array([[[100.0, 100.0], [200.0, 300.0]] + [[150.0, 200.0]] * 15])
        return kp, np.full((1, 17), 0.9)

    est._pose = pose
    est._det_every, est._max_people, est._frame = 1, 3, 0
    est._boxes = np.zeros((0, 4), np.float32)
    return est


def test_detects_every_frame_and_survives_a_missed_detection():
    frame = np.zeros((720, 1280, 3), np.uint8)
    person = [[90.0, 90.0, 210.0, 310.0]]
    est = _estimator_with([person, [], person])
    for _ in range(3):
        keypoints, _ = est(frame)
        assert len(keypoints) == 1  # the player is never dropped
    assert est.crops[0] == person
    # Frame 2: the detector found nobody, so the crop came from frame 1's keypoints
    assert est.crops[1] != person and len(est.crops[1]) == 1
    assert est.crops[2] == person
