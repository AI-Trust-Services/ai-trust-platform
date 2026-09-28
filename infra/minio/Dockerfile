FROM debian:12-slim

ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL \
    "https://github.com/minio/minio/releases/download/${MINIO_RELEASE}/minio.linux-${TARGETARCH}.${MINIO_RELEASE}" \
    -o /usr/local/bin/minio \
    && chmod +x /usr/local/bin/minio

VOLUME ["/data"]

EXPOSE 9000 9001

ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["minio"]
