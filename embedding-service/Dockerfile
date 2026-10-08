FROM python:3.12-slim

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY embedding-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY embedding-service/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
