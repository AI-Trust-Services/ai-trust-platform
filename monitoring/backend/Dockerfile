FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/clickhouse /app/libs/clickhouse
COPY libs/authorization /app/libs/authorization
COPY monitoring/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY monitoring/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
