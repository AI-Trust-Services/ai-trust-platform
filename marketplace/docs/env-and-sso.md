# Environment variables & SSO for embedded apps

How the Marketplace lets an operator pass **plain, non-secret environment variables** into a deployed
server app, and how it makes an app that runs its **own** OIDC login work when it is embedded
same-window through the marketplace proxy.

This complements [deploy-dockerfile.md](deploy-dockerfile.md) (how server apps are built/run) and
[app-requirements.md](app-requirements.md) (the operator-facing contract). The quick-start is
[how-to.md §8–9](how-to.md).

## Why this exists

An internal server app (`kind="dockerfile"` / `kind="image"`, incl. OCM-resolved/built) that opens
**same-window** is not served at its own origin — it is reverse-proxied under

```
<APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>
```

If that app runs its **own** OIDC provider/login (as opposed to federating to the platform realm via
Platform SSO), its login/redirect URLs must be built from that proxy base — not a compiled-in
`http://localhost:PORT`. The real example is `github.tools.sap/D058099/capitals-weather`: a standalone
Node app with an embedded `oidc-provider` whose `ISSUER` defaults to `http://localhost:3000`. Embedded
through the proxy, that default sends the browser to `localhost:3000` and the login breaks.

The fix is two-part: a generic **env** mechanism (so any app can be told its runtime config), plus an
**auto-`ISSUER`** default for same-window apps so the common case needs zero typing.

## The `env` field

- Set at **register** time on `ServiceCreate` / `OcmIngestRequest` / `OcmBuildRequest` (`env`, a
  `{KEY: VALUE}` map), or in the UI as a `KEY=VALUE` box on the server-app Type forms.
- Persisted as a JSONB column `marketplace_services.env` (migration `0019`, default `{}`).
- Injected into the deployed container: compose `environment={**env, **secret_env}`; k8s a plain
  `V1EnvVar` per entry (`build_k8s._env_vars`). Both deploy targets already threaded an `env` dict, so
  the only backend change is persisting it and merging it at deploy.
- Surfaced on `ServiceResponse.env` and shown in the card's **Configuration** panel.

**Constraints** (schema `_check_env`): ≤50 vars; key matches `^[A-Za-z_][A-Za-z0-9_]*$` and ≤128 chars;
value is a string ≤2048 chars; `env` is rejected (422) for `kind="static"`.

**Non-secret only.** `env` is stored and returned on the API/UI. Secrets and registry pull credentials
must **not** go here — pull creds travel through the deploy-time body (`registry_username`/
`registry_token`) and are never persisted; the Platform-SSO `OIDC_CLIENT_SECRET` is delivered
separately (k8s Secret / compose inline) and never appears in `env`. The deploy path logs only the env
var **names** (`marketplace.deploy.env` → `env_keys`), never the values.

## Auto-`ISSUER`

At deploy, for an `open_mode="same_window"` server app, if the operator did **not** set `ISSUER`:

```
env["ISSUER"] = <APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>   # = oidc.embed_base(name)
```

- An operator-supplied `ISSUER` always wins (no overwrite).
- `new_tab` apps are reached first-party at their own proxy URL in a new tab, so they are **not**
  auto-`ISSUER`'d — such an app manages its own origin.
- This is independent of **Platform SSO** (`sso_enabled`): that path mints a per-app Keycloak client
  and injects `OIDC_*` (issuer = the platform `ai-trust` realm) for an app that federates to the
  *platform*. When both apply, the operator env is seeded first and the `OIDC_*` keys are merged on top.

Merge order at deploy (`routers/services.py deploy_service`):
1. `env = dict(row.env)` — operator vars.
2. same-window & no ISSUER → add `ISSUER = embed_base(name)`.
3. `sso_enabled` → `env = {**env, **oidc.oidc_env(client_id, name)}` (OIDC keys win on collision);
   `OIDC_CLIENT_SECRET` goes to `secret_env`, never `env`.

## Verified example — capitals-weather

Registered `kind="image"`, `mirceacraciun795/capitals-weather:1.0.0`, port `3000`, `same_window`,
empty env. On deploy the container received
`ISSUER=http://localhost:8080/api/marketplace/v1/proxy/capitals-weather`, and the app's `/login`
302-redirected to `…/proxy/capitals-weather/oidc/auth?…&redirect_uri=…/proxy/capitals-weather/callback`
— entirely under the proxy path (previously `http://localhost:3000/oidc/auth`). Login is `admin/admin`.

## Files

- Model + migration: `libs/persistence/ai_trust_persistence/models/marketplace.py`,
  `.../migrations/versions/0019_marketplace_env.py`.
- Schema: `marketplace/backend/app/schemas.py` (`_check_env`, `env` on the three request models +
  `ServiceResponse`).
- Deploy merge + auto-ISSUER: `marketplace/backend/app/routers/services.py` (`_create_internal`,
  `deploy_service`); base URL from `marketplace/backend/app/oidc.py` (`embed_base`).
- UI: `marketplace/frontend/src/api.ts`, `MarketplacePage.tsx` (env box in `AddForm`, Configuration
  panel in `ServiceCard`), `index.css`.
- Tests: `tests/unit/test_dockerfile_deploy.py` (env injection), `tests/e2e/test_marketplace_e2e.py`
  (persist, auto-ISSUER, explicit-ISSUER-wins, static-422), `tests/e2e/conftest.py` (`DEPLOYED_ENV`).
