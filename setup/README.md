# AI Trust Platform — portable installer

One-command, cluster-agnostic, OS-independent install of the **AI Trust Platform**
(EU AI Act compliance) as a **standalone** app — its own Keycloak + oauth2-proxy,
Postgres, ClickHouse, MinIO, RabbitMQ, and all the app components — onto **any**
Kubernetes cluster.

No cloud, no Gardener, and no Platform Mesh are assumed. The app is built from the
upstream git repo and exposed via a standard Kubernetes Ingress (or a Gateway-API
Gateway, or a local `kind` cluster — your choice).

---

## Quick start

```bash
# 1. configure
cp prerequisites/config.env.example prerequisites/config.env
$EDITOR prerequisites/config.env            # set APP_DOMAIN, APP_URL, REGISTRY

# 2. point kubectl at your cluster
export KUBECONFIG=/path/to/kubeconfig       # or: kubectl config use-context <ctx>
docker login <your-registry>                # skip for INGRESS_MODE=kind

# 3. install
./scripts/deploy.sh
```

On Windows (native, no WSL required for the k8s steps):

```powershell
Copy-Item prerequisites\config.env.example prerequisites\config.env
notepad prerequisites\config.env
pwsh .\scripts\powershell\deploy.ps1
```

> Building the container images uses many `docker build --build-arg` flags. The
> PowerShell path reuses `scripts/2-build-images.sh` through Git Bash or WSL for
> that one step (both ship with Docker Desktop workflows). Everything else —
> rendering manifests, applying to the cluster, ingress, verification — is native
> PowerShell. If you pre-build images elsewhere, run `deploy.ps1 -SkipBuild` and no
> bash is needed at all.

When it finishes, open `APP_URL` and sign in as `admin` with the password written
to `.state/admin-credentials.txt`.

---

## Requirements

| Tool | Why |
|------|-----|
| `kubectl` | talk to your cluster |
| `docker` | build the images (skip with `-SkipBuild` / `SKIP_BUILD=1` if pre-built) |
| `python3` + `pyyaml` | portable YAML surgery (node pinning, storage class, ingress tweaks) |
| `openssl`, `curl` | generate secrets, verify reachability |
| `kind` | only for `INGRESS_MODE=kind` |

Run `./scripts/0-check-prerequisites.sh` (or `deploy.sh`, which runs it first) to
validate everything before touching the cluster.

---

## Configuration

Everything is driven by `prerequisites/config.env` (copied from
`config.env.example`). The important knobs:

| Variable | Meaning |
|----------|---------|
| `APP_DOMAIN` / `APP_URL` | public hostname / HTTPS URL of the app |
| `TENANCY_MODE` | `single` (default) or `jwt` (multi-tenant — needs the MSP operator) |
| `REGISTRY` / `TAG` | where images are published (ignored in `kind` mode) |
| `APP_GIT_URL` / `APP_GIT_REF` | the source built into images |
| `APP_NS` | target namespace |
| `INGRESS_MODE` | `ingress` \| `gateway` \| `kind` \| `none` |
| `TLS_MODE` | `provided` \| `cert-manager` \| `none` (ingress mode) |
| `NODE_LABEL_KEY/VALUE`, `NODE_TAINT` | optional node pinning |
| `STORAGE_CLASS` | optional; blank = cluster default |

See `prerequisites/README.md` for what you must supply (cluster access, registry
login, TLS material) and `prerequisites/config.env.example` for the full annotated list.

### Ingress modes

- **`ingress`** (default) — creates a standard Kubernetes `Ingress`. Needs an
  ingress controller (nginx, Traefik, …) in the cluster. TLS via a provided cert,
  cert-manager, or none.
- **`gateway`** — attaches a dedicated listener + `HTTPRoute`s to an **existing**
  Gateway-API `Gateway` (set `GATEWAY_NS`, `GATEWAY_NAME`, `GATEWAY_TLS_SECRET`).
  Includes route-priority hardening for controllers without listener isolation.
- **`kind`** — local `kind` cluster: images are `kind load`ed (no registry), and
  the app is exposed via NodePort / `kubectl port-forward`. Good for a laptop trial.
- **`none`** — deploy the workloads only; wire your own ingress to
  `Service oauth2-proxy:8080` in `APP_NS`.

---

## Layout

```
setup/
├── README.md
├── .gitignore
├── prerequisites/
│   ├── README.md
│   ├── config.env.example        # copy → config.env, then edit
│   ├── tls.crt.example           # copy → tls.crt (only if TLS_MODE=provided)
│   └── tls.key.example           # copy → tls.key
├── config/
│   ├── k8s-app/                   # the app manifests (namespace/infra/jobs/app/workers)
│   │   ├── 00-namespace.yaml … 40-workers-shell-proxy.yaml
│   │   └── 02-secret-config.tmpl # templated secret + config
│   └── ingress/
│       ├── ingress.tmpl                 # INGRESS_MODE=ingress
│       ├── httproute.tmpl               # INGRESS_MODE=gateway
│       └── gateway-listener-patch.tmpl  # INGRESS_MODE=gateway
└── scripts/
    ├── lib.sh                    # shared bash helpers
    ├── pin_and_storage.py        # shared YAML surgery (bash + PowerShell)
    ├── 0-check-prerequisites.sh
    ├── 2-build-images.sh         # build → push (or kind load)
    ├── 3-deploy-app.sh           # render + apply the workloads
    ├── 4-ingress.sh              # wire ingress per INGRESS_MODE
    ├── 8-verify.sh
    ├── deploy.sh                 # runs 0 → 2 → 3 → 4 → 8
    ├── reset.sh                  # remove app + ingress
    ├── update.sh                 # day-2 update (unique tag, roll, re-migrate, rollback)
    └── powershell/               # native Windows equivalents
        ├── lib.ps1
        ├── deploy.ps1
        ├── reset.ps1
        └── update.ps1
```

---

## Day-2

```bash
./scripts/update.sh                       # build latest APP_GIT_REF → unique tag → roll → re-migrate
APP_GIT_REF=v1.2.3 ./scripts/update.sh    # pin a release
ROLLBACK_TO=<a prior TAG-sha> ./scripts/update.sh --rollback
./scripts/reset.sh                        # remove the app + its ingress
```

Each update builds a unique `TAG-<gitsha>` image so the rollout is guaranteed even
with `imagePullPolicy: IfNotPresent`, and you can roll back to any prior sha.

---

## Notes

- **Single vs multi-tenant.** This installs the **single-tenant** app (`TENANCY_MODE=single`),
  which is the default and needs nothing extra. `jwt` (multi-tenant) additionally
  requires the MSP operator to stamp per-tenant realms/schemas — out of scope here.
- **Secrets.** Passwords and the oauth2 cookie secret are generated at deploy time
  unless you pin them in `config.env`. The bootstrap admin password is written to
  `.state/admin-credentials.txt`.
- **Keycloak** is served under `/keycloak` on the same host as the app, so a single
  ingress/route covers both.
