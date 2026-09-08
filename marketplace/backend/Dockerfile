FROM python:3.12-slim

WORKDIR /app

# The OCM CLI — used by POST /discover/ocm to resolve a component version to its digest-pinned
# ociImage ref (app/ocm.py shells to `ocm get componentversion`). Pinned release, self-contained in
# the image so the endpoint needs no external tooling in-cluster. Multi-arch: pick the tarball for
# the build platform (amd64/arm64) so the same Dockerfile builds on either.
ARG OCM_VERSION=0.49.0
RUN set -eux; \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) ocm_arch=amd64 ;; \
      arm64) ocm_arch=arm64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/open-component-model/ocm/releases/download/v${OCM_VERSION}/ocm-${OCM_VERSION}-linux-${ocm_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin ocm; \
    chmod +x /usr/local/bin/ocm; \
    ocm version; \
    apt-get purge -y curl && apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

COPY libs/persistence /app/libs/persistence
COPY libs/logging /app/libs/logging
COPY libs/authorization /app/libs/authorization
COPY marketplace/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY marketplace/backend/ .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
