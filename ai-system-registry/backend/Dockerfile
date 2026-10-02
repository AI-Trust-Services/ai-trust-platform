FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY ai-system-registry/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai-system-registry/backend/ .
RUN chmod +x entrypoint.sh

# Externalized prompt templates (repo-root context/prompts). Baked into the
# image at /app/context/prompts so the loader resolves it with WORKDIR /app.
COPY context/prompts /app/context/prompts

CMD ["./entrypoint.sh"]
