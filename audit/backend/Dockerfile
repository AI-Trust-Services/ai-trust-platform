FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/clickhouse /app/libs/clickhouse
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY audit/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY audit/backend/ .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8009", "--no-access-log"]
