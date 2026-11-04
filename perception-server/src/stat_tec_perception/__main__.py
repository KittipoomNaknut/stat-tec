import argparse
import asyncio
import contextlib
import logging
import signal
from pathlib import Path

from .camera import Camera
from .monitor import DEFAULT_LOG_DIR, EventLog
from .server import PerceptionServer

DEFAULT_TRT_CACHE = Path.home() / ".cache" / "stat-tec" / "trt"


def main() -> None:
    parser = argparse.ArgumentParser(prog="stat-tec-perception")
    parser.add_argument("--camera", type=int, default=0, help="V4L2 index (/dev/videoN)")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument(
        "--fourcc",
        default="MJPG",
        help="camera pixel format: MJPG for webcams, GRBG for the Xbox 360 Kinect (640x480)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--det-every", type=int, default=1, help="run the person detector every N frames"
    )
    parser.add_argument(
        "--detector",
        choices=["tiny", "m"],
        default="tiny",
        help="YOLOX size (research 027: tiny every frame ≈ 5 ms; m ≈ 19 ms)",
    )
    parser.add_argument("--max-people", type=int, default=3)
    parser.add_argument(
        "--dynamic-fps",
        action="store_true",
        help="let the camera lower its frame rate in dim light (off by default: research 027)",
    )
    parser.add_argument(
        "--preview-fps", type=float, default=24, help="camera previews for the HUD player-cam"
    )
    parser.add_argument("--trt-cache", type=Path, default=DEFAULT_TRT_CACHE)
    parser.add_argument(
        "--log-dir", type=Path, default=DEFAULT_LOG_DIR, help="live event log (stat-tec-log)"
    )
    parser.add_argument("--no-log", action="store_true", help="keep no event log")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    from .estimator import RtmPoseEstimator

    estimator = RtmPoseEstimator(
        args.trt_cache,
        det_every=args.det_every,
        max_people=args.max_people,
        detector=args.detector,
    )
    camera = Camera(
        args.camera,
        args.width,
        args.height,
        args.fps,
        hold_fps=not args.dynamic_fps,
        fourcc=args.fourcc,
    )
    events = EventLog(None if args.no_log else args.log_dir)
    server = PerceptionServer(
        camera, estimator, args.host, args.port, args.preview_fps, events=events
    )
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_serve_until_terminated(server))


async def _serve_until_terminated(server: PerceptionServer) -> None:
    """`demo.sh stop` sends SIGTERM (twice: to the group and forwarded by uv). Cancelling the
    task, rather than raising mid-code, lets the server shut down cleanly and log service-stop."""
    task = asyncio.current_task()
    assert task is not None
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    with contextlib.suppress(asyncio.CancelledError):
        await server.serve_forever()


if __name__ == "__main__":
    main()
