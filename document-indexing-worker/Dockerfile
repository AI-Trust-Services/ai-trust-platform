# syntax=docker/dockerfile:1.7
# `backend-base` is resolved by docker-bake.hcl via
# `contexts = { backend-base = "target:backend-base" }` (built once, shared).
FROM backend-base

WORKDIR /app

COPY document-indexing-worker/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# System libraries OpenCV needs at import time (Docling's PDF pipeline pulls in
# cv2 via the tableformer model). python:3.12-slim ships none of these, so
# `import cv2` fails with "libxcb.so.1: cannot open shared object file".
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY document-indexing-worker/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
