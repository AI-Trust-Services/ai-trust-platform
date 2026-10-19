FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy /app/libs/tenancy
COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY document-indexing-worker/requirements.txt .
# CPU-only torch (+torchvision, which easyocr in Docling's PDF pipeline pulls
# in): the default PyPI torch wheel bundles ~2.5 GB of CUDA/nvidia libraries
# this CPU-only worker never uses. Install the CPU build from PyTorch's CPU
# index BEFORE the requirements so Docling's torch-dependent models resolve
# against it — and torchvision doesn't drag a CUDA torch back in.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# System libraries OpenCV needs at import time (Docling's PDF pipeline pulls in
# cv2 via the tableformer model). python:3.12-slim ships none of these, so
# `import cv2` fails with "libxcb.so.1: cannot open shared object file".
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 libxcb1 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY document-indexing-worker/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
