# Deploying to a Gardener shoot (single-tenant, production-style)

`k8s/README.md` covers the local **kind** install. This guide covers deploying the **same Helm chart**
to a real **Gardener shoot** cluster as a **single-tenant** application, reachable at a public HTTPS host
through the cluster's shared gateway — the way the reference deployment
`ai-trust-platform-main.ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu` is run.

It is a **complete** app: it brings its own PostgreSQL, ClickHouse, MinIO, RabbitMQ, **Keycloak**,
**OpenFGA**, the users/IAM service, all MFEs, and oauth2-proxy. `TENANCY_MODE=single` (see the
"Tenancy mode" section in `CLAUDE.md`) — one organization, one Keycloak realm, no per-tenant isolation.

> Multi-tenant (`TENANCY_MODE=jwt`) is a different deployment path (the MSP operator bundle) — not this one.

## Why the chart needs a small adaptation for a shoot

The Helm chart (`k8s/helm/ai-trust-platform`) is written for **kind**: `NodePort` Services, `localhost`
public URLs, `imagePullPolicy: IfNotPresent` on `kind load`-ed images, no image registry, Keycloak served
at the root path, and no node pinning. A pure `-f values.yaml` override cannot express all the shoot
differences, so we use **render → transform → apply**:

```
helm template … -f values.shoot.yaml  →  a small transform pass  →  kubectl apply
```

The transform applies six deltas that a values file cannot:

| # | Delta | Why |
|---|-------|-----|
| 1 | **Image names** → `mirceacraciun795/aitrust-<name>:<tag>` | The chart joins `repo/name` with a literal `/`; the published repos are `aitrust-<name>` (hyphen). Without this, every app pod `ImagePullBackOff`s. Special-cases: `otel-clickhouse-consumer`→`aitrust-clickhouse-consumer`, `otel-rmq-bridge`→`aitrust-rmq-bridge`. |
| 2 | **Node pinning** (`nodeSelector`+`toleration` `workload=<pool>`) on every Deployment **and** Job | The dedicated worker pool is tainted; Jobs are immutable after creation, so pinning must be set at apply time. |
| 3 | **`PGDATA=/var/lib/postgresql/data/pgdata`** on postgres | A cloud block-storage PV mounts with a `lost+found` at its root → `initdb: directory … is not empty`. A subdirectory avoids it. (kind's local-path never hits this.) |
| 4 | **Keycloak under `/keycloak`** (`KC_HTTP_RELATIVE_PATH`, `KC_HOSTNAME`, probes; keycloak-provision `KEYCLOAK_URL` + wait path) | On a shoot there is ONE public host. Serving Keycloak under a path on that host avoids a second host/cert. |
| 5 | **oauth2-proxy args** point issuer/redeem/jwks/login/logout at `/keycloak/realms/<realm>`; `--cookie-secure=true` | Match the `/keycloak` path exposure and HTTPS. |
| 6 | **`storageClassName`** on PVCs (only if the cluster has no default StorageClass) | Bind PVs on clusters without a default class. |

## Prerequisites

- `kubectl`, `helm`, `docker`, `python3` on the workstation.
- Access to the shoot (an admin kubeconfig). On Gardener, mint a short-lived one, e.g.:
  ```bash
  kubectl --kubeconfig garden-kubeconfig.yaml create -f - --raw \
    "/apis/core.gardener.cloud/v1beta1/namespaces/<project>/shoots/<shoot>/adminkubeconfig" \
    <<< '{"apiVersion":"authentication.gardener.cloud/v1alpha1","kind":"AdminKubeconfigRequest","spec":{"expirationSeconds":14400}}' \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["status"]["kubeconfig"]).decode())' > shoot-kubeconfig.yaml
  export KUBECONFIG=$PWD/shoot-kubeconfig.yaml
  ```
- The app images published to your registry at one tag (built by the standalone build script or CI). All
  ~22 components incl. `db-migrate`, `clickhouse-migrate`, `keycloak-provision`, `openfga-provision`.
- A dedicated (optionally tainted) worker pool, labelled e.g. `workload=<pool>`.
- A Gateway (Gateway API) with a TLS listener + cert covering the app host, and DNS resolving the host to
  the gateway LB. (The reference deploy reuses the mesh's shared `k8sapi-gateway` + wildcard cert + a
  `terminate-<app>` listener.)

## Steps

### 1. `.env` (single-tenant)
Create the repo-root `.env` (used by `k8s/scripts/bootstrap.sh` to build the `ai-trust-env` Secret). Key
values for a shoot:
```
TENANCY_MODE=single
APP_PUBLIC_URL=https://<host>
KEYCLOAK_PUBLIC_URL=https://<host>/keycloak
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=<strong>
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<strong>
KEYCLOAK_CLIENT_SECRET=<token_hex(16)>
USERS_BACKEND_CLIENT_SECRET=<token_hex(16)>
OAUTH2_PROXY_COOKIE_SECRET=<token_hex(16)>   # exactly 32 chars
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong>
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=<strong>
SMTP_HOST=                                     # blank → email disabled (optional; no crash)
LLM_PROVIDER=stub
SMTP_FROM_NAME="AI Trust Platform"             # MUST be quoted — bootstrap.sh sources .env
```
> **Quote any value containing spaces.** `bootstrap.sh` does `source <(.env)`; an unquoted
> `SMTP_FROM_NAME=AI Trust Platform` runs `Trust` as a command and corrupts the Secret.

`configure-tenancy.sh` can also set `TENANCY_MODE` interactively: `TENANCY_MODE=single bash k8s/scripts/configure-tenancy.sh`.

### 2. Bootstrap the namespace prerequisites
```bash
NAMESPACE=<ns> bash k8s/scripts/bootstrap.sh    # ns + Secret ai-trust-env + 3 ConfigMaps + job-waiter RBAC
```

### 3. Values override
`values.shoot.yaml`:
```yaml
appPublicUrl: https://<host>
keycloakPublicUrl: https://<host>/keycloak     # note the /keycloak path
image:
  repository: <registry>       # placeholder; the transform builds the hyphenated names
  tag: <tag>
  pullPolicy: Always
ollama:
  enabled: false
```

### 4. Render → transform → apply
```bash
helm template ai-trust k8s/helm/ai-trust-platform -n <ns> -f values.shoot.yaml > rendered.yaml
python3 transform.py <tag> <host> <default-sc-or-empty> < rendered.yaml > transformed.yaml
kubectl apply -n <ns> -f transformed.yaml
```
initContainers gate startup order (wait-for-service / wait-for-job), so a single apply is fine. Wait:
```bash
kubectl -n <ns> get pods -w      # all Deployments Running, all Jobs Completed
```
> If `db-migrate` fails with **"Multiple head revisions are present"**, the alembic chain has branched —
> it must be a single linear head (`alembic heads` → one). This was fixed in-repo; a fresh checkout is clean.

### 5. Routing (Gateway API)
Add/verify a listener for `<host>` on the gateway (TLS cert covering it), then an `HTTPRoute`:
- a `/keycloak` (Exact + PathPrefix) rule → `keycloak:8080` (bypasses oauth2-proxy so the login page loads),
- a catch-all + app-prefix rules → `oauth2-proxy:4180` (the chart's oauth2-proxy Service port is **4180**),
- a `ReferenceGrant` if the route lives in a different namespace than the Services.

See `Standard_Ai_Platform/config/ingress/httproute.tmpl` for a ready template (route-hijack hardening
included for Traefik < 3.7). Confirm `attachedRoutes > 0` on the listener.

### 6. Verify
```bash
LB=<gateway-LB-ip>
curl -sk --resolve <host>:443:$LB https://<host>/                       # 200/302
curl -sk --resolve <host>:443:$LB https://<host>/keycloak/realms/ai-trust   # realm JSON
```
Then in a browser: open `https://<host>/`, log in as `admin` — you should see the **full** navigation
(Overview, AI System Registry, Monitoring, Decision Trace Analyzer, Alerts, Compliance, Role Management).
`https://<host>/api/users/v1/me/permissions` returns the full permission set. `openfga-provision` seeds
`APP_ADMIN_USERNAME` as `platform_administrator` automatically.

## Notes
- **Email is optional** — leave `SMTP_HOST` blank to disable notifications (the registry backend starts
  normally). Set it (+ `SMTP_PORT`/`SMTP_FROM`/`SMTP_SSL`/`SMTP_STARTTLS`) to enable outgoing mail.
- **Compliance evidence download** uses a MinIO presigned URL at `MINIO_PUBLIC_ENDPOINT`; in a single-host
  setup without a `/minio` route the download link won't resolve from the browser (upload still works). Add
  a `/minio` HTTPRoute if you need downloads.
- The chart Services stay `NodePort` on the shoot — harmless, since traffic enters via the gateway →
  oauth2-proxy ClusterIP. Switch to `ClusterIP` only if a NodePort collides.
