# syntax=docker/dockerfile:1.7
FROM python:3.12-alpine
RUN --mount=type=cache,target=/root/.cache/pip pip install httpx
COPY provision.py /provision.py
CMD ["python", "/provision.py"]
