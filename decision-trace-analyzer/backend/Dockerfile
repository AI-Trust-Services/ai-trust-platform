FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/clickhouse /app/libs/clickhouse
COPY libs/logging /app/libs/logging
COPY decision-trace-analyzer/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY decision-trace-analyzer/backend/ .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006", "--no-access-log"]
