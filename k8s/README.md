# Local Kubernetes (kind) deployment

An alternative to `docker compose up` for running the whole platform locally, on a
single-node [kind](https://kind.sigs.k8s.io/) cluster. **docker-compose remains fully
supported** - this is a second, independent deployment path that shares the same
`.env` file, so there is nothing to keep in sync by hand.

> Deploying to a real **Gardener shoot** (single-tenant, public HTTPS host via the cluster
> gateway) instead of kind? See [SHOOT-INSTALL.md](SHOOT-INSTALL.md).

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
- A `.env` at the repo root (copy `.env.example` if you don't have one). If you don't
  have one, `make up` creates it from `.env.example` for you during the `configure` step.

## Single-tenant vs multi-tenant (you choose at install time)

This platform runs in one of two tenancy modes, selected by the `TENANCY_MODE` env var
(a single codebase — no separate build):

| Mode | `TENANCY_MODE` | What it means | Use it for |
|---|---|---|---|
| **Single-tenant** (default) | `single` | One organization. One Keycloak realm, one shared Postgres schema, no per-tenant isolation. | docker-compose, this kind install, any standalone single-org deployment. |
| **Multi-tenant** | `jwt` | Tenant resolved from a `tenant_id` OIDC claim; data isolated per tenant (schema-per-tenant Postgres + role, per-tenant Keycloak realm, per-tenant ClickHouse DB / MinIO bucket). Requires `TENANCY_JWKS_ISSUER_BASE`. | SaaS / MSP deployments. Normally installed via the MSP operator bundle, **not** this kind path. |

**`make up` PROMPTS you to pick one** (the `configure` step) and writes `TENANCY_MODE`
into `.env` before anything is deployed. To skip the prompt (CI / scripted installs),
set it explicitly: `TENANCY_MODE=single make up`. To change it later:
`make configure` then `make bootstrap upgrade`.

> The plain kind install targets **single-tenant**. Multi-tenant (`jwt`) additionally
> needs a per-tenant Keycloak realm and `TENANCY_JWKS_ISSUER_BASE` set, which the MSP
> operator provisions — selecting `jwt` here without that wiring will not give you a
> working multi-tenant cluster on its own.

## Quick start

```bash
cp .env.example .env
cd k8s
make up      
# PROMPT tenancy mode → kind create cluster → bootstrap → build/load images → helm install
```

Then open http://localhost:8080 and log in via Keycloak, same as with docker-compose.

`make up` runs these steps individually, in order:

1. `make configure` - **prompts** for the tenancy mode (single vs multi-tenant), creating
   `.env` from `.env.example` on first run and writing your choice to `TENANCY_MODE`. Skip
   with `TENANCY_MODE=<single|jwt> make up`.
2. `make cluster` - `kind create cluster --config kind-config.yaml` (single node; `extraPortMappings`
   map the same host ports docker-compose uses today straight onto NodePort Services - no ingress
   controller needed, since oauth2-proxy is already the single routing gateway internally).
3. `make bootstrap` - runs `scripts/bootstrap.sh`, which creates (idempotently) the `ai-trust`
   namespace, a `Secret` called `ai-trust-env` from `.env` (plus a couple of computed connection
   strings, e.g. `DATABASE_URL`, that docker-compose builds via YAML anchors), `ConfigMap`s from the
   existing `infra/postgres/init.sh` and `otel-pipeline/**/config` files, and the small RBAC role
   used by the "wait for job" pattern below.
4. `make build` - runs `scripts/build-and-load-images.sh`, which `docker build`s all ~22
   locally-built images (same context/Dockerfile/build-args as the matching docker-compose
   service) and `kind load docker-image`s them into the cluster - no registry involved.
5. `make install` - `helm install ai-trust helm/ai-trust-platform -n ai-trust -f helm/ai-trust-platform/values-kind.yaml`.
   The `values-kind.yaml` overlay switches all infra services from `ClusterIP` (the chart default,
   safe for any real cluster) to `NodePort` so that `kind-config.yaml` `extraPortMappings` can bind
   them to localhost. **Never apply `values-kind.yaml` on a real cluster** — it exposes postgres,
   rabbitmq, clickhouse, minio, and the OTel collector on every node's IP.

Watch it come up with `make status` or `kubectl get pods -n ai-trust -w`. One-shot Jobs
(`db-migrate`, `clickhouse-migrate`, `minio-init`, `keycloak-provision`, `openfga-migrate`,
`openfga-provision`) should reach `Completed`; everything else should reach `Running`.

## Day-to-day

- Rebuilt an image after a code change? `make build` again, then
  `kubectl rollout restart deployment/<name> -n ai-trust` (or `make upgrade` to reapply everything).
- Changed something a one-shot **Job** runs (e.g. added a migration)? `make build` (rebuilds the image) → `make upgrade`. Each upgrade renders the Jobs under a new per-revision name (`<base>-r<N>`), so Helm creates fresh Jobs and prunes the previous revision's automatically — no manual cleanup, no Job immutability error (see [Per-revision Job names](#per-revision-job-names-one-shot-jobs)).
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

## Deploying to a real cluster (Gardener) via OCM + Flux + GitHub Actions

A third path, alongside docker-compose and local `kind`. The platform is packaged as an
**OCM (Open Component Model) component** and deployed to Gardener shoot clusters via
**Flux HelmRelease** — driven entirely by two GitHub Actions workflows.

### How it works end-to-end

```
build-push-deploy.yml
  ├─ build & push ~22 Docker images  →  ghcr.io/ai-trust-services/ai-trust-platform/<name>:<cluster>-<sha>
  ├─ build & push Helm chart OCI     →  ghcr.io/ai-trust-services/charts/ai-trust-platform:0.0.0-<cluster>-<sha>
  ├─ publish OCM component           →  ghcr.io/ai-trust-services/ocm  (references images + chart by digest)
  └─ calls bootstrap-gardener.yml
       ├─ creates namespace/secrets/RBAC via bootstrap.sh
       └─ applies k8s/ocm/ CRs (ComponentVersion, Resource, FluxDeployer),
          substituting the exact built version into ComponentVersion.spec.version.semver

On the cluster (OCM controller + Flux):
  ComponentVersion  →  resolves the exact pinned OCM component version
  Resource          →  exposes the ai-trust-platform-chart resource
  FluxDeployer      →  creates/updates a HelmRelease in ocm-system
  Flux helm-controller  →  helm upgrade --install ai-trust in ai-trust namespace
```

### Workflows

- **`build-push-deploy.yml`** — runs on every push to `main`, on version tags (`v*.*.*`), or manually
  via `workflow_dispatch` (inputs: `branch`, `gardener_cluster`). Tags images
  `<cluster>-<short-sha>` (isolated per cluster); `ai-trust-main` builds additionally tag `latest`.
  OCM component version: `0.0.0-<cluster>-<sha>`. Feature branch pushes build images but do NOT
  publish OCM or trigger a deploy (set `gardener_cluster=sr-test` in `workflow_dispatch` to deploy
  from a feature branch).

- **`bootstrap-gardener.yml`** — called by `build-push-deploy.yml` after successful publish, or manually.
  Contains two jobs — `bootstrap-main` (runs under the `main` GitHub environment, so deploys appear
  in the GitHub Deployments sidebar) and `bootstrap-other` (all other clusters/branches, no
  environment). Both jobs delegate to the **`.github/actions/apply-to-cluster`** composite action,
  which: authenticates via Gardener Structured Auth + GitHub OIDC (no stored kubeconfig); runs
  `k8s/scripts/bootstrap.sh` (namespace, `ai-trust-env` secret, `ai-trust-flux-values` secret in
  `ocm-system`, ConfigMaps, RBAC); applies `k8s/ocm/` with the exact built version substituted into
  `ComponentVersion.spec.version.semver` (an exact-match pin, not a range); then **polls the
  HelmRelease** every 60 s until it reaches `Ready=True` at the expected version — failing fast on
  `InstallFailed`/`UpgradeFailed` and timing out after 30 minutes.

**Two secrets, two namespaces:** bootstrap.sh creates two distinct secrets per cluster:
- `ai-trust-env` in `ai-trust` — the full credential set from `.env` (plus computed connection
  strings). Used by Helm chart pods via `envFrom`.
- `ai-trust-flux-values` in `ocm-system` — only the 6 non-sensitive URL/hostname/tag values
  (`APP_PUBLIC_URL`, `KEYCLOAK_PUBLIC_URL`, `INGRESS_*`, `IMAGE_TAG`). Used by the FluxDeployer's
  `valuesFrom`.

  The split is necessary because Flux's `HelmRelease` object is created in `ocm-system` (same
  namespace as the FluxDeployer), and Flux resolves `valuesFrom` secrets relative to the
  HelmRelease's own namespace. Flux v2 `ValuesReference` has no `namespace` override field, so
  there is no way to reference a secret in `ai-trust` from a `valuesFrom` entry — the secret
  must live in `ocm-system`. Credentials stay only in `ai-trust-env` to avoid storing them in
  the FluxDeployer's namespace unnecessarily.

### OCM component structure

The component descriptor lives at `ghcr.io/ai-trust-services/ocm` and contains **references** (not
copies) to the images and chart already pushed by the build step. Nothing is duplicated in the
registry. The component constructor is `.ocm/component-constructor.yaml`.

`k8s/ocm/manifests.yaml` pins `ComponentVersion.spec.version.semver` via a `${OCM_VERSION}`
placeholder — `bootstrap-gardener.yml` substitutes the exact built version at apply time. To
apply it by hand, supply the version yourself (a bare `kubectl apply -f k8s/ocm/` would apply
the literal placeholder and fail):
```bash
OCM_VERSION=0.0.0-<cluster>-<sha> envsubst '${OCM_VERSION}' < k8s/ocm/manifests.yaml | kubectl apply -f -
```

To inspect published versions:
```bash
ocm get componentversions ghcr.io/ai-trust-services/ocm//github.com/ai-trust-services/ai-trust-platform
ocm get resources ghcr.io/ai-trust-services/ocm//github.com/ai-trust-services/ai-trust-platform:0.0.0-<cluster>-<sha>
```

### Checking OCM/Flux deploy status on a cluster

```bash
# Which version is reconciled
kubectl get componentversion ai-trust-platform -n ocm-system \
  -o jsonpath='{.status.reconciledVersion}{"\n"}'

# HelmRelease status (shows chart version + success/failure message)
kubectl get helmrelease ai-trust-platform -n ocm-system -o wide

# Pod image tags (verify the correct SHA is running)
kubectl get pods -n ai-trust \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# Events from the OCM controller
kubectl describe componentversion ai-trust-platform -n ocm-system | tail -20
```

Note: the `Applied version:` column in `kubectl get componentversion` output is blank due to a
known display bug in ocm-controller v0.33. The correct value is in `.status.reconciledVersion`.

### Version isolation between branches and clusters

| Scenario | OCM version published | Deploys to |
|---|---|---|
| Push to `main` | `0.0.0-ai-trust-main-<sha>` + `0.0.0-latest` | `ai-trust-main` |
| `workflow_dispatch` → sr-test | `0.0.0-sr-test-<sha>` | `sr-test` |
| Feature branch push | *(not published)* | nowhere |
| `workflow_dispatch` gardener_cluster=none | *(not published)* | nowhere |

Per-cluster SHA prefixes ensure versions never collide. `--overwrite` in the publish step is safe
because re-running the same workflow on the same commit is the only case that hits the same version
string.

### Per-revision Job names (one-shot Jobs)

All init/migration Jobs (`db-migrate`, `clickhouse-migrate`, `minio-init`, `keycloak-ssl-patch`,
`keycloak-provision`, `openfga-migrate`, `openfga-provision`) are **plain Helm resources** whose
`metadata.name` carries a per-release-revision suffix — `<base>-r<.Release.Revision>` — via the
`ai-trust.jobName` helper in `_helpers.tpl`.

Kubernetes Jobs are immutable (`spec.template: field is immutable`): on `helm upgrade`, patching an
existing completed Job of the same name fails. Because every upgrade bumps `.Release.Revision`, each
deploy renders a **new** Job name, so the upgrade is a *create*, not a *patch* — the immutability
error can't occur. Helm prunes the previous revision's Job automatically (it's absent from the new
manifest), so there is no `ttlSecondsAfterFinished` time-race and no CI-side `kubectl delete`. Flux's
helm-controller inherits this same behaviour, so OCM/Flux version bumps upgrade cleanly regardless of
how frequently they fire.

On a **fresh install** the Jobs apply in the same pass as the infra Deployments; each Job's own
`waitForTcp`/`waitForHttp` initContainer blocks until its backing service (postgres, clickhouse,
minio, keycloak…) is reachable — there are no pre-install hooks to deadlock on. Ordering between
Jobs still uses the `waitForJob` initContainer, which resolves the **same** per-revision name through
`ai-trust.jobName`, so the wait target always matches the current revision's Job
(`keycloak-ssl-patch` → `keycloak-provision`, `openfga-migrate` → `openfga` → `openfga-provision`).

> Migrating an **already-deployed** cluster from the old hook-based scheme: the old Jobs were Helm
> hook resources not tracked in the release manifest, so the first upgrade to this scheme won't prune
> them. Delete them once manually (they're completed one-shots, safe to remove):
> `kubectl delete job -n ai-trust db-migrate clickhouse-migrate minio-init keycloak-ssl-patch keycloak-provision openfga-migrate openfga-provision`.
> Fresh clusters and kind are unaffected.

### Cluster authentication — Structured Authentication + GitHub OIDC

GitHub's OIDC token is exchanged directly for cluster access via the shoot's kube-apiserver — no
kubeconfig stored as a secret, nothing long-lived to rotate.

One-time setup per cluster:

```bash
# Step 1 — Garden cluster: enable structured auth
export KUBECONFIG=/path/to/kubeconfig-garden-<landscape>.yaml
bash k8s/gardener_init/garden-cluster-init.sh <cluster-name>

# Step 2 — Shoot cluster: install OCM controller + Flux, Traefik, DNS + TLS cert, RBAC
export KUBECONFIG=/path/to/kubeconfig-<shoot>.yaml
bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>
# Hostnames read from k8s/gardener_init/env/<cluster-name>/.env
```

`shoot-cluster-init.sh` installs:
- **Traefik** ingress controller (if not present)
- **OCM controller** via `ocm controller install`
- **Flux** via `flux install` (source-controller + helm-controller)
- Gardener-managed TLS certificate (DNS-01, Let's Encrypt, stored in `ai-trust/ai-trust-tls`)
- DNS annotations on the Traefik LB Service
- RBAC for the GitHub Actions OIDC identity

> **Do not install cert-manager manually.** Gardener provisions and manages it automatically in a
> dedicated `cert-manager` namespace. If you see cert-manager pods CrashLooping in the `default`
> namespace, those are stale orphans from a previous install — delete them with:
> `kubectl delete deployment,service,serviceaccount -n default -l app.kubernetes.io/instance=cert-manager`

Required GitHub secrets in the `gardener` environment:

| Secret | Purpose |
|---|---|
| `GHCR_PULL_TOKEN` | (optional) PAT with `read:packages` — only needed if packages are private |

All other config lives in `k8s/env/<cluster>/.env` (committed). No per-cluster GitHub secrets needed.

### Adding a new cluster

1. Run `bash k8s/gardener_init/garden-cluster-init.sh <cluster-name>` (Garden cluster — structured auth)
2. Copy `k8s/gardener_init/env/example/.env` → `k8s/gardener_init/env/<cluster-name>/.env` and fill in hostnames
3. Run `bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>` (installs OCM controller, Flux, Traefik, DNS, TLS cert, RBAC)
4. Create `k8s/env/<cluster-name>/.env` (copy from `k8s/env/sr-test/.env`, fill in Gardener connection vars and hostnames)
5. Add `<cluster-name>` to the `options` list in `build-push-deploy.yml` and `bootstrap-gardener.yml` `workflow_dispatch` inputs
6. Trigger `build-push-deploy.yml` with `gardener_cluster=<cluster-name>`

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
- NodePort to replace by ClusterIP. ✓ Done — ClusterIP is now the default for all services; `values-kind.yaml` opt-in for local dev.