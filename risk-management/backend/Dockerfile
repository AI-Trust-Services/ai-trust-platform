# Build context is repo root so we can COPY libs/
FROM python:3.12-slim AS build

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY risk-management/backend/requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir -r /app/requirements.txt

COPY risk-management/backend /app

FROM python:3.12-slim

WORKDIR /app

COPY --from=build /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build /usr/local/bin /usr/local/bin
COPY --from=build /app /app

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 8009

ENTRYPOINT ["/app/entrypoint.sh"]
