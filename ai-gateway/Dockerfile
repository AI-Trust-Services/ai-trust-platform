# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

COPY ai-gateway/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install --upgrade pip && \
    pip install -r requirements.txt

COPY ai-gateway/main.py .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
