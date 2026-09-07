FROM python:3.12-slim

WORKDIR /app

COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY marketplace-health-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY marketplace-health-worker/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
