# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization

COPY risk-management/backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY risk-management/backend /app

RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
