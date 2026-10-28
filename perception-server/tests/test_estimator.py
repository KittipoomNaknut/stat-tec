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
