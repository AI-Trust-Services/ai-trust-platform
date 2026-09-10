# 06 — Troubleshooting

*Audience: everyone. Symptom → cause → fix. Start here when something doesn't work.*

## Application-side (patch / build / publish)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `prepare-app.sh` dies: "no CMD found" | Your app's `Dockerfile` has no `CMD` | Add a `CMD` (the tool captures it as the app's start command). |
| `prepare-app.sh` dies: app port equals listen port | `--app-port` == `--listen-port` | Use different ports; the app runs internally (e.g. 3000), the sidecar listens on 8080. |
| CI run fails: `denied: permission_denied: write_package` | Repo workflow permissions are read-only | Settings → Actions → General → Workflow permissions → **Read and write**, then re-run. *(→ [`03`](./03-publish-image.md#33-one-time-repository-setting-required))* |
| Package doesn't appear in GHCR | Workflow didn't run, or pushed to the wrong branch | Push to the `platform-sso` branch (or the `--branch` you chose); check the Actions tab for a green run. |

## Platform-side (register / deploy / enable)

| Symptom | Cause | Fix |
|---------|-------|-----|
| No **Marketplace** item in the nav | You don't hold `marketplace:manage` | Sign in as a Platform Administrator. |
| Deploy fails 400 "supply registry_username and registry_token" | Private image, no credentials given | Tick **Private registry**; enter GitHub username + a `read:packages` PAT at Deploy. |
| Deploy 401/403 "not pullable" | Bad/missing token, or package not published | Confirm a green `publish-image` run + `…:sso` exists; use a valid `read:packages` PAT (or make the package public). |
| Tile not in the sidebar | App not enabled for your role, or not `running` | **Enable for role** ([`04`](./04-platform-register-and-deploy.md#43-enable-for-a-role)); confirm status is `running`. |
| App loads but assets 404 | App hard-codes root-absolute asset URLs that don't resolve under the proxy sub-path | Set `PUBLIC_PATHS` for those assets, or give the app a base-href. *(→ [`02`](./02-application-patch.md#28-limits-know-these-before-you-ship))* |
| Two login screens | The wrapped app has its **own** login on top of the platform login | Expected for such apps; apps with no own login get a single platform login. |
| Registering a **static** app with env vars → 422 | `env` is only valid for server apps (`dockerfile`/`image`) | Don't set env on a static app; or register it as a server app. |

## SSO / login failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| App opens but immediately bounces to a login you can't complete | The app's `OIDC_ISSUER` points at a realm/Keycloak you're **not** logged into | Multi-tenant: point `marketplace-backend` at the mesh realm — [`05`](./05-multitenant-mesh-notes.md#52-the-fix--point-marketplace-backend-at-the-mesh-realm). |
| Redirect loop / 500 (`interaction session not found`) for an app that **has its own login** | Two OIDC logins stacked (sidecar + the app's own IdP); the app's cookie can't survive the proxy | Don't stack — deploy the app plain (no sidecar, SSO off) and have it **trust the platform JWT**. Full worked example: [`08`](./08-worked-example-weather-app.md#83-the-key-decision--replace-the-apps-oidc-with-platform-oidc). |
| App loads, logged in, but the **body is empty / data missing** | Frontend fetches root-absolute `/api/…` which escapes the embed prefix | Make the frontend prefix-aware — [`08` §8.4](./08-worked-example-weather-app.md#84-the-last-mile--a-prefix-aware-frontend). |
| `…/login` returns 503 "SSO not configured" | The sidecar is missing one of `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` | Ensure **Platform SSO** was ticked at registration so the platform injects them; redeploy. |
| Login 500 / `ECONNREFUSED` during discovery | `OIDC_ISSUER_INTERNAL` set to an unreachable URL | Leave the env box empty (the sidecar falls back to `OIDC_ISSUER`), or set a genuinely in-cluster URL. *(→ [`02`](./02-application-patch.md#26-the-environment-contract))* |

## Whole-platform "everything looks broken" (multi-tenant provisioning)

These are **tenant** issues, upstream of the Marketplace — rule them in/out if the platform itself misbehaves:

| Symptom | Cause | Fix |
|---------|-------|-----|
| The **tenant URL** itself redirect-loops (`ERR_TOO_MANY_REDIRECTS`) | The tenant oauth2-proxy `--login-url` is **relative**, so it resolves to the tenant host (no `/realms/` route) | The operator must set `KC_PUBLIC_URL` (apex Keycloak) so the login-url is absolute. |
| Logged in, but username shows `?` and only **Overview** in the nav | Backends still carry the placeholder `OPENFGA_STORE_ID=__OPENFGA_STORE_ID__`, so all authz checks fail closed (403) | Inject the real store id into every backend + operator; roll them. |
| Username shows, but still only **Overview** | The tenant's OpenFGA **model** is missing a permission the app version uses (e.g. `can_manage_marketplace`) → the "list my permissions" call 400s | Re-run the provisioner with the correct app-branch image (it self-heals the model), or add the missing relation + role tuple. |

*(The last three are documented in the operator's install-gaps notes; they're here so a "Marketplace is
broken" report can be triaged to the right layer.)*

## Where to look next

- App-side detail: [`02-application-patch.md`](./02-application-patch.md) and [`../tools/prepare-app/README.md`](../tools/prepare-app/README.md).
- Platform-side detail: [`04-platform-register-and-deploy.md`](./04-platform-register-and-deploy.md) and the reference docs in [`../docs/`](../docs/).
- Multi-tenant realm wiring: [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md).
