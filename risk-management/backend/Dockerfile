# Build context is repo root so we can COPY libs/
# ARG INSTALL_NEXUS=false  — set to "true" via docker-compose profile "nexus" to include
# ai-atlas-nexus (adds ~2GB: torch, transformers, docling). Default build stays lean.
ARG INSTALL_NEXUS=false

FROM python:3.12-slim AS build

WORKDIR /app

COPY libs/logging /app/libs/logging
COPY risk-management/backend/requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir -r /app/requirements.txt

# Optional: install ai-atlas-nexus when INSTALL_NEXUS=true
# git is needed only for this step; installed and used in one layer to keep image clean
ARG INSTALL_NEXUS
RUN if [ "$INSTALL_NEXUS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends git \
      && pip install --no-cache-dir "ai-atlas-nexus[ollama] @ git+https://github.com/IBM/risk-atlas-nexus.git" \
      && apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

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
