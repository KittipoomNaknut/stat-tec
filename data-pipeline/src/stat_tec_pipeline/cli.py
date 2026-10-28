import argparse
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[3] / "app" / "public" / "data"


def build(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    print(f"No scene datasets yet. Output directory: {out}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="stat-tec-pipeline")
    commands = parser.add_subparsers(dest="command", required=True)

    build_cmd = commands.add_parser("build", help="build all scene datasets")
    build_cmd.add_argument("--out", type=Path, default=DEFAULT_OUT)

    args = parser.parse_args()
    if args.command == "build":
        build(args.out)
