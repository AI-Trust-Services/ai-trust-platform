FROM python:3.12-slim

WORKDIR /app

COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY compliance/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY compliance/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
