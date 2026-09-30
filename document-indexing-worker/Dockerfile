FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY document-indexing-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY document-indexing-worker/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
