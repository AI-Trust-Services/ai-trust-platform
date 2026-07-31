FROM python:3.12-alpine
RUN pip install --no-cache-dir httpx
COPY provision.py /provision.py
CMD ["python", "/provision.py"]
