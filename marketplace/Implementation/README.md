# Onboarding an app into the AI Trust Platform Marketplace

**Start here.** This folder is the complete, end-to-end guide to taking *any* web application and making
it available inside the AI Trust Platform — with the platform handling login (Single Sign-On) and access
control for you.

It is written for **two audiences**:

- **Non-technical readers** (product, project leads, reviewers): read this page and
  [`01-overview.md`](./01-overview.md). That's the whole story at a high level, plus the slide deck
  [`Marketplace_Onboarding_Flow.pptx`](./Marketplace_Onboarding_Flow.pptx).
- **Technical readers** (developers, operators): continue through documents `02`–`06` for the exact
  commands, fields, environment variables, and what happens behind the scenes.

---

## The whole flow in one picture

```
  ┌── ON THE APPLICATION (done once, by the app's developer) ─────────────────┐
  │                                                                            │
  │  1. Run the prepare-app script   →  it adds a "Platform-SSO sidecar" and   │
  │     against your app repo            a build recipe to your repo           │
  │                                      (your app code is NOT changed)        │
  │                                                                            │
  │  2. Push to the new branch       →  GitHub Actions builds a container      │
  │     (platform-sso)                   image and publishes it to GHCR        │
  │                                                                            │
  └────────────────────────────────────────────────────────────────────────┬─┘
                                                                             │
                                                            the published image ref
                                                        ghcr.io/<owner>/<repo>:sso
                                                                             │
  ┌── ON THE AI TRUST PLATFORM (done by a Platform Administrator) ───────────▼─┐
  │                                                                            │
  │  3. Register the service   →  fill the Marketplace "Add a service" form    │
  │     (Marketplace UI)          (image ref, port, Platform SSO ✅)           │
  │                                                                            │
  │  4. Deploy                 →  the platform pulls the image, mints an       │
  │                               OIDC login client for it, injects the        │
  │                               login settings, and runs it                  │
  │                                                                            │
  │  5. Enable for a role      →  the app's tile appears for users in that     │
  │                               role, under "Services" in the sidebar        │
  │                                                                            │
  │  6. Use it                 →  users click the tile → they are already      │
  │                               logged in via the platform → the app opens   │
  │                               embedded, no second login                    │
  │                                                                            │
  └────────────────────────────────────────────────────────────────────────┘
```

**In one sentence:** you wrap your app once (no code changes), publish it as an image, then register +
deploy + enable it in the Marketplace — and the platform gives it login and role-based access for free.

---

## Table of contents

| Doc | Audience | What it covers |
|-----|----------|----------------|
| [`01-overview.md`](./01-overview.md) | everyone | The mental model, the two halves, plain-language glossary. |
| [`02-application-patch.md`](./02-application-patch.md) | developers | The target-app patch: `prepare-app`, the sidecar, ports, env, limits. |
| [`03-publish-image.md`](./03-publish-image.md) | developers | Push → GitHub Actions → publish the image to GHCR. |
| [`04-platform-register-and-deploy.md`](./04-platform-register-and-deploy.md) | operators | Register → Deploy → Enable-for-role → Use, and what happens behind the scenes. |
| [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md) | operators (advanced) | Running on a multi-tenant mesh deployment — the per-tenant Keycloak realm caveat. |
| [`06-troubleshooting.md`](./06-troubleshooting.md) | everyone | Symptom → cause → fix for the common failures. |
| [`07-prepare-app-script.md`](./07-prepare-app-script.md) | developers | The full `prepare-app.sh` source + its templates, embedded in one place. |
| [`08-worked-example-weather-app.md`](./08-worked-example-weather-app.md) | everyone | A real, warts-and-all onboarding run: every dead end and the fix that worked (incl. replacing an app's own OIDC with Platform OIDC). |
| [`Marketplace_Onboarding_Flow.pptx`](./Marketplace_Onboarding_Flow.pptx) | everyone | ~9-slide deck explaining the flow and what's behind the scenes. |

Deeper reference (existing platform docs, more detail per topic) lives in
[`../docs/`](../docs/) — this folder is the guided path; those are the encyclopedia.

---

## The 6 steps, as a checklist

- [ ] **1. Patch the app** — `marketplace/tools/prepare-app/prepare-app.sh <your-app>` → commit the
      generated files. *(→ [`02`](./02-application-patch.md))*
- [ ] **2. Publish** — push the `platform-sso` branch → wait for the green **publish-image** Action →
      confirm `ghcr.io/<owner>/<repo>:sso` exists. *(→ [`03`](./03-publish-image.md))*
- [ ] **3. Register** — Marketplace → *Add a service* → prebuilt image, port **8080**, Platform SSO ✅,
      env box **empty**. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **4. Deploy** — click Deploy; supply the registry username + `read:packages` token if the image is
      private. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **5. Enable for a role** — pick the role(s) that should see it. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **6. Use** — the tile appears under **Services**; click → embedded, already logged in.

> **Multi-tenant deployments:** if your platform is a mesh/MSP tenant (you log in against a per-tenant
> realm such as `test`, not the built-in `ai-trust` realm), read
> [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md) **before** deploying an SSO app — one
> platform setting must match your tenant's realm or SSO will fail.

---

## What "no code changes" really means

Your application is **wrapped, not modified.** The `prepare-app` tool adds a tiny companion process (a
"sidecar") that sits in front of your app, does the platform login, and then forwards requests to your
app unchanged. Your app can be written in any language; it only has to listen on a TCP port. See
[`02-application-patch.md`](./02-application-patch.md) for exactly what gets added.
