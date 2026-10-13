#!/bin/sh
set -e
echo "Starting Document Indexing API…"
exec uvicorn app.main:app --host 0.0.0.0 --port 8011
