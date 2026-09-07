# Marketplace — Discovering & integrating an already-running app

This document is the **app-side contract**. It is for the owner of an application that is **already
running elsewhere** and wants it to appear in the AI Trust Platform Marketplace, be enabled per
user/role, and have **authentication federated automatically** — one login to the platform carries
over to the app.

The platform does **not** deploy your app. It registers a pointer to it. For most modes it embeds
your app same-origin through the marketplace **proxy** and injects the caller's platform identity on
every request; your app is treated as **unchangeable** — the proxy adapts to whatever header/token
you expect. The one exception is `oidc_federation`, where your app keeps its **own** login (federated
to the platform realm) and opens in a new tab instead of being proxied — see §3.

---

## 1. How discovery works

An app becomes discoverable in one of two ways. Both produce a single catalog row with
`source="external_discovered"`; re-registering the same `name` re-syncs it (idempotent).

1. **Manifest self-describe (recommended).** Your app serves a small JSON document at a well-known
   URL. A platform operator pastes that URL into **Marketplace → Discover Applications → Register →
   From manifest URL**. The platform fetches and validates it server-side.
2. **Manual registration.** An operator fills the same fields in a form (**Register → Manual**) —
   used when you can't or don't want to serve a manifest.

Registration requires the `marketplace:manage` permission. **Enabling** an app for yourself requires
only being logged in; enabling it for a whole **role** requires `iam:manage` or `marketplace:manage`.

---

## 2. The manifest

Serve this at a stable URL, e.g. `https://app.example.com/.well-known/ai-trust-app.json`:

```json
{
  "name": "weather",
  "label": "Weather App",
  "base_url": "https://app.example.com",
  "health_url": "https://app.example.com/health",
  "auth": {
    "mode": "header_map",
    "header_name": "X-Remote-User",
    "value_template": "{preferred_username}",
    "audience": "aitrust-app-weather"
  },
  "icon": "cloud"
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | k8s-safe slug (lowercase RFC-1123 label). Stable identity — re-registering the same `name` re-syncs. |
| `label` | yes | Human-friendly display name in the catalog and sidebar. |
| `base_url` | yes | Canonical base URL of the running app. This is the **proxy upstream** — every embedded request is forwarded to `{base_url}/{path}`. |
| `health_url` | no | Optional health endpoint. |
| `auth` | no | How the proxy federates identity (see below). Defaults to `{ "mode": "bearer" }`. |
| `icon` | no | Icon hint. |

The manifest URL is fetched with **SSRF guards**: only `http`/`https`, redirects are not followed,
addresses that are loopback/link-local/private/reserved or a cloud-metadata IP are rejected, and the
response has a size and time cap.

---

## 3. Auth federation — `auth.mode`

The proxy strips **all** inbound identity headers (`Authorization`, every `X-Forwarded-*`, and the
target header) from the browser request before injecting its own, so your app can only ever receive
the value the platform sets — a client cannot spoof it.

### `bearer` (default)

The proxy forwards the caller's **platform JWT** unchanged as `Authorization: Bearer <jwt>`.

- On the **first Enable** of a bearer-mode app, the platform creates a confidential Keycloak client
  `aitrust-app-<name>` in the `ai-trust` realm (redirect URIs `{base_url}/*`, web origins
  `[base_url]`).
- Your app **must validate** the JWT: signature against
  `{KEYCLOAK_URL}/realms/ai-trust/protocol/openid-connect/certs`, issuer =
  `{KEYCLOAK_PUBLIC_URL}/realms/ai-trust`, and audience against your per-app `audience`
  (`aitrust-app-<name>`). The user's identity is the `preferred_username` / `sub` / `email` claims.
- Use this when your app already speaks OIDC/JWT.

### `header_map`

The proxy sets **one configured header** to a value rendered from the caller's platform identity:

```
X-Remote-User: <preferred_username>
```

- `header_name` — the header to set, e.g. `X-Remote-User`.
- `value_template` — a Python `str.format` template over the identity fields
  `{preferred_username}`, `{email}`, `{sub}`, `{jwt}`. Default `{preferred_username}`.
- Your app trusts this header as the authenticated user.
- **Critical:** because the app trusts a plaintext header, it must accept it **only** from the
  marketplace proxy — enforce network isolation (only the platform backend can reach the app) or a
  shared secret / mTLS at the network layer. Never expose a `header_map` app to arbitrary clients.
- Use this for apps that can't validate a JWT but can read a trusted header (the common
  "reverse-proxy auth" pattern).

### `none`

No identity is forwarded (all inbound identity is still stripped). Use for genuinely public apps.

### `oidc_federation` — the app keeps its own login (zero app code)

Use this when your app **already has its own OIDC/SAML login** (e.g. SAP IAS / XSUAA, Entra ID,
Auth0) and you want a single platform login to satisfy it **without changing the app's code**. Instead
of the proxy injecting an identity, your app's own IdP is configured to **trust the platform's
`ai-trust` realm as an upstream OIDC Identity Provider**. When a user opens the app, the app's normal
login runs, brokers up to the platform realm, sees the already-authenticated platform session, and
completes silently — real SSO transfer.

Two things follow from the browser mechanics, both handled for you:

- **The app opens in a NEW TAB**, first-party at its own `external_url` — not embedded through the
  proxy. A same-origin iframe cannot carry the app's own browser-redirect login: the app's IdP
  redirects to the app's *real* origin and sets cookies there, which never come back through the proxy
  origin (redirect loop). Opening first-party lets the login run normally. The platform sets
  `open_mode="new_tab"` automatically for this mode; the proxy injects **nothing**.
- **The platform automates only its half.** On the first Enable, it mints a confidential client
  `aitrust-app-<name>` in the `ai-trust` realm (whitelisting your app's IdP callback as the exact
  redirect URI) and exposes the realm's OIDC metadata. The **one-time trust registration on your
  IdP's side cannot be stamped remotely** — the platform *emits* the exact values and you register
  them once (see §7).

Manifest `auth` block:

```json
"auth": {
  "mode": "oidc_federation",
  "redirect_uri": "https://app.example.com/oauth/callback"
}
```

- `redirect_uri` — your app's own IdP/IAS callback (reply URL) the platform-IdP client whitelists.
  Not derivable from `base_url`, so supply it. When set, the client whitelists **exactly** that (no
  open wildcard); if omitted it falls back to `{base_url}/*` (looser — prefer setting it).

After Enable, an operator opens **Federation setup** on the app's card to get the discovery URL,
endpoints, client id and client secret to register in your IdP (§7).

---

## 4. Manual-registration fields

If you register manually instead of via a manifest, the operator provides:

| Field | Maps to | Notes |
|---|---|---|
| Display name | `label` | |
| Slug | `name` | lowercase RFC-1123 label |
| App URL | `external_url` | the proxy upstream (= manifest `base_url`) |
| Health URL | `health_url` | optional |
| Auth mode | `auth_mode` | `bearer` / `header_map` / `none` / `oidc_federation` |
| Header name | `auth_header_name` | `header_map` only |
| Value template | `auth_value_template` | `header_map` only |
| App IdP callback URL | `oidc_redirect_uri` | `oidc_federation` only — your IdP's reply URL |

---

## 5. Enable / disable & the sidebar

- **Enable** (per user) or **Enable for role** (operator) adds the app to the left-nav **Services**
  group. It appears live, no reload.
- `bearer` / `header_map` / `none` apps open **same-origin** at `/marketplace/#/embed/<name>`, which
  loads the app through `/api/marketplace/v1/proxy/<name>/…`. Keep your app iframe-embeddable (the
  platform sets a tight `sandbox`/CSP; if your app blocks framing via
  `X-Frame-Options`/`frame-ancestors`, embedding will fail).
- `oidc_federation` apps open in a **new tab** at their own `external_url` (first-party, so their own
  login runs) — not embedded.
- **Disable** removes it from the sidebar and 403s the proxy for that caller.

---

## 6. Security summary (for app owners)

- The proxy **strips and re-injects** identity — never trust a client-supplied identity header, only
  the one the proxy sets.
- For `header_map`, **only accept the injected header from the marketplace proxy** (network
  isolation or a secret) — otherwise anyone who can reach your app can impersonate any user.
- For `bearer`, **validate** issuer + audience + signature; do not accept unsigned or
  wrong-audience tokens.
- For `oidc_federation`, the platform realm is used **only for authentication** — the platform never
  sends the app roles or authorization. Your app keeps its own authorization; the platform's OpenFGA
  gates only who may Enable/reach the integration.
- The client secret in the Federation setup block is a **credential** — the setup endpoint is
  operator-only, the secret is read live from Keycloak (never persisted in the platform DB), and it
  is rotatable (rotating means you must re-register the new value in your IdP).
- The proxy is **gated**: only a user the app is enabled for can reach it. This is catalog
  visibility + a request gate, not a substitute for your app's own authorization.

---

## 7. App-owner one-time trust registration (`oidc_federation` only)

The platform automates its half on Enable (client + realm metadata). You register the platform as a
trusted upstream OIDC Identity Provider **in your own IdP tenant, once**. Get the values from the
operator, who opens **Marketplace → Discover → your app → Federation setup**:

| Value | Where it comes from |
|---|---|
| Discovery URL | `{KEYCLOAK_PUBLIC_URL}/realms/ai-trust/.well-known/openid-configuration` |
| Issuer | `{KEYCLOAK_PUBLIC_URL}/realms/ai-trust` |
| Authorization / Token / Userinfo / JWKS | the realm's `…/protocol/openid-connect/{auth,token,userinfo,certs}` |
| Client ID | `aitrust-app-<name>` |
| Client secret | minted by Keycloak, read live (rotatable) |
| Scopes | `openid profile email` |

**Generic IAS/BTP steps:**

1. In your IdP (e.g. SAP IAS), create an **OpenID Connect Corporate Identity Provider** pointing at
   the **Discovery URL** above (or the individual endpoints if discovery isn't consumed).
2. Enter the **Client ID** and **Client secret** as the corporate IdP's client credentials.
3. Set your app's own OIDC callback (the `redirect_uri` / `oidc_redirect_uri` you registered) as the
   reply URL — it must match what the platform-IdP client whitelists exactly.
4. Route your app's users to this corporate IdP (conditional authentication / default IdP), so their
   login brokers to the platform realm.

That's it — no application code changes. A user logged into the platform who opens your app in the
new tab is silently signed in through the shared realm.

### Worked example — ccc-eu (SAP BTP / XSUAA + IAS)

ccc-eu validates XSUAA-issued tokens agnostic to the upstream IdP, so **no ccc-eu code changes** are
needed — only BTP/IAS configuration plus one line in its own `k8s/xsuaa.yaml` (that repo, not this
one):

1. Register ccc-eu in the Marketplace with `auth_mode="oidc_federation"` and
   `oidc_redirect_uri` = ccc-eu's IAS OIDC callback. Enable it.
2. Open **Federation setup** and copy the discovery URL, `client_id` (`aitrust-app-ccc-eu`), and
   `client_secret`.
3. In the IAS tenant backing ccc-eu's XSUAA, add an **OIDC Corporate Identity Provider** with the
   platform discovery URL + those client credentials, and ccc-eu's callback as the reply URL.
4. Add the platform IdP alias to `allowedIdentityProviders` in ccc-eu's own `k8s/xsuaa.yaml`, so the
   XSUAA instance accepts logins brokered through it.
5. Log into the AI Trust Platform, open ccc-eu from the sidebar (new tab) → it signs in with **no
   second prompt**.
