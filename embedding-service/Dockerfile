# syntax=docker/dockerfile:1.7
# `backend-base` is resolved by docker-bake.hcl via
# `contexts = { backend-base = "target:backend-base" }` (built once, shared).
FROM backend-base

WORKDIR /app

COPY embedding-service/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY embedding-service/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
