#!/bin/sh
set -e
echo "Starting Compliance API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8007 --no-access-log
