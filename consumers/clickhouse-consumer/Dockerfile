FROM python:3.12-slim

WORKDIR /app

COPY libs/clickhouse /app/libs/clickhouse
COPY consumers/clickhouse-consumer/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY consumers/clickhouse-consumer/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
