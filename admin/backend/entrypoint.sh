#!/bin/sh
set -e
echo "Starting Admin API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8009 --no-access-log
