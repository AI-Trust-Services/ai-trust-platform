#!/bin/sh
set -e
echo "Starting RMQ Bridge…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8002 --no-access-log
