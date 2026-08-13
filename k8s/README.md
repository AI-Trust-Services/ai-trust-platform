# Local Kubernetes (kind) deployment

An alternative to `docker compose up` for running the whole platform locally, on a
single-node [kind](https://kind.sigs.k8s.io/) cluster. **docker-compose remains fully
supported** - this is a second, independent deployment path that shares the same
`.env` file, so there is nothing to keep in sync by hand.

Both paths use the exact same host ports (see the "Service URLs" table in
`CLAUDE.md`), so don't run docker-compose and this kind cluster at the same time -
they'll fight over ports 8080, 8180, 5432, etc. **Exception:** MinIO's API port is
mapped to **19000** (not 9000) for the kind path only — port 9000 is commonly held by
corporate VPN/proxy agents (e.g. Zscaler) on managed laptops. The MinIO console stays
on 9001. If you need to reach the MinIO API from the host with the kind deployment,
use `http://localhost:19000` instead of `:9000`.

## Prerequisites

- `kind`, `kubectl`, `docker` (already required for docker-compose)
- `helm` - not installed by default; e.g. `choco install kubernetes-helm` on Windows
- A `.env` at the repo root (copy `.env.example` if you don't have one)

## Quick start

```bash
cd k8s
make up      # kind create cluster + bootstrap + build/load images + helm install
```

Then open http://localhost:8080 and log in via Keycloak, same as with docker-compose.

`make up` runs these steps individually, in order:

1. `make cluster` - `kind create cluster --config kind-config.yaml` (single node; `extraPortMappings`
   map the same host ports docker-compose uses today straight onto NodePort Services - no ingress
   controller needed, since oauth2-proxy is already the single routing gateway internally).
2. `make bootstrap` - runs `scripts/bootstrap.sh`, which creates (idempotently) the `ai-trust`
   namespace, a `Secret` called `ai-trust-env` from `.env` (plus a couple of computed connection
   strings, e.g. `DATABASE_URL`, that docker-compose builds via YAML anchors), `ConfigMap`s from the
   existing `infra/postgres/init.sh` and `otel-pipeline/**/config` files, and the small RBAC role
   used by the "wait for job" pattern below.
3. `make build` - runs `scripts/build-and-load-images.sh`, which `docker build`s all ~22
   locally-built images (same context/Dockerfile/build-args as the matching docker-compose
   service) and `kind load docker-image`s them into the cluster - no registry involved.
4. `make install` - `helm install ai-trust helm/ai-trust-platform -n ai-trust`.

Watch it come up with `make status` or `kubectl get pods -n ai-trust -w`. One-shot Jobs
(`db-migrate`, `clickhouse-migrate`, `minio-init`, `keycloak-provision`, `openfga-migrate`,
`openfga-provision`) should reach `Completed`; everything else should reach `Running`.

## Day-to-day

- Rebuilt an image after a code change? `make build` again, then
  `kubectl rollout restart deployment/<name> -n ai-trust` (or `make upgrade` to reapply everything).
- Changed something a one-shot **Job** runs (e.g. added a migration)? Jobs are immutable once
  created, so: `make build` (rebuilds the image) → `make reset-jobs` (deletes the old Jobs) →
  `make upgrade` (recreates them, and everything that waits on them will re-check).
- `make down` tears down the Helm release and deletes the whole kind cluster (equivalent to
  `docker compose down --remove-orphans`, but also throws away the cluster itself, not just the
  containers - PVC-backed data goes with it).

## How dependency ordering works (no image/app changes)

docker-compose's `depends_on: condition: service_healthy` / `service_completed_successfully` has
no direct Kubernetes equivalent, and none of the app images were changed to add one. Instead:

- Deployments that need another **service** to be reachable first get a small `busybox`
  initContainer that polls it (TCP or HTTP) until it responds.
- Deployments/Jobs that need a one-shot **Job** to have finished first get a `bitnami/kubectl`
  initContainer running `kubectl wait --for=condition=complete job/<name>`, using the `job-waiter`
  ServiceAccount created by `bootstrap.sh`.

Both patterns are defined once in `helm/ai-trust-platform/templates/_helpers.tpl` and reused
everywhere docker-compose had a `depends_on`.

## Known limitations (local-dev scope, same as docker-compose today)

- Single-node only: `openfga-config`, `postgres-data`, `clickhouse-data`, and `minio-data` are all
  `ReadWriteOnce` PVCs on kind's default local-path-provisioner - fine on a single schedulable node
  (kind's default), but won't work if you add worker nodes to `kind-config.yaml`.
- No resource `requests`/`limits` (docker-compose doesn't set any either).
- No HTTPS / `cookie-secure=true` - same as docker-compose's local-dev oauth2-proxy config.
