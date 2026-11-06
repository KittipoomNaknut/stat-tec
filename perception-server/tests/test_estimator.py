import numpy as np

from stat_tec_perception.estimator import (
    boxes_from_keypoints,
    in_zone,
    largest_first,
    looks_like_a_person,
    tall_enough,
)


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


def _estimator_with(detections, zone=None, min_height=0.0):
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
    est._zone = zone
    est._min_height = min_height
    est._body_check = False
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


def test_zone_keeps_only_people_centered_in_the_band():
    boxes = np.array([[0, 0, 100, 400], [560, 0, 720, 400], [1180, 0, 1280, 400]], np.float32)
    kept = in_zone(boxes, 1280, (0.2, 0.8))
    np.testing.assert_array_equal(kept[:, 0], [560])
    assert in_zone(boxes, 1280, None) is boxes


def test_a_bystander_outside_the_zone_is_never_posed():
    frame = np.zeros((720, 1280, 3), np.uint8)
    player = [560.0, 90.0, 720.0, 600.0]
    bystander = [1150.0, 60.0, 1270.0, 700.0]  # taller in the image: would be "largest first"
    est = _estimator_with([[bystander, player]], zone=(0.2, 0.8))
    est(frame)
    assert est.crops[0] == [player]


def test_small_far_people_are_ignored():
    boxes = np.array([[0, 0, 50, 100], [0, 0, 200, 500]], np.float32)  # 0.14 and 0.69 of 720
    np.testing.assert_array_equal(tall_enough(boxes, 720, 0.25)[:, 3], [500])
    assert tall_enough(boxes, 720, 0) is boxes


def test_only_the_player_at_the_spot_is_posed_among_small_detections():
    frame = np.zeros((480, 640, 3), np.uint8)
    player = [250.0, 60.0, 400.0, 470.0]
    far = [[580.0, 200.0, 620.0, 290.0], [450.0, 180.0, 490.0, 260.0]]
    est = _estimator_with([[*far, player]], min_height=0.25)
    est(frame)
    assert est.crops[0] == [player]


def _person(**move):
    """A frontal person in a 1280-wide image (COCO-17), parts moved as given."""
    kp = np.zeros((17, 2))
    kp[0] = [640, 200]  # nose
    kp[5], kp[6] = [700, 300], [580, 300]  # shoulders
    kp[11], kp[12] = [680, 480], [600, 480]  # hips
    for i, xy in move.items():
        kp[int(i[1:])] = xy
    return kp


def test_a_whole_upright_person_passes_with_or_without_hips():
    sc = np.full(17, 0.9)
    assert looks_like_a_person(_person(), sc, 1280)
    close = sc.copy()
    close[[11, 12]] = 0.1  # hips out of frame, close to the camera
    assert looks_like_a_person(_person(), close, 1280)


def test_slivers_and_odd_shapes_are_rejected():
    sc = np.full(17, 0.9)
    one_shoulder = sc.copy()
    one_shoulder[6] = 0.2
    assert not looks_like_a_person(_person(), one_shoulder, 1280)  # half a body
    assert not looks_like_a_person(_person(p0=[900, 200]), sc, 1280)  # head off the shoulders
    assert not looks_like_a_person(_person(p0=[640, 400]), sc, 1280)  # head below them
    assert not looks_like_a_person(_person(p11=[680, 310], p12=[600, 310]), sc, 1280)  # no torso
    assert not looks_like_a_person(_person(p5=[1275, 300]), sc, 1280)  # cut by the edge


def test_an_admitted_player_is_kept_while_an_arm_hides_the_face():
    """The body check admits people; a slash across the face must not drop the player."""
    from stat_tec_perception.estimator import RtmPoseEstimator

    face = _person()
    sc_ok = np.full(17, 0.9)
    sc_hidden = sc_ok.copy()
    sc_hidden[0] = 0.2  # nose behind the arm
    frames = iter([(face, sc_ok), (face, sc_hidden), (face, sc_hidden)])
    player = [560.0, 150.0, 720.0, 600.0]

    est = object.__new__(RtmPoseEstimator)
    est._det = lambda frame: [player]
    est._pose = lambda frame, bboxes: (lambda k, s: (k[None], s[None]))(*next(frames))
    est._det_every, est._max_people, est._frame = 1, 3, 0
    est._zone, est._min_height, est._body_check = None, 0.0, True
    est._boxes = np.zeros((0, 4), np.float32)
    est._accepted = np.zeros((0, 4), np.float32)
    frame = np.zeros((720, 1280, 3), np.uint8)
    assert len(est(frame)[0]) == 1  # admitted
    assert len(est(frame)[0]) == 1  # face hidden, same place: kept
    assert len(est(frame)[0]) == 1


def test_someone_new_with_a_hidden_face_is_not_admitted():
    from stat_tec_perception.estimator import RtmPoseEstimator

    sc_hidden = np.full(17, 0.9)
    sc_hidden[0] = 0.2
    est = object.__new__(RtmPoseEstimator)
    est._det = lambda frame: [[560.0, 150.0, 720.0, 600.0]]
    est._pose = lambda frame, bboxes: (_person()[None], sc_hidden[None])
    est._det_every, est._max_people, est._frame = 1, 3, 0
    est._zone, est._min_height, est._body_check = None, 0.0, True
    est._boxes = np.zeros((0, 4), np.float32)
    est._accepted = np.zeros((0, 4), np.float32)
    assert len(est(np.zeros((720, 1280, 3), np.uint8))[0]) == 0
