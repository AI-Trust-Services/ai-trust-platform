FROM debian:12-slim

ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG TARGETARCH=amd64

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL \
       "https://github.com/minio/mc/releases/download/${MC_RELEASE}/mc.linux-${TARGETARCH}.${MC_RELEASE}" \
       -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/mc \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["/usr/local/bin/mc"]
