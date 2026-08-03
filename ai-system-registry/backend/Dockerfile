FROM python:3.12-slim

WORKDIR /app

COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY ai-system-registry/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai-system-registry/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
