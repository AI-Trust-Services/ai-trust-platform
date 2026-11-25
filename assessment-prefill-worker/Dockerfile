FROM python:3.12-slim

WORKDIR /app

# Shared libs first (cached layer, rarely changes).
COPY libs/tenancy /app/libs/tenancy
COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization

# Copy the full registry backend so app.* is importable (single source of truth
# for the prefill pipeline — no code duplication).
COPY ai-system-registry/backend/ .
RUN pip install --no-cache-dir -r requirements.txt

# Externalized prompt templates required by assessment_catalogue.py at import time.
COPY context/prompts /app/context/prompts

# Worker entry point on top of the backend tree.
COPY assessment-prefill-worker/main.py ./worker_main.py

CMD ["python", "worker_main.py"]
