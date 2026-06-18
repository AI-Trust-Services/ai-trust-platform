#!/bin/sh
set -e
echo "Starting Overview API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8004 --no-access-log
