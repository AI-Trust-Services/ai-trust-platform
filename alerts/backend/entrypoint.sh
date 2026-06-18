#!/bin/sh
set -e
echo "Starting Alerts API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8005 --no-access-log
