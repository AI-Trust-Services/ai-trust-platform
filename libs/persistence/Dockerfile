# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.cache/pip pip install -e .

CMD ["alembic", "-c", "alembic.ini", "upgrade", "head"]
