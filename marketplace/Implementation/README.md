# Onboarding an app into the AI Trust Platform Marketplace

**Start here.** This folder is the complete, end-to-end guide to taking *any* web application and making
it available inside the AI Trust Platform — with the platform handling login (Single Sign-On) and access
control for you.

It is written for **two audiences**:

- **Non-technical readers** (product, project leads, reviewers): read this page and
  [`01-overview.md`](./01-overview.md). That's the whole story at a high level, plus the slide deck
  [`Marketplace_Onboarding_Flow.pptx`](./Marketplace_Onboarding_Flow.pptx).
- **Technical readers** (developers, operators): continue through documents `02`–`07` for the exact
  commands, fields, environment variables, and what happens behind the scenes.

---

## Prerequisites

Before onboarding an app, make sure you have:

| # | What | Why |
|---|------|-----|
| 1 | **Node.js ≥ 18** | Required by the Platform-SSO sidecar (Path A) |
| 2 | **Docker Desktop (or Docker Engine) with `buildx`** | Builds the `linux/amd64` image; `buildx` is bundled with Docker Desktop |
| 3 | **A GitHub account with access to GHCR** | The image is published to `ghcr.io/<your-org>/<repo>` |
| 4 | **GitHub Actions enabled on the repo** | CI publishes the image automatically on push |
| 5 | **AI Trust Platform Administrator access** | You need `marketplace:manage` to see the Marketplace UI |
| 6 | **A GitHub PAT with `read:packages` scope** | Used at deploy time to pull a private image (skip if you make the package public) |

> **Multi-tenant deployment?** — if you log into the platform against a per-tenant Keycloak realm (e.g.
> `test`, not `ai-trust`) read [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md) **before**
> deploying any SSO app.

---

## First question: does your app have its own login?

This determines which of two paths you'll take:

```
Does your app have its own login / OIDC?
        │
        ├── NO  → Path A: Platform-SSO sidecar
        │           The tool wraps your app. No code changes.
        │           Register with Platform SSO ON, port 8080.
        │
        └── YES → Path B: JWT trust
                    The tool generates a patch for your auth middleware.
                    You apply one small change so the app trusts the platform JWT.
                    Register with Platform SSO OFF, app's own port.
```

Run `prepare-app.sh` — it asks the question interactively, or you can pass `--sso-mode sidecar` / `--sso-mode jwt-trust` to skip the prompt.

---

## The whole flow in one picture

```
  ┌── ON THE APPLICATION (done once, by the app's developer) ─────────────────┐
  │                                                                             │
  │  1. Run the prepare-app script   →  it adds the platform files to your     │
  │     against your app repo            repo (your app code is NOT changed     │
  │                                      in Path A; one function changed in B) │
  │                                                                             │
  │  2. Push to the new branch       →  GitHub Actions builds a container      │
  │     (platform-sso)                   image and publishes it to GHCR        │
  │                                                                             │
  └─────────────────────────────────────────────────────────────────────────┬─┘
                                                                             │
                                                            the published image ref
                                                      ghcr.io/<owner>/<repo>:sso (or :nosso)
                                                                             │
  ┌── ON THE AI TRUST PLATFORM (done by a Platform Administrator) ───────────▼─┐
  │                                                                             │
  │  3. Register the service   →  fill the Marketplace "Add a service" form    │
  │     (Marketplace UI)                                                        │
  │                                                                             │
  │  4. Deploy                 →  the platform pulls the image and runs it     │
  │                                                                             │
  │  5. Enable for a role      →  the app's tile appears for users in that     │
  │                               role, under "Services" in the sidebar        │
  │                                                                             │
  │  6. Use it                 →  users click the tile → already logged in     │
  │                               via the platform → the app opens embedded    │
  │                                                                             │
  └─────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of contents

| Doc | Audience | What it covers |
|-----|----------|----------------|
| [`01-overview.md`](./01-overview.md) | everyone | The mental model, the two paths, plain-language glossary. |
| [`02-application-patch.md`](./02-application-patch.md) | developers | `prepare-app` in detail: Path A (sidecar) and Path B (JWT trust), ports, env, limits. |
| [`03-publish-image.md`](./03-publish-image.md) | developers | Push → GitHub Actions → publish the image to GHCR. |
| [`04-platform-register-and-deploy.md`](./04-platform-register-and-deploy.md) | operators | Register → Deploy → Enable-for-role → Use, and what happens behind the scenes. |
| [`05-multitenant-mesh-notes.md`](./05-multitenant-mesh-notes.md) | operators (advanced) | Running on a multi-tenant mesh deployment — the per-tenant Keycloak realm caveat. |
| [`06-troubleshooting.md`](./06-troubleshooting.md) | everyone | Symptom → cause → fix for the common failures. |
| [`07-prepare-app-script.md`](./07-prepare-app-script.md) | developers | The full `prepare-app.sh` source + all its templates, in one place. |
| [`08-worked-example-weather-app.md`](./08-worked-example-weather-app.md) | everyone | A real, warts-and-all Path B onboarding run: every dead end and the fix that worked. |
| [`Marketplace_Onboarding_Flow.pptx`](./Marketplace_Onboarding_Flow.pptx) | everyone | Slide deck explaining the flow and what's behind the scenes. |

---

## The 6 steps, as a checklist

- [ ] **1. Patch the app** — `marketplace/tools/prepare-app/prepare-app.sh <your-app>` →
      answer the SSO question → commit the generated files. *(→ [`02`](./02-application-patch.md))*
- [ ] **2. Publish** — push the `platform-sso` branch → wait for the green **publish-image** Action →
      confirm `ghcr.io/<owner>/<repo>:sso` (or `:nosso`) exists. *(→ [`03`](./03-publish-image.md))*
- [ ] **3. Register** — Marketplace → *Add a service* → fill the form per the generated
      `ui_deploy_guide.md`. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **4. Deploy** — click Deploy; supply the registry username + `read:packages` token if the image is
      private. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **5. Enable for a role** — pick the role(s) that should see it. *(→ [`04`](./04-platform-register-and-deploy.md))*
- [ ] **6. Use** — the tile appears under **Services**; click → embedded, already logged in.
