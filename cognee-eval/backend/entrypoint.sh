#!/bin/sh
set -e
echo "Starting Cognee Eval API server…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8011 --no-access-log
