# syntax=docker/dockerfile:1.7
# `backend-base` is resolved by docker-bake.hcl via
# `contexts = { backend-base = "target:backend-base" }` (built once, shared).
FROM backend-base

WORKDIR /app

COPY decision-trace-analyzer/backend/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY decision-trace-analyzer/backend/ .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006", "--no-access-log"]
