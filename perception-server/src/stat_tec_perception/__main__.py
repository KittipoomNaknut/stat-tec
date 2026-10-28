import argparse
import asyncio
import contextlib
import logging
from pathlib import Path

from .camera import Camera
from .server import PerceptionServer

DEFAULT_TRT_CACHE = Path.home() / ".cache" / "stat-tec" / "trt"


def main() -> None:
    parser = argparse.ArgumentParser(prog="stat-tec-perception")
    parser.add_argument("--camera", type=int, default=0, help="V4L2 index (/dev/videoN)")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--det-every", type=int, default=7, help="run the person detector every N frames"
    )
    parser.add_argument("--max-people", type=int, default=3)
    parser.add_argument("--preview-fps", type=float, default=10)
    parser.add_argument("--trt-cache", type=Path, default=DEFAULT_TRT_CACHE)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    from .estimator import RtmPoseEstimator

    estimator = RtmPoseEstimator(
        args.trt_cache, det_every=args.det_every, max_people=args.max_people
    )
    camera = Camera(args.camera, args.width, args.height, args.fps)
    server = PerceptionServer(camera, estimator, args.host, args.port, args.preview_fps)
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(server.serve_forever())


if __name__ == "__main__":
    main()
