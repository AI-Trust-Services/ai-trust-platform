# Platform-SSO sidecar

A tiny OIDC Relying-Party **reverse proxy** that fronts an unmodified app so it can run in the SAP AI
Trust Marketplace with Platform SSO. The app needs **no code changes** and can be any language — it
just has to listen on a TCP port.

The sidecar:
1. Terminates the platform login (OIDC Authorization-Code + PKCE against the platform Keycloak).
2. Establishes a session cookie (`Path=/`).
3. Reverse-proxies every authenticated request to the wrapped app on `127.0.0.1:$UPSTREAM_PORT`,
   forwarding the identity as `X-Forwarded-User` / `X-Forwarded-Preferred-Username`.

It is normally injected into an app by [`../prepare-app.sh`](../prepare-app.sh); you don't run it by
hand. See that tool's `README.md` and the platform guide `marketplace/docs/onboard-an-app.md`.

## Environment

Injected by the platform on deploy (see the marketplace OIDC contract):

| var | meaning |
|-----|---------|
| `OIDC_ISSUER` | browser-facing realm issuer |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | the per-app confidential client |
| `OIDC_REDIRECT_URI` | the whitelisted callback (`…/oauth/callback`) |
| `OIDC_SCOPES` | requested scopes |
| `ISSUER` | the app's public base path under the proxy (auto-set for same-window) |

You supply (env box at registration):

| var | meaning |
|-----|---------|
| `OIDC_ISSUER_INTERNAL` | the in-cluster issuer the container can reach for discovery/token (e.g. `http://keycloak:8080/realms/ai-trust`) |

Sidecar knobs (set by the wrapper Dockerfile):

| var | default | meaning |
|-----|---------|---------|
| `UPSTREAM_PORT` | `8081` | the wrapped app's internal port |
| `LISTEN_PORT` / `PORT` | `8080` | the port the platform proxies to (the marketplace **App port**) |
| `PUBLIC_PATHS` | `` | comma-list of path prefixes served without auth (e.g. a health endpoint) |
| `SESSION_SECRET` | random | session signing key |

## Caveats

- The sidecar rewrites redirect `Location` headers implicitly (it serves at root; the platform proxy
  rewrites root-relative Locations) but does **not** rewrite URLs inside HTML/JS bodies. An app that
  hardcodes root-absolute asset URLs (`/app.js`) generally still works because the platform proxy +
  same-origin embed resolve them under the prefix; if not, set `PUBLIC_PATHS` for those assets or give
  the app a base-href.
- If the wrapped app has its **own** login, users see the platform login (sidecar) first and then the
  app's login (double login). Apps with no own login get a single clean platform login.
