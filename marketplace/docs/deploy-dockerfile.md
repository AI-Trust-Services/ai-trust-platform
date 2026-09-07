# Deploy a real server app from Git (`kind="dockerfile"`)

The Marketplace can deploy two kinds of internal app from a Git URL:

| `kind`       | What happens                                                                 |
|--------------|------------------------------------------------------------------------------|
| `static`     | The repo is git-cloned into a shared volume and served by nginx on `:80`.    |
| `dockerfile` | The repo's **Dockerfile is built into an image, pushed to the in-cluster registry, and run as a container**. Optionally wired to Platform SSO and role-gated. |

There is also a third server-app kind, **`kind="image"`**, which **pulls and runs a prebuilt public
image** (no build, no repo — the operator supplies `image_ref`, e.g. `ghcr.io/acme/app:1.2`). It is
exactly the `dockerfile` path minus the build step: same OIDC contract, same OpenFGA gate. See
[app-requirements.md](app-requirements.md) for the operator-facing contract covering all three
models (image, dockerfile, external SSO federation) and a decision table for picking one.

This document covers the `dockerfile` path: the build/run pipeline, the Platform-SSO OIDC
contract an app must honour, the OpenFGA role gate, and the registry dev setup.

## Pipeline

`POST /services` (register, `kind="dockerfile"`, `app_port`, `sso_enabled`) →
`POST /services/{id}/deploy`:

1. **(if `sso_enabled`)** mint a per-app confidential Keycloak client `aitrust-app-<name>`
   in realm `ai-trust`, whitelisting `{embed_base}/*` — reusing `keycloak.ensure_app_client`.
2. **Build** the image from the repo's `Dockerfile`:
   - **k8s** (`DEPLOY_TARGET=kubernetes`): a **Kaniko** `Job` git-clones the repo and builds+pushes
     to `MARKETPLACE_REGISTRY` (`registry:5000`) with `--insecure --skip-tls-verify --insecure-pull`.
   - **docker-compose** (`DEPLOY_TARGET=docker`): `docker build` on the host from a tar-streamed
     clone; pushed to `localhost:5000`.
   - Image ref is pinned to the resolved `git_ref` (`/`→`-`) and stored in the `image_ref` column.
3. **Run** the pushed image:
   - **k8s**: a `Deployment` + `Service` (`port=80 targetPort=app_port`). The non-secret `OIDC_*`
     env are plain `V1EnvVar`; `OIDC_CLIENT_SECRET` comes from a per-app `Secret` `mkt-<name>-oidc`.
   - **docker-compose**: a container `mkt-<name>` on the compose network, all env inline.
4. Persist `oidc_client_id`, `image_ref`, `service_host`, `status="running"`.

**`kind="image"` variant.** Steps 2 and the clone are skipped entirely: the operator-supplied
`image_ref` is pulled (`docker pull` on compose; `imagePullPolicy=Always` on k8s) and run with the
identical OIDC env wiring. A **private** image (`registry_private=true`) is pulled with credentials
supplied on the deploy call (`POST /services/{id}/deploy` body `{registry_username, registry_token}`)
→ compose passes them as `auth_config` to the pull; k8s writes a per-app `mkt-<name>-pull`
`dockerconfigjson` Secret and references it via the PodSpec's `imagePullSecrets`. The credentials are
never persisted in Postgres, returned, or logged (only the non-secret `registry_private` flag is
stored). A missing credential on a private app 400s before any pull; a bad credential or missing ref
fails cleanly with `error="image not found or not pullable: <ref>"`. Dispatch is `deploy.run_image`
→ `docker_client.run_image` / `build_k8s.run_image`.

The app is reached **same-origin, embedded** through the marketplace proxy at
`/marketplace/#/embed/<name>` (the shell keeps a dockerfile app `same_window` — it is NOT a new-tab
`oidc_federation` app). CSP `frame-ancestors 'self'` is already satisfied by the embed page.

## App-side OIDC contract

When `sso_enabled=true`, the container receives these env vars — the app runs its **own** OIDC
login (Authorization Code flow) against the platform `ai-trust` realm using them:

| Env                   | Meaning                                                                   |
|-----------------------|---------------------------------------------------------------------------|
| `OIDC_ISSUER`         | `{KEYCLOAK_PUBLIC_URL}/realms/ai-trust` — the browser-facing issuer.       |
| `OIDC_CLIENT_ID`      | `aitrust-app-<name>` (confidential).                                       |
| `OIDC_CLIENT_SECRET`  | The client secret — from a k8s Secret on k8s, inline env on compose.       |
| `OIDC_REDIRECT_URI`   | `{embed_base}/oauth/callback` — the app's callback, same-origin.           |
| `OIDC_SCOPES`         | `openid profile email`.                                                    |

`embed_base = {APP_PUBLIC_URL}/api/marketplace/v1/proxy/<name>`.

**The app MUST:**
- Honour `OIDC_REDIRECT_URI` exactly (the Keycloak client whitelists only `{embed_base}/*` — there
  is no open wildcard host).
- Run under the embed **base path** (all its URLs relative, or based on `OIDC_REDIRECT_URI`'s origin
  + path prefix). An app that hardcodes `/` will break under the same-origin embed — register such
  an app with `open_mode="new_tab"` (the AddForm "Open in a new tab" checkbox). The tile then opens
  it first-party at its proxy origin (`{embed_base}/`) in a new browser tab instead of the iframe.
- Listen on `app_port`.

The client secret is **never** persisted in Postgres (Keycloak is the system of record — read live
via `keycloak.get_client_secret`), never returned on `ServiceResponse`, and never logged.

## OpenFGA role gate

A `dockerfile` app with `sso_enabled=true` (and every `external_discovered` app, and every
`sso_enabled` `image` app) is **role-gated** — `_is_gated(row)` is true:

- It is **hidden** from `GET /services` for a user who is not enabled for it.
- The proxy **403s** any request unless the caller is enabled (directly or via a role).
- An operator enables it for a role via the ServiceCard "Enable for role…" dropdown →
  `POST /services/{id}/enable-role`.

Authorization is **entirely OpenFGA** (the existing `_is_enabled_for` / `_user_roles` /
`MarketplaceAppEnabledRole` machinery). Keycloak is used only for the app's own *authentication*.

A `static` internal app is **never** gated — it stays visible and reachable to everyone, exactly as
before. No backfill flips an existing static app into the gated set.

## Registry dev setup

Built images are stored in an in-cluster `registry:2` (plain HTTP, no TLS):

- **docker-compose**: a `registry` service is published on `127.0.0.1:5000`. One-time, add
  `localhost:5000` to Docker Desktop → Settings → Docker Engine → `insecure-registries`:
  ```json
  { "insecure-registries": ["localhost:5000"] }
  ```
- **kind**: `k8s/kind-config.yaml` patches containerd to trust `registry:5000` as an insecure
  (http, skip-verify) registry, so the kubelet can pull Kaniko-built images. `registry:5000` is the
  ClusterIP Service DNS resolved via cluster CoreDNS.

`MARKETPLACE_REGISTRY` (`.env` / Helm `marketplaceRegistry` / compose env) selects the host:port.

### Kyma / Gardener follow-up

The insecure-HTTP registry is acceptable in-cluster / local only, and only backs the `dockerfile`
build path (Kaniko builds push there). A TLS-fronted registry (or a managed registry) is the
documented production follow-up for that path; it does not change the app-side OIDC contract or the
role gate. Note `kind="image"` apps pull from **wherever their `image_ref` points** — including
private registries: the per-app `mkt-<name>-pull` `dockerconfigjson` Secret (k8s) / compose
`auth_config` carry the deploy-time pull credentials, so no change to `MARKETPLACE_REGISTRY` is
needed for a private image.

## Tests

Unit tests (`marketplace/backend/tests/unit/test_dockerfile_deploy.py`, no DB / network / Docker):
- `oidc.issuer` / `embed_base` / `redirect_uri` / `oidc_env` — env assembly, trailing-slash
  tolerance, realm honoured, hard-500 on missing `APP_PUBLIC_URL` / `KEYCLOAK_PUBLIC_URL`, and that
  the client secret is never assembled here.
- `services._is_gated` — external_discovered + SSO dockerfile are gated; static internal / external /
  non-SSO dockerfile are not (static regression guard).
- `services._upstream_port` — k8s always 80; docker dockerfile → `app_port`; docker static → 80.
- `docker_client.image_ref` — pinned git-ref tag with `/`→`-` flattening.

Run: `cd marketplace/backend && python -m pytest tests/unit -q` (needs Python 3.12 + the editable
`ai_trust_*` libs, as for all backends; `tests/unit/conftest.py` stubs the libs only when absent).

**Follow-up — DB-backed e2e.** The marketplace backend has no `tests/e2e/` harness yet (its suite is
unit-only). The end-to-end scenarios — a `kind="dockerfile"` add persists `app_port`/`sso_enabled`;
a gated app is hidden from `GET /services` then shown after `enable-role`; the proxy 403→forwards on
the gate; a static app stays visible (regression) — require the ASGITransport + Postgres harness the
sibling backends use (`compliance/backend/tests/e2e/conftest.py`) with `deploy.build_and_deploy` and
`keycloak` mocked. Add that harness when introducing e2e coverage for this backend.
