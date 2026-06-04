#!/bin/sh
set -e
echo "Starting API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8001 --no-access-log
