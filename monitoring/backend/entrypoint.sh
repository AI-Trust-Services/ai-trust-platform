#!/bin/sh
set -e
echo "Starting Monitoring API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8003 --no-access-log
