# Integrate an app as a Platform-SSO, role-gated internal Marketplace app

> This is **Layer 1** (the app-side contract) of the full end-to-end guide,
> [onboard-an-app.md](onboard-an-app.md) — which also covers what the platform does automatically and
> the click-by-click UI walkthrough.

This is the app-side contract for running **your** app inside the AI Trust Marketplace as an
**internal** service that authenticates against the **platform** (Keycloak `ai-trust` realm) and is
**role-gated** — one platform login, and an operator enables the app for one or more roles.

It complements [app-requirements.md](app-requirements.md) (operator contract),
[deploy-dockerfile.md](deploy-dockerfile.md) (how server apps run), and
[env-and-sso.md](env-and-sso.md) (env vars + auto-ISSUER). The worked reference implementation is
`github.tools.sap/D058099/capitals-weather` (branch `platform-sso`).

## How it works

Register the app `kind="image"` (or `dockerfile`), `sso_enabled=true`, `open_mode="same_window"`. The
platform then:

1. **Mints a per-app confidential Keycloak client** `aitrust-app-<name>` in the `ai-trust` realm,
   whitelisting `redirectUris=[<embed_base>/*]`, `webOrigins=[<embed_base>]`.
2. **Injects OIDC env** into your container (see table below).
3. **Role-gates** the app: it is hidden from the catalog and `403`'d at the proxy until an operator
   calls `POST /services/{id}/enable-role` for a role. Members of that role then get access.
4. **Reverse-proxies** the app same-origin at `<APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>/`,
   **stripping that prefix** before forwarding — so your app receives *bare* paths (`/`, `/login`,
   `/oauth/callback`), but the **browser** sees the prefixed URLs.

The proxy does **not** forward a bearer token for an internal SSO app — your app runs the OIDC
Authorization-Code flow itself. Authorization is the platform's job: once the proxy admits a user
(they're in an enabled role), treat them as authorized.

## Injected environment

| env | meaning |
|-----|---------|
| `OIDC_ISSUER` | **Browser-facing** realm issuer, e.g. `http://localhost:8180/realms/ai-trust`. Use it to build the authorization redirect the browser follows. |
| `OIDC_CLIENT_ID` | `aitrust-app-<name>` (confidential, authorization-code flow). |
| `OIDC_CLIENT_SECRET` | client secret (compose inline env / k8s Secret). Never log it. |
| `OIDC_REDIRECT_URI` | the ONLY whitelisted callback: `<APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>/oauth/callback`. |
| `OIDC_SCOPES` | `openid profile email`. |
| `ISSUER` | the app's **public base path** `<APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>` (auto-set for same-window). **Not** an IdP issuer — use its path to build browser-facing URLs / cookie logic. |
| `OIDC_ISSUER_INTERNAL` *(you supply via the env box)* | **Back-channel** issuer the container can reach for discovery + token exchange, e.g. `http://keycloak:8080/realms/ai-trust`. Needed because `OIDC_ISSUER` is a browser URL the container usually can't reach. |

Set `OIDC_ISSUER_INTERNAL` in the register form's **Environment variables** box (it's plain, non-secret
config). On a deployment where the browser and in-cluster URLs are the same (real DNS), omit it.

## The app contract — do these

1. **Be an OIDC Relying Party, not an IdP.** Discover `OIDC_ISSUER_INTERNAL` (fallback `OIDC_ISSUER`)
   `/.well-known/openid-configuration`; run Authorization-Code + PKCE with
   `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`OIDC_REDIRECT_URI`/`OIDC_SCOPES`. On callback, exchange the
   code and establish a local session.
2. **Two issuer origins.** Do the **authorization redirect** the browser follows against the **public**
   `OIDC_ISSUER` origin; do **discovery + token exchange** against `OIDC_ISSUER_INTERNAL`. Discovery
   returns internal-host endpoints — rewrite the *browser-facing* ones (`authorization_endpoint`,
   `end_session_endpoint`) to the public origin; keep `token_endpoint` internal.
3. **The proxy strips the prefix — serve at root, emit with the prefix.** Mount your routes at `/`
   (you receive bare `/`, `/login`, `/oauth/callback`). But every URL the **browser** sees — redirects
   (`Location`), links, `fetch()` targets, and the OIDC `redirect_uri` — must carry the base prefix
   (`<BASE>` = the path of `OIDC_REDIRECT_URI` minus `/oauth/callback`, ≡ `ISSUER`'s path). The
   platform proxy also rewrites root-relative `Location` headers as a safety net, but build them
   correctly.
4. **Cookies: `Path=/`.** Scope the session cookie to `/` (the app is served at root internally; the
   browser stores it at `/` on the platform origin, covering the proxied path). `SameSite=Lax`,
   `HttpOnly`. The proxy preserves your `Set-Cookie` headers.
5. **Callback = `OIDC_REDIRECT_URI` exactly** — the only whitelisted URI.
6. **Trust the platform gate.** A completed login ⇒ authorized; show full functionality. Don't rely on
   token role claims for feature gating — platform roles arrive as `realm_access.roles` on the access
   token only and are **not** the authorization source (OpenFGA is, at the proxy).
7. **Listen on the declared `app_port`.**

## Reference patch pattern (Node/Express)

The capitals-weather reference did exactly this (see its `server.js`). The essential shape:

```js
const OIDC_ISSUER          = process.env.OIDC_ISSUER;                       // browser-facing
const OIDC_ISSUER_INTERNAL = process.env.OIDC_ISSUER_INTERNAL || OIDC_ISSUER; // back-channel
const CLIENT_ID = process.env.OIDC_CLIENT_ID, CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const REDIRECT  = process.env.OIDC_REDIRECT_URI, SCOPES = process.env.OIDC_SCOPES || "openid profile email";
const BASE = new URL(REDIRECT).pathname.replace(/\/oauth\/callback\/?$/, ""); // the proxy prefix

// discover over INTERNAL, rewrite browser endpoints to the PUBLIC origin:
async function discover() {
  const d = await (await fetch(`${OIDC_ISSUER_INTERNAL}/.well-known/openid-configuration`)).json();
  const pub = new URL(OIDC_ISSUER);
  const toPublic = u => { const x = new URL(u); x.protocol = pub.protocol; x.host = pub.host; return x.toString(); };
  d.authorization_endpoint = toPublic(d.authorization_endpoint);
  if (d.end_session_endpoint) d.end_session_endpoint = toPublic(d.end_session_endpoint);
  return d;
}

app.use(session({ name: "app_sid", cookie: { path: "/", httpOnly: true, sameSite: "lax" }, /*…*/ }));
app.use("/", router);                    // MOUNT AT ROOT (proxy strips the prefix)

router.get("/login", async (req,res) => {           // browser → PUBLIC authorization_endpoint
  const d = await discover();
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("redirect_uri", REDIRECT);
  /* + PKCE code_challenge + signed state */
  res.redirect(url.toString());
});
router.get("/oauth/callback", async (req,res) => {  // exchange code at INTERNAL token_endpoint
  const d = await discover();
  const tok = await fetch(d.token_endpoint, { method:"POST", /* code, redirect_uri=REDIRECT, PKCE, Basic auth */ });
  req.session.user = { /* sub, preferred_username from id_token */ };
  res.redirect(`${BASE}/`);                          // browser-facing: prefixed
});
router.get("/logout", /* destroy session → end_session_endpoint (public) */);
router.get("/api/*", requireAuth, /* … */);          // requireAuth → res.redirect(`${BASE}/login`)
```

Frontend (`index.html`/`app.js`): derive `window.APP_BASE = location.pathname.replace(/\/(index\.html)?$/, "")`
and prefix every `fetch()`/link with it, so assets and API calls resolve under the proxy path.

## Register + enable + verify

```bash
# 1. register (via UI: Type = Server app — prebuilt image, sso_enabled, same_window; or API)
POST /v1/services { "name":"myapp","label":"My App","kind":"image","image_ref":"…","app_port":3000,
  "open_mode":"same_window","sso_enabled":true,"source":"internal",
  "env":{"OIDC_ISSUER_INTERNAL":"http://keycloak:8080/realms/ai-trust"} }
# 2. enable for a role you hold (otherwise the app is hidden + proxy-403)
POST /v1/services/{id}/enable-role { "role":"platform_administrator" }
# 3. deploy, then open the tile — you are logged in via the platform, embedded, no app-local login.
POST /v1/services/{id}/deploy
```

Verify the deployed container env carries `OIDC_ISSUER`, `OIDC_CLIENT_ID=aitrust-app-<name>`,
`OIDC_REDIRECT_URI=.../oauth/callback`, `OIDC_CLIENT_SECRET`, and (that you supplied)
`OIDC_ISSUER_INTERNAL`. Opening the tile should redirect `/ → /login → platform Keycloak → /oauth/callback → /`
entirely under `/api/marketplace/v1/proxy/<name>/`, then render your app.

## Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/login` 500, `ECONNREFUSED` | app used browser `OIDC_ISSUER` for discovery/token | use `OIDC_ISSUER_INTERNAL` for back-channel |
| 404 on `/login` | app mounted routes at `<BASE>` — but the proxy strips the prefix | mount at `/`; emit prefixed URLs |
| redirect loop `/ → /login → /` | session cookie not stored (wrong `Path`, or proxy dropped `Set-Cookie`) | cookie `Path=/`; ensure the platform proxy preserves multiple `Set-Cookie` (fixed platform-side) |
| login lands on the platform shell, not the app | app emitted a bare `/login` `Location` | prefix browser-facing URLs with `<BASE>` |
