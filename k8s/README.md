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

## Deploying to a real cluster (Gardener) via GitHub Actions

A third path, alongside docker-compose and local `kind`: two workflows under `.github/workflows/`
build/push images to `ghcr.io` and deploy this same Helm chart to a real Gardener shoot cluster.
Unlike the kind path (images loaded directly, no registry), this path needs a registry and a
values overlay (`values-gardener.yaml`) that swaps NodePort services for a real Ingress.

- **`build-push.yml`** - runs on every push to `main` and on version tags (`v*.*.*`), or manually.
  Builds all ~22 locally-built images (same context/Dockerfile/build-args as
  `k8s/scripts/build-and-load-images.sh`) and pushes each to
  `ghcr.io/<owner>/ai-trust-platform/<name>`, tagged with the short commit SHA (or the tag name)
  and `latest`. Frontend Vite build-args come from repo **variables** (`VITE_REGISTRY_API_BASE`,
  etc.) with the same defaults as `.env.example`, so it works out of the box even if unset.
- **`deploy-gardener.yml`** - manual (`workflow_dispatch`) only, takes the image tag to roll out as
  input. Authenticates to the shoot cluster via Gardener's **Structured Authentication** + GitHub
  OIDC (no kubeconfig secret - see below), writes a `.env` from a secret, re-runs the existing
  `k8s/scripts/bootstrap.sh` unchanged (namespace/Secret/ConfigMaps/RBAC - same script as the kind
  path), then `helm upgrade --install` with `values-gardener.yaml` layered on top of `values.yaml`.

### Cluster authentication - Structured Authentication + GitHub OIDC

Follows Gardener's official guide,
[Kubernetes Application CI/CD using Structured Authentication](https://gardener.cloud/docs/guides/applications/app-ci-cd/#configure-github-actions):
GitHub's OIDC token is exchanged directly for cluster access via the shoot's kube-apiserver - no
kubeconfig ever leaves GitHub, nothing long-lived to leak or rotate. This replaced an earlier,
simpler design (a static `ServiceAccount` token bound to `cluster-admin`, stored as a
`GARDENER_KUBECONFIG` secret) once the official guide surfaced this as the supported approach.

One-time setup per cluster, checked into `k8s/gardener_init/`. Two scripts, run in order:

```bash
# Step 1 — Garden cluster: enable Traefik ingress extension + structured auth
export KUBECONFIG=/path/to/kubeconfig-garden-<landscape>.yaml
bash k8s/gardener_init/garden-cluster-init.sh <cluster-name>

# Step 2 — Shoot cluster: install Traefik, apply RBAC + cert-manager issuer
export KUBECONFIG=/path/to/kubeconfig-<shoot>.yaml
bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>
```

Or apply manually:

1. **`structured-auth-configmap.yaml`** - applied to the **Garden** cluster (not the shoot), in
   your project's `garden-<project>` namespace. Trusts `https://token.actions.githubusercontent.com`
   as an OIDC issuer and maps any GitHub Actions run in `AI-Trust-Services/ai-trust-platform` (any
   branch/ref - see the comment in the file for why) to a stable Kubernetes username. Edit
   `metadata.namespace` before applying, then patch the shoot to use it:
   ```bash
   KUBECONFIG=$GARDEN_KUBECONFIG kubectl apply -f k8s/gardener_init/structured-auth-configmap.yaml
   kubectl patch shoot $MY_SHOOT_NAME --type merge --namespace garden-<project> \
     -p '{"spec":{"kubernetes":{"kubeAPIServer":{"structuredAuthentication":{"configMapName":"ai-trust-platform-github-actions-auth"}}}}}'
   kubectl get shoot $MY_SHOOT_NAME --watch   # wait for reconciliation to finish
   ```
2. **`rbac.yaml`** - applied to the **shoot** cluster, once reconciliation above completes:
   ```bash
   KUBECONFIG=$SHOOT_KUBECONFIG kubectl apply -f k8s/gardener_init/rbac.yaml
   ```
3. **`cert-manager-issuer.yaml`** - applied once to the **shoot** cluster. Edit the `email` field before applying:
   ```bash
   KUBECONFIG=$SHOOT_KUBECONFIG kubectl apply -f k8s/gardener_init/cert-manager-issuer.yaml
   ```

Required GitHub secrets in the `gardener` environment:

| Secret | Purpose |
|---|---|
| `GHCR_PULL_TOKEN` | (optional) PAT with `read:packages` — only needed if `ghcr.io` packages are private |

All other cluster config (Gardener connection vars, app env) lives in `k8s/env/<cluster>/.env`,
committed to the repo. No per-cluster GitHub secrets or variables needed.

The chart assumes Traefik Ingress controller and cert-manager are already installed on the shoot
(`values-gardener.yaml` sets `ingress.className: traefik`). `oauth2-proxy` and `keycloak` switch
from NodePort to ClusterIP in this overlay and are reached through the Ingress.

**Do not point the workflow at the kubeconfig from the Gardener dashboard / `gardenctl target`** -
that one authenticates via an `exec:` credential plugin (`kubectl-gardenlogin`) that does an
interactive OIDC login and has no way to run non-interactively on a GitHub Actions runner. The
Structured Authentication setup above avoids needing any kubeconfig in CI at all.

### Adding a new cluster

1. Run `bash k8s/gardener_init/garden-cluster-init.sh <cluster-name>` (Garden cluster — structured auth)
2. Run `bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>` (shoot cluster — Traefik, RBAC, cert-manager issuer)
3. Get the Traefik LoadBalancer IP: `KUBECONFIG=<shoot-kubeconfig> kubectl get svc -A | grep LoadBalancer`
4. Create `k8s/env/<cluster-name>/.env` (copy from `k8s/env/sr-test/.env`, fill in LB IP and Gardener vars)
5. Add `<cluster-name>` to the `options` list in `.github/workflows/deploy-gardener.yml`
6. Trigger `deploy-gardener.yml` with `cluster=<cluster-name>`

The `ai-trust-main` cluster has its env at `k8s/env/ai-trust-main/.env` — fill in the `<LB_IP>` placeholders once Traefik is installed.

## Known limitations / gaps as of local-dev scope (same as docker-compose today)

- Single-node only: `openfga-config`, `postgres-data`, `clickhouse-data`, and `minio-data` are all
  `ReadWriteOnce` PVCs on kind's default local-path-provisioner - fine on a single schedulable node
  (kind's default), but won't work if you add worker nodes to `kind-config.yaml`.
- No resource `requests`/`limits` (docker-compose doesn't set any either).
- No HTTPS / `cookie-secure=true` - same as docker-compose's local-dev oauth2-proxy config.
- mino scaling: handling multiple volumes - based on that decide how to makr those PVC.
- scaling postgres - define the configuration of volumes.
- ReadWriteOnce access mode:can not scale the deployment that mounts such volume.
- horizontal pod autoscalers.
- NodePort to replace by ClusterIP.
- On the Gardener path, postgres/rabbitmq/clickhouse/minio are still exposed via NodePort (same as
  kind) rather than ClusterIP-only - fine if the shoot's nodes aren't publicly routable/firewalled,
  otherwise these backing stores are reachable from outside the cluster. Only `oauth2-proxy` and
  `keycloak` (the two endpoints that need to be public) were switched to Ingress+ClusterIP.