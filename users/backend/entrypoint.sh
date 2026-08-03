#!/bin/sh
set -e
echo "Starting Users API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8008 --no-access-log
