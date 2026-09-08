# App requirements — onboarding an app to the Marketplace

The Marketplace onboards an app one of three ways. Rather than auto-generating anything, it
**publishes a contract** and either runs an app that meets it or federates SSO to one that does.
This document is the operator-facing contract: what a target app must satisfy for each model, and a
decision table for picking one.

| Model | `kind` / `source` | Who runs the app | Build? |
|-------|-------------------|------------------|--------|
| **Prebuilt image** | `kind="image"` | The platform pulls & runs it | No — pull only (public or private) |
| **Git + Dockerfile** | `kind="dockerfile"` | The platform builds & runs it | Yes — from the repo |
| **Bring your own running app** | external + `oidc_federation` | The app owner (elsewhere) | No — SSO only |

## Decision table

- **Do you have a prebuilt image?** → `kind="image"`. Fastest: no repo, no build. Public or private
  (tick **Private registry** and supply pull credentials at deploy time).
- **Do you have a Git repo with a `Dockerfile` at its root?** → `kind="dockerfile"`. The platform
  builds it (Kaniko on k8s / `docker build` on compose), pushes to the in-cluster registry, runs it.
- **Is the app already running on its own infra?** → register it as an external app with
  `auth_mode="oidc_federation"`. Nothing is deployed; the app federates SSO to the platform realm.

---

## Model 1 — Run on the platform (`kind="image"` or `kind="dockerfile"`)

The platform runs the container. The two kinds differ **only** in where the image comes from —
`image` pulls a prebuilt public ref (no build); `dockerfile` builds one from the repo. Everything
below applies to both.

The app **MUST**:

- **Listen on the declared `app_port`.** The proxy dials that port (compose) or a `:80` Service that
  targets it (k8s). No assumption about `:80` inside the container.
- **Be reachable without a shell/interactive step.** A long-running server, not a one-shot job.

For `kind="image"` specifically:

- The image ref may be **public** (`traefik/whoami:latest`) or **private** (`ghcr.io/acme/app:1.2`
  in a private repo, ECR, Artifactory, private Docker Hub). Tick **Private registry**
  (`registry_private=true`) at registration for a private ref.
- **Private-registry credentials are supplied at deploy time**, not registration:
  `POST /services/{id}/deploy` with `{registry_username, registry_token}`. They are used to pull the
  image (a per-app `mkt-<name>-pull` `dockerconfigjson` Secret on k8s → `imagePullSecrets`; passed to
  the pull call in memory on compose) and are **never stored in Postgres, never returned on any
  response, never logged** — the same contract as `OIDC_CLIENT_SECRET`. Only the non-secret
  `registry_private` flag is persisted; a redeploy re-prompts for the credentials.
- Supply the ref at registration (`image_ref`). `git_url`/`git_ref` are unused and may be blank.

For `kind="dockerfile"` specifically:

- The repo **MUST have a `Dockerfile` at its root**. Registering a repo without one fails cleanly
  ("This repository has no Dockerfile at its root").

### When SSO-enabled (`sso_enabled=true`)

> Full step-by-step app-side integration guide (RP flow, base-path handling, the
> `OIDC_ISSUER_INTERNAL` back-channel, cookie rules, a Node/Express patch pattern, and a worked
> reference) is in [integrate-platform-sso.md](integrate-platform-sso.md).

The platform mints a per-app confidential Keycloak client `aitrust-app-<name>` in realm `ai-trust`
and injects these env vars. The app runs its **own** OIDC Authorization-Code login using them:

| Env                  | Meaning                                                                    |
|----------------------|----------------------------------------------------------------------------|
| `OIDC_ISSUER`        | `{KEYCLOAK_PUBLIC_URL}/realms/ai-trust` — the browser-facing issuer.        |
| `OIDC_CLIENT_ID`     | `aitrust-app-<name>` (confidential).                                        |
| `OIDC_CLIENT_SECRET` | The client secret (k8s Secret on k8s; inline env on compose, local-only).   |
| `OIDC_REDIRECT_URI`  | `{embed_base}/oauth/callback` — the app's callback, same-origin.            |
| `OIDC_SCOPES`        | `openid profile email`.                                                     |

`embed_base = {APP_PUBLIC_URL}/api/marketplace/v1/proxy/<name>`.

The app **MUST**:

- **Honour `OIDC_REDIRECT_URI` exactly.** The Keycloak client whitelists only `{embed_base}/*` — no
  open wildcard host.
- **Run under the same-origin embed base path** (all URLs relative, or based on the redirect URI's
  origin + path prefix). An app that hardcodes `/` breaks under the embed. Reached at
  `/marketplace/#/embed/<name>`.

The client secret is **never** persisted in Postgres (Keycloak is the system of record — read live),
never returned on any API response, never logged.

An SSO-enabled server app is **OpenFGA role-gated**: hidden from the catalog and 403'd at the proxy
until an operator enables it for a role. A non-SSO server app and every `static` app stay ungated.

---

## Model 2 — Bring your own running app (external + SSO federation)

The app runs on its own infrastructure. The platform does **not** deploy, build, or pull anything —
it federates SSO so a single platform login flows through.

Register it via **Discover → Register an application → Manual**, `auth_mode="oidc_federation"`,
supplying the app's own IdP/IAS callback URL. The platform then mints a per-app confidential client
and exposes the **Federation setup** panel (`GET /services/{id}/federation-setup`, operator-only):
issuer, discovery URL, authorization/token/userinfo/JWKS endpoints, client id, client secret, and
the whitelisted redirect URI.

The app owner **MUST** (one-time, manual, in their own IdP/BTP/IAS tenant):

- **Register the platform `ai-trust` realm as a trusted upstream OIDC IdP** using the Federation
  setup values.
- **Whitelist exactly the redirect URI** they supplied at registration (the per-app client
  whitelists only that callback — no open wildcard host). If left blank it falls back to
  `{app_url}/*`.
- Keep the app reachable at its `external_url` (the proxy upstream) and, ideally, expose a
  `health_url`.

The app is **OpenFGA-gated** (enable per user or per role) and opens **new-tab** (it runs its own
login on its own origin — it is not same-origin embedded).

The lighter federation modes on the same form — `bearer` (forward the platform JWT) and
`header_map` (inject an identity header) — reuse the proxy to pass the caller's platform identity
through instead of the app running its own login. Use those when the app trusts a forwarded header
rather than doing OIDC itself.

---

## Security notes

- **OpenFGA is the sole authorization source.** Every gated app (SSO server app or external
  federated app) gates through the same `_is_gated` / enablement machinery. Keycloak is used only
  for the app's *authentication*, never to gate features.
- **A prebuilt image is operator-supplied running code.** Registering an `image` (or a
  `dockerfile`) requires `marketplace:manage`; an operator with that permission can run an arbitrary
  image on the platform — the same trust already granted by the build path. Private-registry pull
  credentials are supplied at deploy time and written straight into a per-app `dockerconfigjson`
  Secret (k8s) / passed to the pull in memory (compose) — never persisted in Postgres, returned, or
  logged (same contract as `OIDC_CLIENT_SECRET`); only the non-secret `registry_private` flag is
  stored.
- **Static internal apps are never retro-gated** — they stay visible and reachable to everyone.

See [deploy-dockerfile.md](deploy-dockerfile.md) for the run/build pipeline internals and the
registry dev setup.
