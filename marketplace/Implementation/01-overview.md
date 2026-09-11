# 01 — Overview: the mental model

*Audience: everyone. No prior knowledge assumed.*

## The problem we're solving

You have a web application — a dashboard, a tool, a small service. You want it available **inside the AI
Trust Platform** so that:

1. Users **don't log in again** — they're already signed into the platform, and the app should just
   trust that (Single Sign-On, "SSO").
2. Only the **right people** can see and open it (role-based access).
3. It appears as a **tile in the platform's sidebar**, opening right there — not a separate website.

Doing all of that by hand (implementing OIDC login, wiring access control, hosting) is a lot of work and
easy to get wrong. The Marketplace onboarding flow does it for you.

## The two halves

Onboarding has exactly two halves. Keep them separate in your head:

```
        APPLICATION SIDE                           PLATFORM SIDE
     (the app's developer)                   (a Platform Administrator)
   ───────────────────────────            ─────────────────────────────────
   Wrap the app so it can accept          Register the wrapped image, deploy
   the platform's login, and              it, and decide which roles may use
   publish it as a container image.       it. The platform handles login +
                                          access + hosting.
```

- **Application side** — a one-time patch to the app's repository (a script does it), then a push that
  triggers an automated build. Covered in [`02-application-patch.md`](./02-application-patch.md) and
  [`03-publish-image.md`](./03-publish-image.md).
- **Platform side** — clicking through the Marketplace UI to register, deploy, and enable the app.
  Covered in [`04-platform-register-and-deploy.md`](./04-platform-register-and-deploy.md).

## Two paths — pick one

**The single question:** does your app have its own login?

```
Does your app have its own login / OIDC?
        │
        ├── NO  → Path A: Platform-SSO sidecar
        │           A companion process handles login for your app.
        │           Your app code is NOT changed.
        │           Run prepare-app.sh → answer N → done.
        │
        └── YES → Path B: JWT trust
                    The platform already verified the user; your app just
                    reads the identity from the JWT the platform passes through.
                    One small change to your auth middleware.
                    Run prepare-app.sh → answer Y → apply the patch.
```

Both paths end in the same place: the user logs in **once** via the platform, opens the tile, and your
app runs embedded — no second login, no separate website.

## How a request actually flows (once it's live)

### Path A — sidecar

```
  Browser
    │  opens  https://<platform>/…/proxy/<your-app>/
    ▼
  Platform proxy  ── strips the prefix, checks the user's role ──┐
    │                                                             │ (403 if not allowed)
    ▼
  Sidecar (port 8080, inside your app's container)
    │  • no session?  → redirect to platform login (Keycloak)
    │  • logged in?   → forward the request + user identity headers
    ▼
  Your app (e.g. port 3000, same container) — unchanged, unaware of OIDC
```

### Path B — JWT trust

```
  Browser
    │  opens  https://<platform>/…/proxy/<your-app>/
    ▼
  Platform proxy  ── strips the prefix, checks the user's role ──┐
    │                                                             │ (403 if not allowed)
    ▼
  Your app (its own port, e.g. 3000) — reads the username from
    the Bearer JWT in the Authorization header.
    No sidecar. No second login.
```

## Why a "sidecar" for Path A instead of changing the app?

Two reasons:

1. **Zero code changes.** The app's source, its own Dockerfile, its start command — all untouched. The
   sidecar is layered *on top* at build time. Any app, in any language, can be onboarded without its
   developer learning OIDC.
2. **One reusable, audited implementation.** The login handshake (OpenID Connect Authorization-Code with
   PKCE) is fiddly and security-sensitive. One shared sidecar is safer than every app rolling its own.

## Why Path B for apps with their own login?

Stacking two OIDC flows (sidecar + the app's own login) causes a redirect loop. The app's OIDC
interaction cookies can't survive the platform proxy stripping the path prefix. The result is
`500 interaction session id cookie not found` or `ERR_TOO_MANY_REDIRECTS`.

For these apps the right answer is: drop the app's own login entirely when running inside the platform,
and trust the identity the platform already verified. One small change; no OIDC knowledge required.
The `prepare-app.sh --sso-mode jwt-trust` flag generates the patch file for you.

## Plain-language glossary

| Term | What it means here |
|------|--------------------|
| **OIDC** (OpenID Connect) | The industry-standard "log in with" protocol. The platform's identity server (Keycloak) speaks it. |
| **OIDC Relying Party (RP)** | An app that *uses* an OIDC login server to authenticate users. The **sidecar** is the RP; your app doesn't have to be one. |
| **Sidecar** | A small companion process shipped in the same container as your app. Here it's an OIDC-login reverse proxy that fronts your app. |
| **Reverse proxy** | Something that receives a request, optionally does work (login), then forwards it to the real app and returns the reply. |
| **JWT** (JSON Web Token) | A signed, base64-encoded token that carries user claims (like `preferred_username`). The platform's oauth2-proxy adds one to every forwarded request as `Authorization: Bearer <token>`. |
| **JWT trust (Path B)** | The app reads the user's identity from the Bearer JWT instead of running its own login. Safe because the platform already verified the JWT. |
| **Keycloak** | The platform's identity server. It shows the login page and issues the tokens that prove who you are. |
| **Realm** | A tenant/partition inside Keycloak. The built-in single-tenant realm is `ai-trust`; a multi-tenant deployment gives each tenant its own realm (e.g. `test`). This distinction matters in [`05`](./05-multitenant-mesh-notes.md). |
| **GHCR** | GitHub Container Registry — where the built image is published (`ghcr.io/<owner>/<repo>:sso` or `:nosso`). |
| **Role gate** | The access check: an app is hidden and blocked unless it's *enabled* for a role the user holds. |
| **Embed proxy** | The platform route `…/api/marketplace/v1/proxy/<slug>/…` that serves your app inside the platform, same-origin, in an iframe. |
| **Tile** | The clickable card for your app in the platform sidebar, under **Services**. |

## What you get at the end

- Your app runs inside the platform, reachable at a platform URL under `…/proxy/<your-app>/`.
- Users open it from a sidebar tile and are **already logged in** (single platform login).
- Only members of the role(s) you enabled can see or open it.
- Path A: **no application code changed** at all.
- Path B: **one function changed** in your auth middleware — and `PLATFORM_SSO=off` keeps your local dev login working.

Next: [`02-application-patch.md`](./02-application-patch.md) — both paths in detail.
