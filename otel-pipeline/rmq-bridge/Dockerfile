# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY . .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
