# Purpose-built builder image for POST /discover/ocm/build.
#
# The marketplace backend clones a Git repo and builds its OCM component in a throwaway container
# (docker_client.ocm_build_and_resolve). That container needs BOTH `git` (to clone) and the `ocm`
# CLI (to `add componentversions` / `transfer` / `get componentversion`). The official
# ghcr.io/open-component-model/ocm image is distroless — no shell, no git — so it can't run the
# clone+build shell command. This tiny alpine image ships `git`, a POSIX `/bin/sh`, CA certs, and the
# same pinned `ocm` release binary the backend Dockerfile installs, so the two agree on CLI version.
#
# Kept deliberately minimal (no app code, no secrets) — it only ever runs the ephemeral build command
# the backend hands it, with the git token supplied out-of-band via GIT_ASKPASS env.
FROM alpine:3.20

ARG OCM_VERSION=0.49.0
RUN set -eux; \
    apk add --no-cache git ca-certificates; \
    arch="$(apk --print-arch)"; \
    case "$arch" in \
      x86_64)  ocm_arch=amd64 ;; \
      aarch64) ocm_arch=arm64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    wget -qO- "https://github.com/open-component-model/ocm/releases/download/v${OCM_VERSION}/ocm-${OCM_VERSION}-linux-${ocm_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin ocm; \
    chmod +x /usr/local/bin/ocm; \
    ocm version; \
    git --version

# No default CMD/ENTRYPOINT is set here on purpose: the backend runs this image with an explicit
# `entrypoint: /bin/sh -c "<build script>"`. A bare run just drops into a shell.
CMD ["/bin/sh"]
