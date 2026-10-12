# syntax=docker/dockerfile:1.7
# `backend-base` is resolved by docker-bake.hcl via
# `contexts = { backend-base = "target:backend-base" }` (built once, shared).
FROM backend-base

WORKDIR /app

COPY audit-flush-worker/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY audit-flush-worker/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
