# 04 — Register, deploy, enable, use (the platform side)

*Audience: a Platform Administrator (holds the `marketplace:manage` permission — the only role that sees
the **Marketplace** nav item). This is the "what to do on the AI Trust Platform" half.*

You now have a published image (`ghcr.io/<owner>/<repo>:sso`). Four clicks-worth of work turns it into a
live, role-gated, SSO tile.

---

## 4.1 Register — “Add a service”

Marketplace → **Add a service (internal — deployed on this cluster)**. Fill it in:

| Field | Value | Notes |
|-------|-------|-------|
| **Display name** | e.g. `EU Capitals Weather` | Free text; what users see. |
| **Slug (URL-safe)** | e.g. `whether-app` | The id used in the proxy path. |
| **Type** (radio cards) | **Server app — prebuilt image** | Other cards: static site, build-from-Dockerfile, OCM ingest/build. |
| **Image reference** | `ghcr.io/<owner>/<repo>:sso` | The ref you published in [`03`](./03-publish-image.md). |
| **App port** | **`8080`** | The sidecar's port — **not** your app's internal 3000. |
| **Platform SSO** | ✅ tick | Makes the platform mint the OIDC client and inject the login env. |
| **Open in a new tab** | ⬜ leave unticked | Unticked = embedded (recommended). |
| **Private registry** | ✅ tick (if the GHCR package is private) | Untick only if you made it public. |
| **Environment variables** | **leave empty** | The platform injects all OIDC settings automatically. Do **not** put `OIDC_ISSUER_INTERNAL=…ai-trust` here — that's an old single-tenant value. |

Click **Add to catalog**. A card appears with status **pending** — nothing is running yet. Registration
only records the row; no image is pulled and no login client is created at this point.

> **The Type cards** map to five choices in the UI (`static`, `dockerfile`, `image`, `ocm`, `ocm-build`),
> but OCM ingest/build both resolve to a prebuilt **image** behind the scenes. For the sidecar flow you
> always want **Server app — prebuilt image**.

---

## 4.2 Deploy

Click **Deploy** on the card.

- If you ticked **Private registry**, the first click reveals **Registry username** (your GitHub username)
  and **Registry token / password** (a `read:packages` PAT). Fill both and click Deploy again. *These
  credentials are used only to pull the image and are never stored.*
- Status goes **deploying → running**.

### What happens behind the scenes on Deploy (SSO app)

This is the part the ChatGPT summary glosses over — here's what the platform actually does:

1. **Validates** the private-registry credentials are present (if the image is private) — before anything
   else.
2. **Mints a per-app OIDC client** in Keycloak, named `aitrust-app-<slug>`, idempotently: a confidential
   client whose redirect URIs cover the app's embed base (`…/proxy/<slug>/*`).
3. **Injects the OIDC environment** into the container:
   - `OIDC_ISSUER` (browser-facing, from the platform's `KEYCLOAK_PUBLIC_URL` + realm)
   - `OIDC_CLIENT_ID` = `aitrust-app-<slug>`
   - `OIDC_REDIRECT_URI` = `…/proxy/<slug>/oauth/callback`
   - `OIDC_SCOPES` = `openid profile email`
   - `OIDC_CLIENT_SECRET` — read **live** from Keycloak and delivered as a Kubernetes Secret (never
     persisted in the marketplace database, never logged).
   - For an embedded (`same_window`) app it also auto-sets `ISSUER` to the app's proxy base.
4. **Pulls and runs the image** (using your registry credentials if private). No build step for a prebuilt
   image.
5. On success the row records `status=running`, the service host, and the OIDC client id. On failure the
   status becomes `failed` with a truncated error.

Your app's sidecar now has everything it needs to run the platform login.

---

## 4.3 Enable for a role

A freshly deployed SSO app is **hidden and blocked** for everyone until you enable it for at least one
role.

Click **Enable for role…** on the card → pick a role (e.g. **Platform Administrator**) → **Apply**.

### What "enable" actually does

- It writes a row into the marketplace's **own Postgres table** (`MarketplaceAppEnabledRole`) — it does
  **not** write an OpenFGA tuple. (OpenFGA is only read, to look up *your* roles when checking the gate.)
- The tile now appears under **Services** in the sidebar for users who hold that role. The Luigi shell
  builds that menu from the list of running, enabled services.
- The **same gate is re-enforced at the proxy**: even if someone crafts the URL, a user without the role
  gets **403** — visibility and access are independent checks, both enforced server-side.

> Operators (you) can *see* a gated internal app on the Marketplace page even before enabling it — that's
> deliberate, so you can deploy and manage it. Regular users only see it once it's enabled for their role.

You can also **Enable for a specific user** (a separate table) if you need finer-grained access than roles.

---

## 4.4 Use it

A user in the enabled role opens the platform, finds the tile under **Services**, and clicks it:

- The tile opens **embedded** (an iframe served same-origin under `…/api/marketplace/v1/proxy/<slug>/`).
- The sidecar sees no session yet → redirects to the platform login (Keycloak) → the user is *already*
  signed into the platform, so it completes silently → the sidecar establishes its session and forwards to
  your app.
- **No second login** (unless your app has its own login screen — see the double-login note in
  [`02`](./02-application-patch.md#28-limits-know-these-before-you-ship)).

### The embed proxy, briefly

The route `…/api/marketplace/v1/proxy/<slug>/{path}`:

- Strips the `…/proxy/<slug>` prefix before forwarding (so the sidecar serves at root).
- Preserves multiple `Set-Cookie` headers (login sessions survive).
- Rewrites **root-relative redirect `Location`** headers to re-add the prefix (so a `/login` redirect from
  the sidecar stays inside the proxied path). Fully-qualified external redirects are left alone.

---

## 4.5 Inspect what you configured

Click **Configuration** on the card for a read-only summary: Kind, Image ref, App port, Open mode, Platform
SSO on/off, and the (non-secret) environment list. Secrets are never shown.

---

## 4.6 Recap of the platform-side state machine

```
  Add to catalog        Deploy                    Enable for role
  ───────────────►      ──────────────►           ────────────────►
  status: pending       status: running           tile visible + openable
  (row only, nothing    (client minted, OIDC       for that role
   running)              env injected, image        (Postgres enable row;
                         pulled + running)          proxy re-checks the gate)
```

> **On a multi-tenant mesh deployment**, step 4.2 mints the client in whatever realm the
> `marketplace-backend` is configured for. If that realm doesn't match the realm you log in with, SSO will
> fail even though everything above "succeeds". Read [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md)
> **before** deploying an SSO app on such a platform.

Troubleshooting: [`06-troubleshooting.md`](./06-troubleshooting.md).
