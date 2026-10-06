FROM python:3.12-slim

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY cognee-eval/backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY cognee-eval/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
