# Marketplace — How to publish and run an app (quick start)

This is the **hands-on guide**. It walks you through getting an app into the Marketplace and in front
of users, start to finish, for each of the three onboarding models. For the full field-by-field
contract see [app-requirements.md](app-requirements.md); for the build pipeline internals see
[deploy-dockerfile.md](deploy-dockerfile.md); for the external-app federation contract see
[discovery.md](discovery.md).

Everything below goes through the marketplace backend API at `/api/marketplace/v1` (all examples use
the short form `/v1`). Registering and deploying is **operator-only** — you need the
`marketplace:manage` permission (OpenFGA). The examples assume you are logged in as an operator so the
oauth2-proxy forwards your identity header automatically.

---

## Which model do I want?

| I have… | Use | The platform… |
|---------|-----|---------------|
| A **prebuilt image** (public or private registry) | `kind="image"` | pulls & runs it |
| An **OCM component** (`ociImage` resource) | `/discover/ocm` | resolves the descriptor → pulls & runs the resolved image |
| A **Git repo with a `component-constructor.yaml`** | `/discover/ocm/build` | builds the OCM component from source, pushes to the in-cluster registry, then runs it |
| A **Git repo with a `Dockerfile`** at its root | `kind="dockerfile"` | builds, pushes to the in-cluster registry, runs it |
| A repo of **static files** (HTML/JS/CSS) | `kind="static"` | git-clones it and serves it with nginx |
| An app **already running on its own infra** | external (`/discover/manual`) | registers a pointer and federates SSO / proxies to it |

Rule of thumb: if the platform runs your container it's `image`/`dockerfile`/`static`; if you run it
yourself it's an external discovered app.

---

## 1. Publish a prebuilt image (`kind="image"`)

The fastest path — no repo, no build.

**Step 1 — register:**

```bash
curl -X POST /v1/services -H 'content-type: application/json' -d '{
  "name": "whoami",
  "label": "Who Am I",
  "kind": "image",
  "image_ref": "traefik/whoami:latest",
  "app_port": 80
}'
```

Returns `201` with the row (`status: "pending"`). Nothing is running yet.

**Step 2 — deploy:**

```bash
curl -X POST /v1/services/<id>/deploy
```

The platform pulls the image and runs it. `status` flips `pending → deploying → running`; the
response carries `service_host`.

### Private registry

Tick `registry_private: true` at register time, then pass the pull credentials **on the deploy call**
(never at register time — they are used once and never stored, returned, or logged):

```bash
curl -X POST /v1/services -d '{ "name":"app","label":"App","kind":"image",
  "image_ref":"ghcr.io/acme/app:1.2","app_port":8080,"registry_private":true }'

curl -X POST /v1/services/<id>/deploy -H 'content-type: application/json' -d '{
  "registry_username": "acme-bot",
  "registry_token": "ghp_xxx"
}'
```

- Deploying a `registry_private` app **without** credentials returns `400` and leaves the row
  `pending` — nothing is attempted.
- Only the non-secret flag `registry_private: true` is ever stored/returned. The token is
  write-through to the container runtime and then gone.

---

## 1b. Ingest from an OCM component (`POST /discover/ocm`)

If your app is shipped as an **OCM (Open Component Model) component** rather than a bare image ref,
you paste the *component reference* and the platform resolves the concrete, digest-pinned image for
you. This is the SAP-standard way to ship software: a component version (e.g.
`github.com/acme/app:1.0.0`) carries a signed **component descriptor** listing typed resources; the
deployable container is a resource of type `ociImage` whose access is an `ociArtifact` with a
concrete `imageReference`. That resolved ref is **not guessable** from the component name — OCM may
re-nest the image under the component subpath and pin a digest (e.g.
`ghcr.io/acme/acme/app:1.0.0@sha256:…`). Reading it from the descriptor is the whole point.

`POST /discover/ocm` runs the `ocm` CLI (baked into the backend image) once to resolve the descriptor,
then registers exactly the same `kind="image"` row as section 1 — so deploy, SSO, the role gate,
new-tab, and everything else are reused unchanged. Only the resolve step is new. (Out of scope:
`helmChart` / git-source resources, and signature *verification* as a gate.)

**Ingest:**

```bash
curl -X POST /v1/discover/ocm -H 'content-type: application/json' -d '{
  "name": "whether-app",
  "label": "Weather App",
  "ocm_repo": "ghcr.io/acme",
  "component": "github.com/acme/whether-app:1.0.0",
  "app_port": 3000,
  "open_mode": "new_tab",
  "registry_private": true
}'
```

Returns `201` with the registered row — `kind="image"`, `status="pending"`, and `image_ref` set to
the **resolved, digest-pinned** ref (not the component name you sent). Deploy is then the ordinary
section-1 step: `POST /v1/services/<id>/deploy` (with pull credentials in the body when
`registry_private`).

| Field | Meaning |
|-------|---------|
| `ocm_repo` | The OCM repository — the CLI `--repo`, e.g. `ghcr.io/acme`. |
| `component` | The component version, e.g. `github.com/acme/whether-app:1.0.0`. |
| `resource` | *(optional)* the `ociImage` resource name; auto-picked when the component has exactly one. Required — with a clear 422 listing the names — when a component has several. |
| `app_port`, `open_mode`, `registry_private`, `sso_enabled` | Same meaning as `kind="image"` (section 1 / section 6). |

### Private descriptor repo (resolve-time credentials)

The component **descriptor itself** lives in an OCI registry, and that registry may require auth just
to *read* it — separate from (and earlier than) the image pull. When the descriptor repo is private,
pass resolve-time credentials on the ingest call:

```bash
curl -X POST /v1/discover/ocm -H 'content-type: application/json' -d '{
  "name":"whether-app","label":"Weather App",
  "ocm_repo":"ghcr.io/acme","component":"github.com/acme/whether-app:1.0.0",
  "app_port":3000,"open_mode":"new_tab","registry_private":true,
  "resolve_username":"acme-bot",
  "resolve_token":"ghp_xxx"
}'
```

- `resolve_username` / `resolve_token` are **write-through**: used once to run the resolve (handed to
  the `ocm` CLI as `--cred` arguments, never embedded in a URL), and then gone — never stored in
  Postgres, returned on any response, or logged. Same never-persist contract as the deploy-time pull
  credentials.
- These are **only** for reading the descriptor. The image pull still uses the separate
  `registry_username`/`registry_token` on the **deploy** call (they are often the same ghcr token, but
  the two steps are independent).
- If the `ocm` binary is missing from the image the endpoint returns `503`; a failed/timed-out resolve
  (auth denied, component not found) returns `502` with the CLI's error tail; a component with no
  `ociImage`/`ociArtifact` resource (e.g. a chart-only component) returns `422`.

---

## 1c. Build an OCM component from a Git repo (`POST /discover/ocm/build`)

Section 1b resolves an **already-published** component. When the component **hasn't been published
yet** — you just have the source repo — this path builds it for you: paste a **GitHub repo + branch**
and the platform clones it, runs `ocm add componentversions` from the repo's
`component-constructor.yaml`, transfers the built component (and any images it references) into the
platform's **own in-cluster registry**, resolves the built `ociImage` ref, and registers it as the
same `kind="image"` row as section 1. It's the "repo → running service" bridge for OCM.

Because the built image lands in the in-cluster registry the platform reads without auth, **no pull
credentials are needed at deploy time** — there is deliberately no `registry_private` here.

**Build & register:**

```bash
curl -X POST /v1/discover/ocm/build -H 'content-type: application/json' -d '{
  "name": "whether-app",
  "label": "Weather App",
  "git_url": "https://github.com/acme/whether-app.git",
  "git_ref": "main",
  "app_port": 3000,
  "open_mode": "new_tab"
}'
```

Returns `201` with the registered row — `kind="image"`, `status="pending"`, `registry_private=false`,
and `image_ref` set to the **freshly-built, digest-pinned** ref in the in-cluster registry. Deploy is
then the ordinary section-1 step with **no body**: `POST /v1/services/<id>/deploy`.

| Field | Meaning |
|-------|---------|
| `git_url` | The GitHub repo to build, e.g. `https://github.com/acme/whether-app.git`. |
| `git_ref` | *(optional, default `main`)* the branch/tag/sha to build. |
| `constructor` | *(optional, default `component-constructor.yaml`)* path within the repo to the OCM component constructor. Must be repo-relative (no leading `/` or `..`). |
| `component` | *(optional)* which built component to resolve; auto-picked when the constructor builds exactly one. |
| `resource` | *(optional)* the `ociImage` resource name; auto-picked when the built component has exactly one. Required — with a clear 422 listing the names — when it has several. |
| `app_port`, `open_mode`, `sso_enabled` | Same meaning as `kind="image"` (section 1 / section 6). |

- The clone uses the platform's configured git token (via `GIT_ASKPASS` env, **never** in the clone
  URL/argv, never logged) when the repo host matches `GIT_TOKEN_HOST`; a public repo clones anonymously.
- A repo with **no `component-constructor.yaml`** at the given path fails cleanly with `422` and **no
  half-created row**; a build/transfer failure surfaces the `ocm` error tail as `422`.
- **docker-compose** is the tested deploy target for this path (the build runs in a throwaway
  container that has both `git` and the `ocm` CLI). On the Kubernetes target this endpoint returns a
  clean `422` explaining it isn't wired yet — use `/discover/ocm` with a published ref there instead.

---

## 2. Build & run from a Git repo (`kind="dockerfile"`)

**Register** (add `app_port`; `sso_enabled` if the app should sit behind Platform SSO):

```bash
curl -X POST /v1/services -d '{
  "name": "reporter", "label": "Reporter",
  "kind": "dockerfile",
  "git_url": "https://github.com/acme/reporter.git",
  "app_port": 8080,
  "sso_enabled": true
}'
```

**Deploy:** `POST /v1/services/<id>/deploy`. The platform builds the image from the repo's root
`Dockerfile` (Kaniko on k8s / `docker build` on compose), pushes it to the in-cluster registry, and
runs it. If `sso_enabled`, a per-app confidential Keycloak client `aitrust-app-<name>` is minted.

### Private Git repos (e.g. `github.tools.sap`)

Some hosts require a token even for a public-looking clone. Configure this **once** on the deployment,
not per app:

```bash
# .env
GIT_TOKEN_HOST=github.tools.sap
GIT_TOKEN_FILE=/run/secrets/git_token
```

When the clone host matches `GIT_TOKEN_HOST`, the token is handed to `git` via a `GIT_ASKPASS`
helper — passed as an **environment variable** (compose) or a **Kubernetes Secret env ref** (k8s),
**never** embedded in the clone URL or the container/pod command line. So the token never appears in
`docker inspect`, a Deployment/Job spec, `kubectl get pod -o yaml`, the served files, or the logs.
Leave `GIT_TOKEN_HOST` empty for anonymous clones.

---

## 3. Serve static files (`kind="static"`)

```bash
curl -X POST /v1/services -d '{
  "name": "docs", "label": "Docs",
  "kind": "static",
  "git_url": "https://github.com/acme/docs-site.git"
}'
curl -X POST /v1/services/<id>/deploy
```

The repo is cloned into a shared volume and served by nginx on `:80`. The repo **must have an
`index.html` at its root** — if it doesn't, the deploy now fails cleanly with
`status="failed"` and a "no index.html" error (previously it hung in `deploying`). This works the
same on docker-compose and k8s.

Static apps always embed same-window (they can never break out of the platform frame) — `open_mode`
is forced to `same_window` even if you send `new_tab`.

---

## 4. Register an app running elsewhere (external / federation)

Use `/v1/discover/manual` for an app that is already running on its own infra. Pick an `auth_mode`:

| `auth_mode` | Meaning |
|-------------|---------|
| `none` | No auth; proxied and embedded same-origin. |
| `bearer` | Proxy injects the caller's platform JWT as `Authorization: Bearer …`. |
| `header_map` | Proxy injects identity into headers you name. |
| `oidc_federation` | Your app keeps its **own** login, federated to the platform realm. Opens in a **new tab**. |

```bash
curl -X POST /v1/discover/manual -d '{
  "name": "grafana", "label": "Grafana",
  "external_url": "https://grafana.internal.example.com",
  "auth_mode": "bearer",
  "health_url": "https://grafana.internal.example.com/api/health"
}'
```

For `oidc_federation`, also send `oidc_redirect_uri` (your app's callback). Then fetch the values to
paste into your own IdP:

```bash
curl /v1/services/<id>/federation-setup   # operator-only; returns client_id, client_secret, issuer
```

The `client_secret` is read **live from Keycloak** on each call — it is never stored in Postgres or
returned anywhere else.

---

## 5. Make it visible to users (the role gate)

An SSO-gated internal app or any discovered app is **hidden** from the catalog until an operator
enables it. Enabling is by role:

```bash
curl -X POST /v1/services/<id>/enable-role -d '{ "role": "auditor" }'
```

Now anyone holding the `auditor` role sees the tile (`enabled_for_me: true`) and can open it; the
proxy `403`s anyone who isn't enabled. Static internal apps are never gated — they're always visible.

> Visibility and the proxy gate are driven by the platform's own enable tables + the caller's roles.
> They are **independent of** the `marketplace:manage` operator check, which only gates
> register/deploy/enable/federation-setup.

---

## 6. Open in a new tab (internal server apps)

Some server apps can't run inside the same-origin embed. Set `open_mode: "new_tab"` at register time
for an `image` or `dockerfile` app and the tile opens the app in a new browser tab (via its proxy
URL) instead of the embedded iframe:

```bash
curl -X POST /v1/services -d '{ "name":"grafana","label":"Grafana","kind":"image",
  "image_ref":"grafana/grafana:latest","app_port":3000,"open_mode":"new_tab" }'
```

(`static` apps ignore this and stay same-window; `oidc_federation` apps are always new-tab.)

---

## 7. Health status of external apps

Any discovered app with a `health_url` is probed on a fixed interval by the
**`marketplace-health-worker`** (a standalone background container). It writes `health_status`
(`up`/`down`) and `health_checked_at` back to the row, and the tile shows an up/down/unknown dot.

- Interval: `MARKETPLACE_HEALTH_INTERVAL` seconds (default `30`).
- The probe reuses the discovery **SSRF guard** — a `health_url` that resolves to loopback,
  link-local, a cloud metadata IP, or (unless `MARKETPLACE_ALLOW_PRIVATE_DISCOVERY` is set) a private
  address is **skipped**, never recorded as a false "down".
- This is a **separate deployable** — it exists as a `docker-compose` service, a Helm Deployment, and
  in `build-and-load-images.sh`. Bring it up on compose with:

  ```bash
  docker compose up -d marketplace-health-worker
  ```

---

## Lifecycle & status cheat-sheet

| `status` | Meaning |
|----------|---------|
| `pending` | Registered, not deployed yet. |
| `deploying` | Build/pull/clone in progress. |
| `running` | Live. `service_host` set. |
| `failed` | Terminal failure (bad image, build error, missing `index.html`, …); `error` explains. |

`health_status` (`up`/`down`/`unknown`) is **separate** from `status` — it tracks liveness of a
*discovered* app, not the deploy lifecycle.

Deleting a service (`DELETE /v1/services/<id>`) tears down the workload and best-effort removes any
per-app Keycloak client and git Secret.

---

## Local development & tests

Backend tests run against Postgres only (no Docker/k8s/Keycloak — those are mocked at the dispatch
layer). The host has no Python, so run them **inside the backend container**:

```bash
# unit (no DB)
docker exec -w /app ai-trust-platform-git-marketplace-backend-1 python -m pytest tests/unit -q

# e2e (needs Postgres; TEST_PGHOST=postgres reaches it by compose service name)
PGPASS=$(docker exec ai-trust-platform-git-marketplace-backend-1 \
  printenv DATABASE_URL | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
docker exec -w /app -e TEST_PGHOST=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$PGPASS" \
  ai-trust-platform-git-marketplace-backend-1 python -m pytest tests/e2e -q
```

On a machine that has Python, the standard `cd marketplace/backend && make setup && make test` works
too (needs `docker compose up -d postgres`).
