# Onboard an app to the AI Trust Marketplace (with Platform SSO)

**The complete, self-contained guide.** Read this end-to-end and you can take *any* app, make it log in
through the platform, and publish it in the Marketplace — role-gated, embedded in the sidebar — **without
touching platform code and without help**. The reference implementation used throughout is
`capitals-weather` (`github.tools.sap/D058099/capitals-weather`, branch `platform-sso`).

There are three layers. You do work in **Layer 1** (your app) and **Layer 3** (the UI). **Layer 2** is
what the platform does for you automatically — you only need to understand it.

```
  ┌─ Layer 1: YOUR APP ───────────────────────────────────────────────┐
  │  An OIDC Relying Party that logs in against the platform Keycloak, │
  │  runs under the marketplace proxy sub-path, trusts the platform    │
  │  gate. Packaged as a container image.                             │
  └───────────────────────────────────────────────────────────────────┘
                     │ registered as kind=image, sso_enabled=true
                     ▼
  ┌─ Layer 2: THE PLATFORM (automatic) ───────────────────────────────┐
  │  Mints a Keycloak client · injects OIDC_* env · role-gates ·      │
  │  reverse-proxies the app same-origin under                        │
  │  /api/marketplace/v1/proxy/<name>/                                 │
  └───────────────────────────────────────────────────────────────────┘
                     │ operator registers + enables for roles
                     ▼
  ┌─ Layer 3: THE OPERATOR (you, in the UI) ──────────────────────────┐
  │  Add a service → Deploy → Enable for role. The app then appears   │
  │  under "Services" in the sidebar for users in that role.          │
  └───────────────────────────────────────────────────────────────────┘
```

**End result:** a user signs in to the platform once; the app shows up in the left sidebar under
**Services** (only if their role was enabled); clicking it opens the app embedded in the shell; the app
recognizes them as the platform user — no second login.

> Related docs: [integrate-platform-sso.md](integrate-platform-sso.md) (Layer 1 deep-dive),
> [app-requirements.md](app-requirements.md) (operator contract), [env-and-sso.md](env-and-sso.md)
> (env vars + auto-ISSUER), [how-to.md](how-to.md) (all registration models).

---

## Layer 1 — What your APP must do

> **Don't want to change your app's code?** Use the **sidecar** instead — run
> `marketplace/tools/prepare-app/prepare-app.sh <your-repo>` and it wraps your unmodified app with a
> Platform-SSO reverse proxy (works for any language). See
> [`../tools/prepare-app/README.md`](../tools/prepare-app/README.md). The rest of this section is the
> hand-integration path (make the app itself an OIDC RP), for when you want the app to be OIDC-aware.

Your app must be an **OIDC Relying Party (RP)** that federates to the platform's Keycloak and runs
correctly **under the marketplace proxy sub-path**. Everything is driven by environment variables the
platform injects — no platform hostnames are hardcoded in your app.

### The environment the platform injects

When the app is registered `sso_enabled=true`, the deployed container receives:

| Variable | What it is | Example |
|----------|-----------|---------|
| `OIDC_ISSUER` | **Browser-facing** realm issuer. Build the login redirect the *browser* follows from this. | `http://localhost:8180/realms/ai-trust` |
| `OIDC_CLIENT_ID` | The app's confidential client (auth-code flow). | `aitrust-app-capitals-weather` |
| `OIDC_CLIENT_SECRET` | The client secret. **Never log it.** | *(random)* |
| `OIDC_REDIRECT_URI` | The **only** whitelisted callback. Your callback route must be exactly this. | `http://localhost:8080/api/marketplace/v1/proxy/capitals-weather/oauth/callback` |
| `OIDC_SCOPES` | Scopes to request. | `openid profile email` |
| `ISSUER` | The app's **public base path** under the proxy (NOT an IdP). Its path is your `BASE` prefix. | `http://localhost:8080/api/marketplace/v1/proxy/capitals-weather` |
| `OIDC_ISSUER_INTERNAL` | **You supply this** in the Environment-variables box: the issuer URL the *container* can reach for discovery + token exchange. | `http://keycloak:8080/realms/ai-trust` |

Why `OIDC_ISSUER_INTERNAL` exists: `OIDC_ISSUER` is the **browser** URL (`localhost:8180`), which the
container itself usually can't reach. Server-to-server calls (OIDC discovery, token exchange) must use
the **in-cluster** Keycloak address. On a real deployment where the browser URL and the in-cluster URL
are the same (public DNS), you can omit it.

### The seven requirements

1. **Be an OIDC RP** — run the Authorization-Code + PKCE flow. Discover
   `<OIDC_ISSUER_INTERNAL>/.well-known/openid-configuration`; authenticate with the client id/secret;
   on the callback, exchange the code and establish a local session.
2. **Two issuer origins.** Do **discovery + token exchange** against `OIDC_ISSUER_INTERNAL` (reachable
   from the container). Send the **browser** to the **public** `OIDC_ISSUER` origin for the
   authorization step. Discovery returns internal-host endpoints — rewrite the *front-channel* ones
   (`authorization_endpoint`, `end_session_endpoint`) to the public origin; keep `token_endpoint`
   internal.
3. **The proxy strips the prefix — serve at root, but emit prefixed URLs.** The platform proxy removes
   `/api/marketplace/v1/proxy/<name>` before forwarding, so your app **receives bare paths** (`/`,
   `/login`, `/oauth/callback`). Mount your routes at `/`. But every URL the **browser** sees —
   redirects (`Location`), links, `fetch()` targets, and the OIDC `redirect_uri` — must carry the
   base prefix. Derive it once: `BASE = path(OIDC_REDIRECT_URI) - "/oauth/callback"` (equals the path
   of `ISSUER`).
4. **Session cookie `Path=/`.** The app is served at root internally, so scope the session cookie to
   `/` (not the prefix). The browser stores it at `/` on the platform origin, which covers the proxied
   path, so it round-trips. Use `HttpOnly`, `SameSite=Lax`.
5. **Callback = `OIDC_REDIRECT_URI` exactly** — the Keycloak client whitelists only `<base>/*`.
6. **Trust the platform gate.** Once the proxy admits a user (they're in an enabled role) and the OIDC
   login completes, treat them as authorized — show full functionality. Do **not** gate features on
   token role claims: platform roles are authentication info, not the authorization source (OpenFGA is,
   at the proxy), and realm roles appear only as `realm_access.roles` on the access token.
7. **Listen on the port you declare** as **App port** at registration.

### Failure modes (and the fix)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/login` returns 500, logs show `ECONNREFUSED` | app used the browser `OIDC_ISSUER` for discovery/token | use `OIDC_ISSUER_INTERNAL` for back-channel calls |
| `/login` returns 404 | app mounted its routes under `<BASE>` — but the proxy strips the prefix | mount at `/`; emit prefixed URLs to the browser |
| redirect loop `/ → /login → /` | session cookie not stored | cookie `Path=/`; the platform proxy preserves your `Set-Cookie` |
| login lands on the platform shell, not your app | app emitted a bare `/login` redirect | prefix browser-facing URLs with `<BASE>` |

### Node/Express patch sketch

```js
const OIDC_ISSUER          = process.env.OIDC_ISSUER;                          // browser-facing
const OIDC_ISSUER_INTERNAL = process.env.OIDC_ISSUER_INTERNAL || OIDC_ISSUER;  // back-channel
const CLIENT_ID = process.env.OIDC_CLIENT_ID, CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const REDIRECT  = process.env.OIDC_REDIRECT_URI, SCOPES = process.env.OIDC_SCOPES || "openid profile email";
const BASE = new URL(REDIRECT).pathname.replace(/\/oauth\/callback\/?$/, "");   // the proxy prefix

async function discover() {                       // discover INTERNAL, rewrite front-channel to PUBLIC
  const d = await (await fetch(`${OIDC_ISSUER_INTERNAL}/.well-known/openid-configuration`)).json();
  const pub = new URL(OIDC_ISSUER);
  const toPub = u => { const x = new URL(u); x.protocol = pub.protocol; x.host = pub.host; return x.toString(); };
  d.authorization_endpoint = toPub(d.authorization_endpoint);
  if (d.end_session_endpoint) d.end_session_endpoint = toPub(d.end_session_endpoint);
  return d;
}

app.use(session({ name: "app_sid", cookie: { path: "/", httpOnly: true, sameSite: "lax" }, /*…*/ }));
app.use("/", router);                             // MOUNT AT ROOT (proxy strips the prefix)

router.get("/login", async (req, res) => {         // browser → PUBLIC authorization_endpoint (code+PKCE)
  const d = await discover(); const u = new URL(d.authorization_endpoint);
  u.searchParams.set("client_id", CLIENT_ID); u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);        u.searchParams.set("redirect_uri", REDIRECT);
  /* + code_challenge (PKCE) + signed state */ res.redirect(u.toString());
});
router.get("/oauth/callback", async (req, res) => {// exchange code at INTERNAL token_endpoint
  const d = await discover();
  /* POST d.token_endpoint {code, redirect_uri:REDIRECT, code_verifier, Basic client auth} */
  req.session.user = { /* sub, preferred_username from id_token */ };
  res.redirect(`${BASE}/`);                        // browser-facing → prefixed
});
router.get("/logout", /* destroy session → d.end_session_endpoint (public) */);
router.get("/api/*", requireAuth, /* … */);        // requireAuth → res.redirect(`${BASE}/login`)
```

Frontend (`index.html`/`app.js`): derive the base from the URL and prefix every link/fetch —
`window.APP_BASE = location.pathname.replace(/\/(index\.html)?$/, "")`.

---

## Layer 1 worked example — capitals-weather

`capitals-weather` is a Node/Express app that shows live weather for the 27 EU capitals. It is the
reference implementation of everything above.

**Before** (`main` branch): it ran its **own** embedded OIDC provider (`oidc-provider`) with a local
`admin`/`admin` user and its own RBAC. That cannot work embedded under a sub-path (its login cookies
are path-scoped to root).

**After** (`platform-sso` branch — the version to deploy): a platform OIDC RP. The changes:
- `server.js` rewritten: RP auth-code+PKCE against `OIDC_ISSUER`; discovery/token over
  `OIDC_ISSUER_INTERNAL` with front-channel endpoints rewritten to the public issuer; router **mounted
  at `/`** while emitting **`BASE`-prefixed** browser URLs; session cookie `Path=/`; `/oauth/callback`
  is the whitelisted redirect_uri; **platform-gate authorization** — any authenticated user sees all 27
  capitals (no in-app role filter).
- Deleted `auth/oidc-config.js`, `auth/users.js`, the `rbac.js` role map, and `views/login.ejs`.
- Dependencies shrank to `express` + `express-session` (dropped `oidc-provider`, `bcryptjs`, `ejs`).
- `index.html` / `app.js` derive `window.APP_BASE` and prefix all links/fetches.

Image: built and available in the in-cluster registry as **`localhost:5000/capitals-weather:sso`**
(the public Docker Hub tag `mirceacraciun795/capitals-weather:1.0.0` is the *old*, embedded-IdP version —
use the `:sso` image for platform SSO).

> Aside: the repo also carries a `component-constructor.yaml` for the OCM path. For platform-SSO
> onboarding we use the plain **prebuilt image** path; OCM is orthogonal.

---

## Layer 2 — What the PLATFORM does automatically

You do **not** configure any of this — it happens because you registered the app with
`sso_enabled=true`. Understanding it explains the env table above.

On **register** + **deploy**, the platform:
1. **Mints a per-app Keycloak client** `aitrust-app-<name>` in realm `ai-trust` — confidential,
   authorization-code flow, `redirectUris=[<embed_base>/*]`, `webOrigins=[<embed_base>]` where
   `embed_base = <APP_PUBLIC_URL>/api/marketplace/v1/proxy/<name>`. *(source: `marketplace/backend/app/keycloak.py`)*
2. **Injects the OIDC env** into the container (the table above) and delivers `OIDC_CLIENT_SECRET`
   out-of-band (compose inline env / k8s Secret). For a same-window app it also auto-sets `ISSUER` to
   the proxy base unless you set it yourself. *(source: `marketplace/backend/app/oidc.py`, `routers/services.py`)*
3. **Role-gates** the app: it is hidden from the catalog and returns **403 at the proxy** until an
   operator enables it for a role. *(source: `routers/services.py` `_is_gated` / `_is_enabled_for`)*
4. **Reverse-proxies** the app same-origin at `/api/marketplace/v1/proxy/<name>/` — **stripping that
   prefix** before forwarding, **rewriting** root-relative `Location` redirects back under the prefix,
   and **preserving** the app's `Set-Cookie` headers. *(source: `routers/services.py` proxy handler)*

**No platform code change is ever needed to onboard an app** — the entire flow is driven by the
registration you do in Layer 3.

> k8s note: the mechanics are identical; `OIDC_CLIENT_SECRET` arrives as a Secret-backed env var and
> the image is pulled from the in-cluster registry. Compose is the walkthrough below.

---

## Layer 3 — Manual onboarding in the UI (no API, no scripts)

**Prerequisite:** sign in as a user with the `marketplace:manage` permission (a Platform Admin). Only
then does the **Marketplace** item appear in the left sidebar.

Open **Marketplace**. The page reads *“Add a service from a Git URL and deploy it onto this cluster.
Deployed services appear in the sidebar under Services.”*

### Step 1 — Add the service

In the **Add a service (internal — deployed on this cluster)** form:

1. **Display name** — e.g. `EU Capitals Weather`. (Typing here auto-fills the slug.)
2. **Slug (URL-safe)** — e.g. `capitals-weather`. This becomes the app's name in the proxy path.
3. **Type** — click the card **“Server app — prebuilt image”**
   (*“Pull and run a prebuilt image you already have (public or private registry).”*).
4. **Image reference** — `localhost:5000/capitals-weather:sso`
   (for a public image it would be e.g. `ghcr.io/acme/app:1.2`).
5. **App port** — `3000` (the port your container listens on).
6. Tick **Platform SSO** — *“Mint a per-app OIDC client and inject OIDC_* env so the app runs its own
   login against the platform realm. The app is then role-gated (hidden until an operator enables it
   for a role).”*
7. Leave **Open in a new tab** **unticked** — you want it embedded (same-window).
8. **Environment variables (optional)** — enter, one per line:
   ```
   OIDC_ISSUER_INTERNAL=http://keycloak:8080/realms/ai-trust
   ```
   *(This is the back-channel issuer the container reaches for OIDC discovery/token. Plain, non-secret
   config — never put secrets or registry credentials here.)*
9. Leave **Private registry** unticked (the `:sso` image in the in-cluster registry needs no pull creds).
10. Click **Add to catalog**.

A card appears for **EU Capitals Weather** with badges **`pending`**, **`server app`**, and
**`SSO · role-gated`**.

### Step 2 — Deploy

On the card, click **Deploy**. For a public / in-cluster image it deploys in one click and the status
badge moves `pending → deploying → running`. *(If you had ticked Private registry, the first Deploy
click reveals **Registry username** and **Registry token / password** fields — “Used only to pull the
image — never stored.” — and a second Deploy click pulls with them.)*

### Step 3 — Enable it for a role

Once the status is **`running`**, an **Enable for role…** dropdown and an **Apply** button appear on the
card (these show only for operators, on a running gated app; the roles come from the platform IAM).
Pick a role — e.g. **Platform Administrator** — and click **Apply**.

That's it. The app is now:
- **Visible in the left sidebar under “Services”** for every user in the enabled role (users without
  an enabling role don't see it and are 403'd at the proxy).
- **Opened embedded** in the shell when clicked (same-window → `#/embed/<name>`). The first open bounces
  the user through the platform login and back; the app then renders with the user recognized as their
  platform identity.

### Inspect what was configured — the Configuration button

Click **Configuration** on the card (toggles to **Hide config**). A read-only panel shows:

```
Kind          image
Image ref     localhost:5000/capitals-weather:sso
App port      3000
Open mode     same window (embedded)
Platform SSO  on (role-gated)
Environment   OIDC_ISSUER_INTERNAL = http://keycloak:8080/realms/ai-trust
```

Deploy-time secrets (the OIDC client secret, any pull credentials) are **never** shown or stored here.

The card, at a glance:

```
┌──────────────────────────────────────────────┐
│ EU Capitals Weather                            │
│ localhost:5000/capitals-weather:sso            │
│ [running] [server app] [SSO · role-gated]      │
│                                                │
│ [ Open ] [ Configuration ] [ Delete ]          │
│                                                │
│ Enable for role… ▼   [ Apply ]                 │
└──────────────────────────────────────────────┘
```

---

## Verify it worked (no Claude needed)

1. **Container env** — the OIDC contract is present:
   ```bash
   docker exec mkt-capitals-weather env | grep -E 'OIDC_|^ISSUER='
   # OIDC_ISSUER=http://localhost:8180/realms/ai-trust
   # OIDC_CLIENT_ID=aitrust-app-capitals-weather
   # OIDC_REDIRECT_URI=http://localhost:8080/api/marketplace/v1/proxy/capitals-weather/oauth/callback
   # OIDC_ISSUER_INTERNAL=http://keycloak:8080/realms/ai-trust
   # ISSUER=http://localhost:8080/api/marketplace/v1/proxy/capitals-weather
   ```
   *(The container name is `mkt-<slug>`.)*
2. **Login federates to the platform** — the app's `/login` redirects to the platform Keycloak:
   ```bash
   docker exec ai-trust-platform-git-shell-1 \
     wget -S -qO- "http://mkt-capitals-weather:3000/login" 2>&1 | grep -i location
   # Location: http://localhost:8180/realms/ai-trust/protocol/openid-connect/auth?client_id=aitrust-app-capitals-weather&...
   ```
3. **In the browser** — sign in to the platform, open the tile under **Services**. You are recognized as
   your platform user (no app-local login), and the app renders inside the shell.

---

## Appendix — quick reference

### Injected env (Layer 1)
`OIDC_ISSUER` (browser) · `OIDC_CLIENT_ID` (`aitrust-app-<name>`) · `OIDC_CLIENT_SECRET` (secret) ·
`OIDC_REDIRECT_URI` (`<base>/oauth/callback`) · `OIDC_SCOPES` (`openid profile email`) · `ISSUER`
(public base path) · **you set** `OIDC_ISSUER_INTERNAL` (in-cluster issuer).

### API endpoints (for automation — the UI calls these)
| Action | Method + path |
|--------|---------------|
| Register a service | `POST /api/marketplace/v1/services` |
| Deploy | `POST /api/marketplace/v1/services/{id}/deploy` (body only for a private-registry pull) |
| Enable for a role | `POST /api/marketplace/v1/services/{id}/enable-role` (body `{ "role": "<name>" }`) |
| List roles (for the dropdown) | `GET /api/users/v1/iam/roles` |
| Delete | `DELETE /api/marketplace/v1/services/{id}` |
| List services | `GET /api/marketplace/v1/services` |

Registration body for a Platform-SSO image app:
```json
{
  "name": "capitals-weather", "label": "EU Capitals Weather", "kind": "image",
  "image_ref": "localhost:5000/capitals-weather:sso", "app_port": 3000,
  "open_mode": "same_window", "sso_enabled": true, "source": "internal",
  "env": { "OIDC_ISSUER_INTERNAL": "http://keycloak:8080/realms/ai-trust" }
}
```

### The four failure modes
`/login` 500 (ECONNREFUSED) → use `OIDC_ISSUER_INTERNAL`. · `/login` 404 → mount at root. · redirect
loop → cookie `Path=/`. · lands on the shell → prefix browser URLs with `<BASE>`.

### See also
[integrate-platform-sso.md](integrate-platform-sso.md) ·
[app-requirements.md](app-requirements.md) ·
[env-and-sso.md](env-and-sso.md) ·
[how-to.md](how-to.md)
