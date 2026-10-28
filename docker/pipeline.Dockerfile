# syntax=docker/dockerfile:1

FROM python:3.12.13-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
WORKDIR /repo/data-pipeline

COPY data-pipeline/pyproject.toml data-pipeline/uv.lock data-pipeline/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY data-pipeline/ ./
RUN uv sync --frozen --no-dev

ENTRYPOINT ["/opt/venv/bin/stat-tec-pipeline"]
CMD ["build", "--out", "/out"]
