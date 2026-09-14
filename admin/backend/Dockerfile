FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY libs/persistence /app/libs/persistence
COPY admin/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY admin/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
