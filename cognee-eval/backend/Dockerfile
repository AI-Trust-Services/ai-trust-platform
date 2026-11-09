FROM python:3.12-slim

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY cognee-eval/backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    ln -sf /usr/local/lib/python3.12/site-packages/cognee_db_workers /app/cognee_db_workers

COPY cognee-eval/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
