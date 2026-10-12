# syntax=docker/dockerfile:1.7
# `backend-base` is resolved by docker-bake.hcl via
# `contexts = { backend-base = "target:backend-base" }` (built once, shared).
FROM backend-base

WORKDIR /app

COPY ai-system-registry/backend/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY ai-system-registry/backend/ .
RUN chmod +x entrypoint.sh

# Externalized prompt templates (repo-root context/prompts). Baked into the
# image at /app/context/prompts so the loader resolves it with WORKDIR /app.
COPY context/prompts /app/context/prompts

CMD ["./entrypoint.sh"]
