FROM python:3.12-slim
RUN pip install --no-cache-dir psycopg2-binary
WORKDIR /app
COPY seed.py .
CMD ["python", "seed.py"]
