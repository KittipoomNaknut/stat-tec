# STAT_TEC data pipeline

Builds the datasets each scene loads from `app/public/data/`. See `docs/ARCHITECTURE.md` §13.

```bash
uv sync
uv run stat-tec-pipeline build   # write scene data
uv run pytest
uv run ruff check . && uv run ruff format --check .
```
