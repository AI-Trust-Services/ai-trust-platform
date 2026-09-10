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

## How a request actually flows (once it's live)

When a user opens the app's tile, here's the journey of a single click:

```
  Browser
    │  opens  https://<platform>/…/proxy/<your-app>/
    ▼
  Platform proxy  ── strips the "/…/proxy/<your-app>" prefix, checks the user's role ──┐
    │                                                                                   │ (403 if not allowed)
    ▼
  Sidecar (in your app's container, port 8080)
    │  • no session yet?  → redirect the browser to the platform login (Keycloak)
    │  • logged in?       → forward the request onward, adding the user's identity
    ▼
  Your app (same container, internal port 3000) — unchanged, unaware of any of this
```

Two things do all the work:

- **The platform proxy** (on the platform) — routes the request to your app, enforces the role check, and
  fixes up URLs so the app behaves correctly under its sub-path.
- **The sidecar** (a small companion inside your app's image) — performs the actual login handshake and
  then hands the request to your app.

Your app itself does nothing special. It just serves HTTP on a port.

## Why a "sidecar" instead of changing the app?

Two reasons:

1. **Zero code changes.** The app's source, its own Dockerfile, its start command — all untouched. The
   sidecar is layered *on top* at build time. This means any app, in any language, can be onboarded, and
   an app owner never has to learn OIDC.
2. **One reusable, audited implementation.** The login handshake (OpenID Connect Authorization-Code with
   PKCE) is fiddly and security-sensitive. Doing it once, in the sidecar, and reusing it everywhere is far
   safer than every app rolling its own.

## Plain-language glossary

| Term | What it means here |
|------|--------------------|
| **OIDC** (OpenID Connect) | The industry-standard "log in with" protocol. The platform's identity server (Keycloak) speaks it. |
| **OIDC Relying Party (RP)** | An app that *uses* an OIDC login server to authenticate users. The **sidecar** is the RP; your app doesn't have to be one. |
| **Sidecar** | A small companion process shipped in the same container as your app. Here it's an OIDC-login reverse proxy that fronts your app. |
| **Reverse proxy** | Something that receives a request, optionally does work (login), then forwards it to the real app and returns the reply. |
| **Keycloak** | The platform's identity server. It shows the login page and issues the tokens that prove who you are. |
| **Realm** | A tenant/partition inside Keycloak. The built-in single-tenant realm is `ai-trust`; a multi-tenant deployment gives each tenant its own realm (e.g. `test`). This distinction matters in [`05`](./05-multitenant-mesh-notes.md). |
| **GHCR** | GitHub Container Registry — where the built image is published (`ghcr.io/<owner>/<repo>:sso`). |
| **Role gate** | The access check: an app is hidden and blocked unless it's *enabled* for a role the user holds. |
| **Embed proxy** | The platform route `…/api/marketplace/v1/proxy/<slug>/…` that serves your app inside the platform, same-origin, in an iframe. |
| **Tile** | The clickable card for your app in the platform sidebar, under **Services**. |

## What you get at the end

- Your app runs inside the platform, reachable at a platform URL under `…/proxy/<your-app>/`.
- Users open it from a sidebar tile and are **already logged in** (single platform login).
- Only members of the role(s) you enabled can see or open it.
- You changed **no application code** to get there.

Next: [`02-application-patch.md`](./02-application-patch.md) — the application-side patch.
