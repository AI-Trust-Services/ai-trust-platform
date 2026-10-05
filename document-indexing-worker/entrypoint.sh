#!/bin/sh
set -e
echo "Starting Document Indexing Worker…"

# Preload libgomp so it is initialised on the main thread at process start.
# Without this, Docling lazily dlopens the PyTorch model libraries (layout /
# tableformer) from a worker thread while parsing PDFs/images, which trips the
# glibc static-TLS assertion `_dl_allocate_tls_init: Assertion listp != NULL`
# and crashes the process with exit 127. Markdown/plain text parse without those
# models, which is why they worked while PDFs crashed.
GOMP="$(find /usr/local/lib -name 'libgomp*.so*' 2>/dev/null | head -n1)"
if [ -n "$GOMP" ]; then
  export LD_PRELOAD="${GOMP}${LD_PRELOAD:+:$LD_PRELOAD}"
  echo "LD_PRELOAD=$LD_PRELOAD"
fi

exec python main.py
