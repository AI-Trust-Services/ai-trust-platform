# Local Kubernetes (kind) deployment

Run the whole platform locally on a single-node [kind](https://kind.sigs.k8s.io/) cluster.

> Deploying to a real **Gardener shoot** (single-tenant, public HTTPS host via the cluster
> gateway) instead of kind? See [SHOOT-INSTALL.md](SHOOT-INSTALL.md).

Both paths use the exact same host ports (see the "Service URLs" table in
`CLAUDE.md`). **Exception:** MinIO's API port is
mapped to **19000** (not 9000) for the kind path — port 9000 is commonly held by
corporate VPN/proxy agents (e.g. Zscaler) on managed laptops. The MinIO console stays
on 9001. If you need to reach the MinIO API from the host with the kind deployment,
use `http://localhost:19000` instead of `:9000`.

## Prerequisites

- `kind`, `kubectl`, `docker`
- `helm` — not installed by default; e.g. `choco install kubernetes-helm` on Windows
- A `.env` at the repo root (copy `.env.example` if you don't have one). If you don't
  have one, `make up` creates it from `.env.example` for you during the `configure` step.

## Single-tenant vs multi-tenant (you choose at install time)

This platform runs in one of two tenancy modes, selected by the `TENANCY_MODE` env var
(a single codebase — no separate build):

| Mode | `TENANCY_MODE` | What it means | Use it for |
|---|---|---|---|
| **Single-tenant** (default) | `single` | One organization. One Keycloak realm, one shared Postgres schema, no per-tenant isolation. | This kind install, any standalone single-org deployment. |
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
make up
# PROMPT tenancy mode → kind create cluster → bootstrap → build/load images → helm install
```

Then open http://localhost:8080 and log in via Keycloak.

`make up` runs these steps individually, in order:

1. `make configure` - **prompts** for the tenancy mode (single vs multi-tenant), creating
   `.env` from `.env.example` on first run and writing your choice to `TENANCY_MODE`. Skip
   with `TENANCY_MODE=<single|jwt> make up`.
2. `make cluster` - `kind create cluster --config k8s/kind-config.yaml` (single node; `extraPortMappings`
   map host ports straight onto NodePort Services — no ingress controller needed, since oauth2-proxy is already the single routing gateway internally).
3. `make bootstrap` - runs `k8s/scripts/bootstrap.sh`, which creates (idempotently) the `ai-trust`
   namespace, a `Secret` called `ai-trust-env` from `.env` (plus a couple of computed connection
   strings, e.g. `DATABASE_URL`), `ConfigMap`s from the existing `infra/postgres/init.sh` and
   `otel-pipeline/**/config` files, and the small RBAC role used by the "wait for job" pattern below.
4. `make build` - runs `k8s/scripts/build-and-load-images.sh`, which `docker build`s all ~22
   locally-built images and `kind load docker-image`s them into the cluster — no registry involved.
5. `make install` - `helm install ai-trust k8s/helm/ai-trust-platform -n ai-trust -f k8s/helm/ai-trust-platform/values-kind.yaml`.
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
- `make down` tears down the Helm release and deletes the whole kind cluster (PVC-backed data goes with it).

## How dependency ordering works

The Kubernetes equivalent of `depends_on: condition:` is implemented with initContainers:

- Deployments that need another **service** to be reachable first get a small `busybox`
  initContainer that polls it (TCP or HTTP) until it responds.
- Deployments/Jobs that need a one-shot **Job** to have finished first get a `rancher/kubectl`
  initContainer running `kubectl wait --for=condition=complete job/<name>`, using the `job-waiter`
  ServiceAccount created by `bootstrap.sh`.

Both patterns are defined once in `k8s/helm/ai-trust-platform/templates/_helpers.tpl` and reused throughout.

## Deploying to a real cluster (Gardener) via OCM + Flux + GitHub Actions

The platform is packaged as an **OCM (Open Component Model) component** and deployed to Gardener shoot clusters via **Flux HelmRelease** — driven entirely by two GitHub Actions workflows.

### How it works end-to-end

```
build-push-deploy.yml
  ├─ prepare job: resolve namespace (ai-trust-main → "ai-trust"; else namespace input or github.actor)
  └─ main-deployment job (single check run on the commit):
       ├─ build & push ~22 Docker images  →  ghcr.io/ai-trust-services/ai-trust-platform/<name>:<prefix>-<sha>
       ├─ build & push Helm chart OCI     →  ghcr.io/ai-trust-services/charts/ai-trust-platform:0.0.0-<prefix>-<sha>
       ├─ publish OCM component           →  ghcr.io/ai-trust-services/ocm  (references images + chart by digest)
       └─ apply-to-cluster composite action:
            ├─ creates namespace/secrets/RBAC via bootstrap.sh
            └─ applies k8s/ocm/ CRs (ComponentVersion, Resource, FluxDeployer), named
               `ai-trust-platform-<namespace>` / `ai-trust-platform-chart-<namespace>` / `ai-trust-<namespace>`,
               substituting the exact built version into ComponentVersion.spec.version.semver

<prefix> = "ai-trust-main" when cluster is ai-trust-main, else the namespace name.

On the cluster (OCM controller + Flux), all scoped to one namespace:
  ComponentVersion  →  resolves the exact pinned OCM component version
  Resource          →  exposes the ai-trust-platform-chart resource
  FluxDeployer      →  creates/updates a HelmRelease (release name ai-trust-<namespace>) in ocm-system
  Flux helm-controller  →  helm upgrade --install ai-trust-<namespace> in <namespace>
```

Deployments are **namespace-scoped**, so a single cluster can host several concurrent
deployments side by side. Two namespace conventions are in use today:
- `ai-trust-main` always deploys to namespace **`ai-trust`** — the platform's existing,
  long-running namespace, kept as the default so this cluster is never re-provisioned
  from scratch.
- `ai-trust-test` hosts one namespace per developer/PR, derived from the PR author or
  `github.actor` (see **PR deployment test** below) — multiple people can test
  concurrently on the same cluster without colliding.

### Workflows

- **`build-push-deploy.yml`** — runs on every push to `main` or manually via `workflow_dispatch`
  (inputs: `branch`, `gardener_cluster` [`ai-trust-main` | `ai-trust-test`], `namespace`). Produces a
  **single `main-deployment` check run** on the commit. Namespace is resolved in a `prepare` job:
  `ai-trust-main` always resolves to `ai-trust`; any other cluster uses the explicit `namespace` input,
  falling back to `github.actor` (lowercase). Images are tagged `<prefix>-<short-sha>` where the prefix
  is `ai-trust-main` for the production cluster and the namespace name otherwise — isolated per
  namespace so concurrent deployments never collide. OCM component version: `0.0.0-<prefix>-<sha>`.
  The deployment step is the `.github/actions/apply-to-cluster` composite action (shared with the PR
  deploy path).

**Two secrets, two namespaces:** bootstrap.sh creates two distinct secrets per cluster+namespace:
- `ai-trust-env` in `<namespace>` — the full credential set from `.env` (plus computed connection
  strings). Used by Helm chart pods via `envFrom`.
- `ai-trust-flux-values-<namespace>` in `ocm-system` — only the 6 non-sensitive URL/hostname/tag values
  (`APP_PUBLIC_URL`, `KEYCLOAK_PUBLIC_URL`, `INGRESS_*`, `IMAGE_TAG`). Used by the FluxDeployer's
  `valuesFrom`.

  The split is necessary because Flux's `HelmRelease` object is created in `ocm-system` (same
  namespace as the FluxDeployer), and Flux resolves `valuesFrom` secrets relative to the
  HelmRelease's own namespace. Flux v2 `ValuesReference` has no `namespace` override field, so
  there is no way to reference a secret in `<namespace>` from a `valuesFrom` entry — the secret
  must live in `ocm-system`. Credentials stay only in `ai-trust-env` to avoid storing them in
  the FluxDeployer's namespace unnecessarily.

### PR deployment test

Adding the **`garden-deploy` label** to a PR (`.github/workflows/pr-deployment-test.yml`) deploys the
PR branch to a namespace derived from the PR author, on `ai-trust-test` — so several PRs or developers
can test concurrently without colliding. The namespace must be initialized once before first use:
```bash
bash k8s/gardener_init/shoot-cluster-init.sh ai-trust-test --namespace=<github-username>
```
The workflow runs the whole build→package→publish→deploy pipeline as steps in a **single job**
(`namespace-deployment-test`) using composite actions (`compute-vars`, `build-images`, `package-chart`,
`publish-ocm`, `apply-to-cluster`) — the same composite actions used by `build-push-deploy.yml`. Images are built in
parallel via `docker buildx bake` (`docker-bake.hcl`) — shared with `build-push-deploy.yml`,
so a new image only needs one `target` + `group "default"` entry in `docker-bake.hcl` (see [CLAUDE.md](../CLAUDE.md)
"Adding a new service"). It reports progress via PR comments; the single job's pass/fail **is** the PR check
(`namespace-deployment-test`) — there is no separate `deploy-test` commit status.

### Integration tests

`tests/integration/` runs cross-service API tests against a **live cluster** via `kubectl port-forward`. The `Integration Tests` workflow (`.github/workflows/integration-tests.yml`) triggers automatically after a successful `PR Deployment Test` or `Deployment Workflow`, and on demand via **Run workflow** — it is a separate workflow and does not affect deployment status. It reports its result as an `integration-tests` commit status on the deployed commit.

**Run locally** after `make up`:

```bash
make test-int    # kind cluster, namespace ai-trust
```

The make targets here are kind-only — the namespace is fixed to `ai-trust`. Targeting a remote Gardener
namespace, the per-test configuration env vars, and the full suite breakdown are documented in
[tests/integration/README.md](../tests/integration/README.md).

### OCM component structure

The component descriptor lives at `ghcr.io/ai-trust-services/ocm` and contains **references** (not
copies) to the images and chart already pushed by the build step. Nothing is duplicated in the
registry. The component constructor is `.ocm/component-constructor.yaml`.

`k8s/ocm/manifests.yaml` pins `ComponentVersion.spec.version.semver` via a `${OCM_VERSION}`
placeholder, and names every CR (ComponentVersion, Resource, FluxDeployer, HelmRelease) via
`${NAMESPACE}` — the `apply-to-cluster` composite action substitutes both at deploy time. To apply it by hand,
supply both yourself (a bare `kubectl apply -f k8s/ocm/` would apply the literal placeholders and
fail):
```bash
OCM_VERSION=0.0.0-<namespace>-<sha> NAMESPACE=<namespace> \
  envsubst '${OCM_VERSION} ${NAMESPACE}' < k8s/ocm/manifests.yaml | kubectl apply -f -
```

To inspect published versions:
```bash
ocm get componentversions ghcr.io/ai-trust-services/ocm//github.com/ai-trust-services/ai-trust-platform
ocm get resources ghcr.io/ai-trust-services/ocm//github.com/ai-trust-services/ai-trust-platform:0.0.0-<namespace>-<sha>
```

### Checking OCM/Flux deploy status on a cluster

Substitute `<namespace>` below (`ai-trust` on `ai-trust-main`, or the developer/PR namespace on
`ai-trust-test`):

```bash
# Which version is reconciled
kubectl get componentversion ai-trust-platform-<namespace> -n ocm-system \
  -o jsonpath='{.status.reconciledVersion}{"\n"}'

# HelmRelease status (shows chart version + success/failure message)
kubectl get helmrelease ai-trust-<namespace> -n ocm-system -o wide

# Pod image tags (verify the correct SHA is running)
kubectl get pods -n <namespace> \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# Events from the OCM controller
kubectl describe componentversion ai-trust-platform-<namespace> -n ocm-system | tail -20
```

Note: the `Applied version:` column in `kubectl get componentversion` output is blank due to a
known display bug in ocm-controller v0.33. The correct value is in `.status.reconciledVersion`.

### Version isolation between namespaces and clusters

| Scenario | OCM version published | Deploys to |
|---|---|---|
| Push to `main` | `0.0.0-ai-trust-main-<sha>` | `ai-trust-main`, namespace `ai-trust` |
| `garden-deploy` label on a PR | `0.0.0-<pr-author>-<sha>` | `ai-trust-test`, namespace `<pr-author>` |
| `workflow_dispatch` → `ai-trust-test` | `0.0.0-<namespace>-<sha>` | `ai-trust-test`, namespace input or `github.actor` |
| `workflow_dispatch` → `ai-trust-main` | `0.0.0-ai-trust-main-<sha>` | `ai-trust-main`, namespace `ai-trust` |

Per-namespace SHA prefixes ensure versions never collide, even across concurrent namespaces on the
same cluster. `--overwrite` in the publish step is safe because re-running the same workflow on the
same commit is the only case that hits the same version string.

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
bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name> [--namespace=<namespace>]
# Hostnames read from k8s/gardener_init/env/<cluster-name>/.env
# --namespace defaults to "ai-trust"; pass it to additionally provision a
# developer/PR namespace on a shared cluster (e.g. ai-trust-test --namespace=alice)
```

`shoot-cluster-init.sh` runs the same 5 steps for every namespace (nothing is special-cased) and
installs:
- **Traefik** ingress controller (if not present)
- A per-namespace Gardener-managed TLS certificate (DNS-01, Let's Encrypt, stored in
  `<namespace>/ai-trust-tls`) and Traefik `ServersTransport` for LLM-backed routes
- DNS: merges this namespace's hostnames into the Traefik LB Service's
  `dns.gardener.cloud/dnsnames` annotation (rather than overwriting it), so multiple namespaces
  sharing one cluster keep resolving
- **OCM controller** via `ocm controller install`
- **Flux** via `flux install` (source-controller + helm-controller)
- RBAC for the GitHub Actions OIDC identity, scoped to this namespace + `ocm-system`

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
3. Run `bash k8s/gardener_init/shoot-cluster-init.sh <cluster-name>` (installs OCM controller, Flux, Traefik, DNS, TLS cert, RBAC for the default `ai-trust` namespace; pass `--namespace=<name>` for additional namespaces)
4. Create `k8s/env/<cluster-name>/.env` (copy from `k8s/env/ai-trust-test/.env`, fill in Gardener connection vars and hostnames)
5. Add `<cluster-name>` to the `options` list in the `build-push-deploy.yml` `workflow_dispatch` input for `gardener_cluster`, and add the matching `k8s/env/<cluster-name>/.env` entry for `integration-tests.yml`
6. Trigger `build-push-deploy.yml` with `gardener_cluster=<cluster-name>`

## Known limitations / gaps (local kind scope)

- Single-node only for kind: `postgres-data`, `clickhouse-data`, `minio-data`, and `ollama-data`
  are `ReadWriteOnce` PVCs on kind's default local-path-provisioner — fine on a single schedulable
  node (kind's default), but won't work if you add worker nodes to `kind-config.yaml`.
  On Gardener (multi-node), all four are managed as **StatefulSet `volumeClaimTemplates`** so the
  CSI driver handles detach/reattach when a pod reschedules to a different node.
- No resource `requests`/`limits`.
- No HTTPS / `cookie-secure=true` — same as a local-dev oauth2-proxy config.
- ReadWriteOnce access mode can not scale the deployment that mounts such volume. Apply ReadWriteMany for scalable application.
- No horizontal pod autoscalers.
