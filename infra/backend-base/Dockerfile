# syntax=docker/dockerfile:1.7
# Shared base image for all repo-root Python backends and workers.
#
# Every backend's requirements.txt lists its editable libs as `-e /app/libs/<name>`,
# so those directories must exist at exactly /app/libs/<name> at pip-install time.
# We copy all five shared libs here once and `pip install -e` them; child images do
# `FROM backend-base` and inherit both the libs and their resolved deps, so a lib edit
# no longer re-triggers a full dependency install in every service.
#
# Build context = repo root (so libs/ is visible). Not a deployed artifact — never
# added to the OCM component-constructor; it exists only as a build-time parent.
FROM python:3.12-slim

WORKDIR /app

COPY libs/tenancy       /app/libs/tenancy
COPY libs/persistence   /app/libs/persistence
COPY libs/logging       /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY libs/clickhouse    /app/libs/clickhouse

RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
      -e /app/libs/tenancy \
      -e /app/libs/persistence \
      -e /app/libs/logging \
      -e /app/libs/authorization \
      -e /app/libs/clickhouse
