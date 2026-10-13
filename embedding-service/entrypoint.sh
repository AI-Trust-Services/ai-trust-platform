#!/bin/sh
set -e
echo "Starting Embedding Service…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8012
