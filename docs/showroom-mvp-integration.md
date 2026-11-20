# ApeiroRA Showroom MVP Integration Audit

This document maps every MVP release requirement for the ai-trust-platform as a showroom product in the [ApeiroRA (Apeiro Reference Architecture)](https://apeirora.eu/) EU-funded initiative (IPCEI-CIS, BMWK + EU co-funding). Each requirement links to the upstream ApeiroRA best-practice documentation, reference architecture, or GitHub source that defines it.

---

## Background

**ApeiroRA** is an open, sovereign cloud-edge continuum reference architecture led by SAP under the [NeoNephos](https://neonephos.org/) Linux Foundation Europe project. The ai-trust-platform is a **showroom product** — a live reference application demonstrating ApeiroRA principles on Gardener shoot clusters at:

- Production: `ai-trust-platform-main.ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu`
- Test/PR: `<namespace>.ai-trust-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu`

The EU/BMWK funding acknowledgement appears in `README.md` (funding logo: `https://apeirora.eu/assets/img/BMWK-EU.png`). The platform's tenancy model is explicitly aligned with ApeiroRA ADR-004 (see `docs/adr/adr-001-tenancy.md`).

---

## Requirement 1 — OCM Component Packaging

**Status:** Implemented (`[MVP-off]` items excluded, see below)

Every showroom product must be packaged as an **Open Component Model (OCM)** component — the ApeiroRA-endorsed Software Bill of Delivery (SBoD) mechanism. OCM provides machine-readable component descriptors, digest-pinned integrity, and secure OCI-registry transport.

### What is required
- A component descriptor (`.ocm/component-constructor.yaml`) listing a `helmChart` resource and every `ociImage` resource built by the product.
- Component published to an OCI registry by digest: `ghcr.io/ai-trust-services/ocm//github.com/ai-trust-services/ai-trust-platform`.
- **Strict parity rule:** every image in `docker-bake.hcl` `group "default"` must appear in the OCM descriptor. An image that is listed in OCM but not built causes `ocm add` to fail with `cannot determine digest`, aborting the deploy pipeline. See `CLAUDE.md` → "Deploying to Gardener (OCM + Flux + GitHub Actions)".

### Active (MVP-on) OCM resources
| Resource | Type |
|---|---|
| `ai-trust-platform-chart` | `helmChart` |
| `users-backend` | `ociImage` |
| `ai-system-registry-backend` | `ociImage` |
| `overview-backend` | `ociImage` |
| `compliance-backend` | `ociImage` |
| `embedding-service` | `ociImage` |
| `document-indexing-backend` | `ociImage` |
| `document-indexing-worker` | `ociImage` |
| `openfga-provision` | `ociImage` |
| `db-migrate` | `ociImage` |
| `clickhouse-migrate` | `ociImage` |
| `keycloak-provision` | `ociImage` |
| `minio` | `ociImage` |
| `mc` | `ociImage` |
| `shell` | `ociImage` |
| `ai-system-registry-frontend` | `ociImage` |
| `overview-frontend` | `ociImage` |
| `compliance-frontend` | `ociImage` |
| `users-frontend` | `ociImage` |
| `audit-backend` | `ociImage` |
| `audit-frontend` | `ociImage` |
| `audit-flush-worker` | `ociImage` |
| `admin-backend` | `ociImage` |
| `admin-frontend` | `ociImage` |
| `cognee-eval-backend` | `ociImage` |

### Disabled (`[MVP-off]`) — intentionally excluded from OCM
These are toggled off across `docker-bake.hcl`, `.ocm/component-constructor.yaml`, `shell/nginx.conf`, and `values.yaml`. See `CLAUDE.md` → "MVP scope".

| Resource | Reason |
|---|---|
| `monitoring-backend/frontend` | GenAI-Observability — not built |
| `alerts-backend/frontend` | GenAI-Observability — not built |
| `decision-trace-analyzer-backend/frontend` | GenAI-Observability — not built |
| `policy-checker-worker` | Alerts worker — not built |
| `otel-clickhouse-consumer` | OTLP pipeline — not built |
| `otel-rmq-bridge` | OTLP pipeline — not built |
| `ai-test-bed-backend/frontend` | AI test-bed — not built |

### ApeiroRA references
- **SBoD / OCM best practice:** [`documentation.apeirora.eu/docs/best-practices/lcm/sbod/`](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) — OCM as the Software Bill of Delivery; integrity via digest signing, traceability via unique identifiers, automated GitOps deployment.
- **OCM project:** [`github.com/open-component-model`](https://github.com/open-component-model) — Open Component Model specification and tooling.
- **LCM index:** [`documentation.apeirora.eu/docs/best-practices/lcm/`](https://documentation.apeirora.eu/docs/best-practices/lcm/) — lifecycle management overview including SBoD, Konfidence, and config principles.
- **Local:** `.ocm/component-constructor.yaml`, `k8s/ocm/manifests.yaml`, `k8s/README.md` → "OCM component structure".

---

## Requirement 2 — Gardener + Flux Deployment Pipeline

**Status:** Implemented

ApeiroRA mandates deployment to **Gardener** shoot clusters via **Flux HelmRelease** driven by OCM `ComponentVersion`/`Resource`/`FluxDeployer` CRs. This is the showroom deployment contract.

### What is required
- Build & push all images to `ghcr.io` tagged `<prefix>-<sha>`.
- Build & push Helm chart as OCI artifact to `ghcr.io/ai-trust-services/charts/ai-trust-platform`.
- Publish OCM component referencing images and chart by digest.
- Apply `k8s/ocm/manifests.yaml` CRs (substituting `${OCM_VERSION}` and `${NAMESPACE}`) to the target cluster's `ocm-system` namespace.
- OCM controller reconciles `ComponentVersion` → `Resource` → `FluxDeployer` → Flux `HelmRelease` → `helm upgrade --install` in the target namespace.
- Namespace-scoped deployments: `ai-trust-main` → namespace `ai-trust`; PR/developer → namespace `<github-username>`.

### Pipeline
```
build-push-deploy.yml
  ├─ build & push ~25 Docker images  → ghcr.io/ai-trust-services/ai-trust-platform/<name>:<prefix>-<sha>
  ├─ build & push Helm chart OCI     → ghcr.io/ai-trust-services/charts/ai-trust-platform:0.0.0-<prefix>-<sha>
  ├─ publish OCM component           → ghcr.io/ai-trust-services/ocm (digest-referenced)
  └─ apply-to-cluster composite action
       ├─ bootstrap.sh (namespace + secrets + RBAC)
       └─ kubectl apply k8s/ocm/manifests.yaml (ComponentVersion, Resource, FluxDeployer)
```

### ApeiroRA references
- **OCM controller:** [`github.com/open-component-model/ocm-controller`](https://github.com/open-component-model/ocm-controller) — the in-cluster controller that reconciles `ComponentVersion` and `FluxDeployer` CRs.
- **Flux:** [`fluxcd.io`](https://fluxcd.io) — GitOps-driven HelmRelease reconciliation (source-controller + helm-controller).
- **Gardener:** [`gardener.cloud`](https://gardener.cloud) — the ApeiroRA-endorsed Kubernetes-as-a-Service layer for shoot cluster provisioning.
- **Showroom scenario:** [`documentation.apeirora.eu/docs/showroom/scenarios/simplecluster-sovereign-workloads`](https://documentation.apeirora.eu/docs/showroom/scenarios/simplecluster-sovereign-workloads) — sovereign workload hosting via Gardener, with unified cluster request interface and access management.
- **LCM config principles:** [`documentation.apeirora.eu/docs/best-practices/lcm/config/`](https://documentation.apeirora.eu/docs/best-practices/lcm/config/) — API-first, declarative, reconciling-controller patterns that this pipeline implements.
- **Local:** `k8s/README.md` → "Deploying to a real cluster (Gardener) via OCM + Flux + GitHub Actions", `.github/workflows/build-push-deploy.yml`, `.github/actions/`.

---

## Requirement 3 — Platform Mesh Tenancy Model

**Status:** Implemented (`single` mode); multi-tenant path implemented in operator

The ApeiroRA Platform Mesh account model defines the tenancy contract: **one subscribing Platform Mesh account = one kcp logical-cluster id = one tenant**. The ai-trust-platform must implement this mapping.

### What is required
- `TENANCY_MODE=single` (default) — one organization, no per-tenant isolation. Used for standalone showroom deploy.
- `TENANCY_MODE=jwt` — tenant resolved from `tenant_id` OIDC claim; physical isolation per tenant: schema-per-tenant Postgres, database-per-tenant ClickHouse, bucket-per-tenant MinIO. Required for multi-tenant SaaS via Platform Mesh.
- Tenant context flows: Keycloak JWT → `libs/tenancy` resolver → `ContextVar` → Postgres `SET LOCAL ROLE t_<org>` / ClickHouse per-tenant DB / MinIO prefix.
- Isolation is fail-closed: unverified/forged token → 401, no cross-tenant data access.
- **Multi-tenant operator** (`AI-Trust-Services/ai-trust-platform-operator`): provisions isolated tenants on demand — per-tenant Keycloak realms, Postgres schemas, ClickHouse databases, MinIO buckets.

### Deferred (deployment-layer concerns, tracked separately)
- **Platform Mesh CRD adoption** (APIExport/APIBinding/api-syncagent/ProviderMetadata) — handled by operator/deployment bundle, not the app repo.
- **Per-tenant OpenFGA stores** — authorization currently uses a single shared `platform:global` store; per-tenant stores deferred.
- **Kubernetes-resource-level isolation** (NetworkPolicy, ResourceQuota) — deploy-bundle decision.

### ApeiroRA references
- **Platform Mesh account model:** [`documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model`](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model) — hierarchical account structure where each account is an isolated kcp control plane; the basis for ADR-001.
- **Platform Mesh introduction:** [`documentation.apeirora.eu/docs/best-practices/platform-mesh/`](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/) — design goals, guiding principles, service provider control planes, security.
- **ApeiroRA ADR-004** — referenced in `docs/adr/adr-001-tenancy.md:7`; defines the Platform Mesh tenancy contract that ADR-001 maps this platform to.
- **kcp:** [`github.com/kcp-dev/kcp`](https://github.com/kcp-dev/kcp) — the logical-cluster / control-plane technology underlying Platform Mesh accounts.
- **Operator repo:** [`github.com/AI-Trust-Services/ai-trust-platform-operator`](https://github.com/AI-Trust-Services/ai-trust-platform-operator) — multi-tenant provisioning operator integrating with Platform Mesh.
- **Local:** `docs/adr/adr-001-tenancy.md`, `libs/tenancy/`, `docs/tenancy-model.md`, `CLAUDE.md` → "Tenancy mode".

---

## Requirement 4 — Gardener Single-Host Deploy (Shoot Install)

**Status:** Implemented; documented in `k8s/SHOOT-INSTALL.md`

For the showroom reference deployment, the platform must run on a Gardener shoot cluster behind a single public HTTPS hostname via the shared gateway — the pattern used at the production showroom URL.

### What is required
- Single public host (`APP_PUBLIC_URL`) with TLS via Gardener-managed cert (DNS-01, Let's Encrypt).
- Keycloak path-mounted at `/keycloak` on the same host (avoids a second hostname/cert).
- Gateway API (`HTTPRoute`) routing: `/keycloak` rules → Keycloak directly (bypassing oauth2-proxy); catch-all → oauth2-proxy.
- `render → transform → apply` pipeline (`helm template | python3 transform.py | kubectl apply`) to apply six shoot-specific deltas that cannot be expressed in a values override (image names, node pinning, `PGDATA` subdirectory, Keycloak path, oauth2-proxy args, `storageClassName`).
- DNS via Gardener `dns.gardener.cloud/dnsnames` annotation (do not install cert-manager manually — Gardener manages it).

### ApeiroRA references
- **Showroom cluster:** `*.showroom.apeirora.eu` subdomain on `gardener.cc-one` landscape — the live reference deployment.
- **Gardener shoot clusters:** [`gardener.cloud/docs`](https://gardener.cloud/docs/) — shoot cluster provisioning, DNS, TLS cert automation.
- **Gateway API:** [`gateway-api.sigs.k8s.io`](https://gateway-api.sigs.k8s.io/) — the Kubernetes Gateway API used for traffic routing in the showroom clusters.
- **Showroom scenarios:** [`documentation.apeirora.eu/docs/showroom/scenarios/`](https://documentation.apeirora.eu/docs/showroom/scenarios/) — sovereign workload hosting scenario, covering pre-deployment agreements, cluster provisioning, and access management.
- **Local:** `k8s/SHOOT-INSTALL.md`, `k8s/gardener_init/shoot-cluster-init.sh`, `k8s/gardener_init/garden-cluster-init.sh`.

---

## Requirement 5 — Software Bill of Delivery (SBoD) / OCM Integrity

**Status:** Implemented (digest-pinned OCI references; signing not yet configured)

ApeiroRA treats OCM as the **Software Bill of Delivery** — a superset of SBoM that provides integrity, provenance, traceability, and secure transport across public cloud, on-premise, and air-gapped environments.

### What is required
- All component resources referenced **by digest** (not mutable tag) in the published OCM component — `ocm add componentversion` resolves digests at publish time.
- OCM component version acts as a unique correlation ID across the lifecycle (`0.0.0-<namespace>-<sha>`).
- Secure OCI transport to `ghcr.io` (HTTPS, authenticated push/pull).
- Component descriptor is machine-readable and technology-agnostic (YAML, standard OCM schema).
- Routing-slip / traceability: each deploy version ties exactly one `<prefix>-<sha>` to its namespace, cluster, and Flux reconciliation state.

### Not yet implemented
- **OCM component signing** (cosign/notary) — the descriptor is published but not cryptographically signed. Required for full SBoD integrity guarantee per ApeiroRA best practices.

### ApeiroRA references
- **SBoD documentation:** [`documentation.apeirora.eu/docs/best-practices/lcm/sbod/`](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) — OCM as SBoD; integrity via signing, traceability via unique identifiers, air-gapped transport, automated deployment.
- **OCM specification:** [`github.com/open-component-model/ocm-spec`](https://github.com/open-component-model/ocm-spec) — the OCM specification defining component descriptors, resource types, and access methods.
- **OCM CLI:** [`github.com/open-component-model/ocm`](https://github.com/open-component-model/ocm) — tooling used in CI (`ocm add componentversion`, `ocm get componentversions`).
- **Local:** `.ocm/component-constructor.yaml`, `k8s/README.md` → "OCM component structure", `.github/actions/publish-ocm/`.

---

## Requirement 6 — Authorization via OpenFGA

**Status:** Implemented

ApeiroRA's core stack includes **OpenFGA** as the authorization layer. The platform must use OpenFGA for all application-level access control, keeping it strictly separate from authentication (Keycloak).

### What is required
- OpenFGA is the **sole source of truth for roles and permissions** (`libs/authorization`).
- Flat RBAC model: users → roles → permissions on `platform:global` object.
- `require_permission("resource:action")` as a `Depends()` — fails closed (403 on denial or error).
- Authorization model generated from `constants.py` and uploaded by `openfga-provision` at startup — no hand-edited FGA schema files.
- Hard separation: Keycloak = authentication only; OpenFGA = authorization only. Never use Keycloak realm roles to gate application features.

### ApeiroRA references
- **OpenFGA:** [`openfga.dev`](https://openfga.dev) / [`github.com/openfga/openfga`](https://github.com/openfga/openfga) — the authorization engine used across ApeiroRA showroom products.
- **Platform Mesh security:** [`documentation.apeirora.eu/docs/best-practices/platform-mesh/security`](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/security) — security principles including identity separation.
- **ApeiroRA security best practices:** [`documentation.apeirora.eu/docs/best-practices/security/`](https://documentation.apeirora.eu/docs/best-practices/security/) — 9 subsections covering principles through emerging threats.
- **Local:** `libs/authorization/`, `CLAUDE.md` → "Authorization — RBAC via OpenFGA", `docs/auth-flow.md`.

---

## Requirement 7 — Authentication via Keycloak + oauth2-proxy

**Status:** Implemented

ApeiroRA showroom products use **Keycloak** as the identity provider and **oauth2-proxy** as the ingress authentication gateway.

### What is required
- All traffic enters through oauth2-proxy (port 8080 locally, shared gateway on shoot).
- No session → redirect to Keycloak login → JWT stored in encrypted cookie → `Authorization: Bearer <JWT>` forwarded to backends.
- oauth2-proxy forwards `X-Forwarded-Preferred-Username` (used by all backends for identity).
- Keycloak idempotent provisioning via `keycloak-provision` Job (realm, OIDC client, bootstrap admin).
- On shoot clusters: Keycloak path-mounted at `/keycloak` on the app host (see Requirement 4).

### ApeiroRA references
- **Keycloak:** [`keycloak.org`](https://keycloak.org) — the identity provider used across ApeiroRA products.
- **oauth2-proxy:** [`github.com/oauth2-proxy/oauth2-proxy`](https://github.com/oauth2-proxy/oauth2-proxy) — the authentication reverse proxy used in ApeiroRA showroom deployments.
- **Platform Mesh user-facing control plane:** [`documentation.apeirora.eu/docs/best-practices/platform-mesh/user-facing-control-plane`](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/user-facing-control-plane) — identity and access management patterns.
- **Local:** `CLAUDE.md` → "Authentication (Keycloak + oauth2-proxy)", `docs/auth-flow.md`, `infra/keycloak/`, `k8s/helm/ai-trust-platform/templates/`.

---

## Requirement 8 — Micro-Frontend Shell (OpenMFP pattern)

**Status:** Implemented (Luigi-based, aligned with OpenMFP pattern)

ApeiroRA recommends **OpenMFP** (Open Micro-Frontend Platform) for composable UI applications. The ai-trust-platform uses **Luigi** (the upstream project that OpenMFP is based on) for micro-frontend composition.

### What is required
- A shell (`shell/`) serving Luigi configuration and acting as an nginx reverse proxy for all MFE and backend traffic.
- Each MFE is an independently built and deployed iframe-embedded React application (`HashRouter`, `addInitListener` Luigi handshake).
- MFEs embedded via Luigi nav configuration in `shell/public/luigi-config.js`.
- nginx headers `X-Frame-Options: ALLOWALL` + `Content-Security-Policy: frame-ancestors *` required for iframe embedding.
- Base path set in `vite.config.ts` (`base: "/registry/"` etc.) for correct asset resolution under the shell sub-path.

### ApeiroRA references
- **Micro-frontends with OpenMFP:** [`documentation.apeirora.eu/docs/best-practices/micro-frontends/`](https://documentation.apeirora.eu/docs/best-practices/micro-frontends/) — micro-frontend composition patterns used in ApeiroRA products.
- **OpenMFP:** [`github.com/openmfp`](https://github.com/openmfp) — the ApeiroRA micro-frontend platform built on Luigi.
- **Luigi project:** [`github.com/SAP/luigi`](https://github.com/SAP/luigi) — the micro-frontend framework used by this platform.
- **Local:** `shell/`, `shell/public/luigi-config.js`, `CLAUDE.md` → "Shell", "Frontend stacks".

---

## Requirement 9 — CI Quality Gates

**Status:** Implemented

ApeiroRA showroom products are expected to maintain automated quality gates as a condition of showroom participation. These gates run on every PR.

### Required PR gates
| Workflow | What it checks | Gate |
|---|---|---|
| `microservice-e2e-tests.yml` | All 12 backend e2e suites (real Postgres + ClickHouse, mocked OpenFGA/MinIO) | PR gate |
| `pr-unit-tests.yml` | All 14 unit test suites (no Docker, matrix parallel) | PR gate |
| `pr-lint.yml` | `ruff check .` + `ruff format --check .` across all Python | PR gate |
| `pr-typecheck.yml` | `tsc --noEmit` on all 8 TypeScript frontends | PR gate |

### Post-deploy gates (not PR-blocking, but required after deploy)
| Workflow | What it checks |
|---|---|
| `integration-tests.yml` | Cross-service API contracts against live cluster |
| `e2e-system-tests.yml` | Black-box OIDC E2E via real Keycloak session |
| `playwright-frontend-tests.yml` | Browser smoke + registration flow |
| `langfuse-benchmark.yml` | LLM quality: 339 ground-truth scenarios scored and pushed to Langfuse |

### ApeiroRA references
- **LCM / Konfidence delivery workflow:** [`documentation.apeirora.eu/docs/best-practices/lcm/konfidence/`](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) — stage-based delivery (DEV → TEST → PROD), immutable vectors, automated governance. Quality gates are the CI expression of the stage promotion requirement.
- **Konfidence core concepts:** [`documentation.apeirora.eu/docs/best-practices/lcm/konfidence/core-concepts`](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/core-concepts) — Artifact → Vector → Stage → Landscape model; stages function as quality assurance gates before promotion.
- **Local:** `.github/workflows/`, `CLAUDE.md` → "Run tests", `docs/tests.md`.

---

## Requirement 10 — REUSE / Licensing Compliance

**Status:** Implemented

ApeiroRA showroom products require **REUSE** compliance (FSFE REUSE specification) for open-source licensing. This is consistent with the Linux Foundation Europe / NeoNephos project governance expectations.

### What is required
- `REUSE.toml` or per-file SPDX headers covering all files.
- Apache 2.0 license (`LICENSE` file at repo root).
- REUSE status badge in `README.md` linking to `api.reuse.software/info/github.com/AI-Trust-Services/ai-trust-platform`.
- Conventional Commits for version traceability (consistent with the showroom MSP repositories).

### ApeiroRA references
- **REUSE specification:** [`reuse.software`](https://reuse.software) — FSFE REUSE spec for machine-readable copyright and licensing, required by ApeiroRA showroom MSP repositories (see [`github.com/apeirora/showroom-msp-simple-cluster`](https://github.com/apeirora/showroom-msp-simple-cluster) README).
- **NeoNephos / Linux Foundation Europe governance:** [`neonephos.org`](https://neonephos.org) — project governance for ApeiroRA flagship open-source components.
- **Local:** `REUSE.toml`, `LICENSE`, `README.md:13` (REUSE badge).

---

## Requirement 11 — Observability (Recommended, partially MVP-off)

**Status:** Infrastructure present (ClickHouse, audit trail); GenAI-Observability stack MVP-off

ApeiroRA recommends logging, monitoring, and observability infrastructure for all showroom products.

### What is implemented
- **Audit trail** (MVP-on): all platform actions buffered in Postgres → archived to ClickHouse via `audit-flush-worker`. Immutable audit log queryable via `audit-backend`.
- **ClickHouse** (MVP-on): deployed unconditionally; used by audit and ready for GenAI-Observability stack when re-enabled.
- **OpenTelemetry** (MVP-off): `otel-collector`, `otel-rmq-bridge`, `otel-clickhouse-consumer` are commented out (`[MVP-off]`). The pipeline exists and can be re-enabled without code changes.
- **Langfuse** (enabled in showroom): LLM trace quality scoring runs against each deployed namespace (`langfuse.ai-trust-test.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu`).

### Not yet implemented for MVP
- Metrics / alerting on platform infrastructure (no HPA, no resource limits/requests).
- GenAI observability (monitoring, alerts, decision-trace-analyzer) are MVP-off.

### ApeiroRA references
- **Observability best practices:** [`documentation.apeirora.eu/docs/best-practices/observability/`](https://documentation.apeirora.eu/docs/best-practices/observability/) — observability requirements for ApeiroRA products.
- **OpenTelemetry demo (ApeiroRA fork):** [`github.com/apeirora/opentelemetry-demo`](https://github.com/apeirora/opentelemetry-demo) — reference OTLP pipeline used in the showroom.
- **audit-log-poc-for-otel:** [`github.com/apeirora/audit-log-poc-for-otel`](https://github.com/apeirora/audit-log-poc-for-otel) — ApeiroRA audit log proof-of-concept via OpenTelemetry.
- **Local:** `audit/`, `otel-pipeline/`, `CLAUDE.md` → "MVP scope — disabling services without removing code", `otel-pipeline/CLAUDE.md`.

---

## Requirement 12 — Konfidence / Immutable Delivery Vectors (Gap)

**Status:** Partially aligned; not yet fully implemented

ApeiroRA's **Konfidence** framework specifies an immutable application vector delivery model: Artifact → Vector → Vector Deployment → Stage promotion (DEV → TEST → PROD) with automated governance and cleanup.

### Current state
The platform uses a simplified SHA-tagged OCM versioning scheme (`0.0.0-<namespace>-<sha>`) that provides immutability and traceability per deploy, but does not implement the full Konfidence vector/landscape model.

### Gap vs Konfidence requirements
| Konfidence concept | ai-trust-platform current state |
|---|---|
| **Artifact** (versioned build reference) | Implemented — each image pushed with `<prefix>-<sha>` tag, referenced by digest in OCM |
| **Vector** (immutable complete application state) | Partial — OCM component version acts as a vector, but not managed via Konfidence tooling |
| **Stage** (DEV → TEST → PROD promotion gates) | Partial — `ai-trust-test` → `ai-trust-main` is a manual promotion; no automated stage gate |
| **Landscape** (multi-stage deployment view) | Not implemented |
| **Automated vector cleanup** | Not implemented |
| **Feature toggles / ring deployments** | Not implemented (MVP-on/off is a build-time toggle, not a runtime feature flag) |

### ApeiroRA references
- **Konfidence overview:** [`documentation.apeirora.eu/docs/best-practices/lcm/konfidence/`](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) — comprehensive software delivery framework for microservice-based SaaS; immutable vectors, stage-based flows, automated governance.
- **Konfidence core concepts:** [`documentation.apeirora.eu/docs/best-practices/lcm/konfidence/core-concepts`](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/core-concepts) — Artifact, Vector, Vector Deployment, Stage, Landscape definitions.
- **Konfidence project:** [`konfidence.cloud`](https://konfidence.cloud) — the upstream Konfidence project.
- **Local:** `k8s/README.md` → "Version isolation between namespaces and clusters", `.github/workflows/build-push-deploy.yml`.

---

## Requirement 13 — Operator-Based LCM (Gap)

**Status:** Partial — operator exists but not all LCM aspects are shifted into it

ApeiroRA's LCM config best practices recommend treating lifecycle management as product code via **product-specific Kubernetes operators** (API-first, declarative, reconciling-controller pattern).

### Current state
- `ai-trust-platform-operator` ([`github.com/AI-Trust-Services/ai-trust-platform-operator`](https://github.com/AI-Trust-Services/ai-trust-platform-operator)) handles multi-tenant provisioning.
- Helm chart + initContainers handle startup ordering (wait-for-service, wait-for-job patterns).
- One-shot Jobs handle schema migrations, keycloak provisioning, OpenFGA provisioning.
- The app repo itself uses `Deployment`/`StatefulSet` resources; it does not yet have an operator managing its own lifecycle (upgrades, rollbacks, schema drift detection).

### Gap
- No application-level operator managing the platform's own reconciliation loop (upgrade readiness checks, schema migration gating, automatic rollback on health check failure).
- The ApeiroRA docs note: "not all Apeiro components have adopted operator-based installation and update procedures yet" — this platform is in that category.

### ApeiroRA references
- **LCM config / operator principles:** [`documentation.apeirora.eu/docs/best-practices/lcm/config/`](https://documentation.apeirora.eu/docs/best-practices/lcm/config/) — API-first, declarative, reconciling-controller, data-and-metadata-in-data-plane design principles.
- **Controller pattern:** [`documentation.apeirora.eu/docs/best-practices/digital-twins/controller-pattern/`](https://documentation.apeirora.eu/docs/best-practices/digital-twins/controller-pattern/) — the reconciling-controller pattern used by ApeiroRA operators.
- **Operator repo:** [`github.com/AI-Trust-Services/ai-trust-platform-operator`](https://github.com/AI-Trust-Services/ai-trust-platform-operator) — the multi-tenant provisioning operator (alpha).
- **showroom-msp-simple-cluster:** [`github.com/apeirora/showroom-msp-simple-cluster`](https://github.com/apeirora/showroom-msp-simple-cluster) — reference implementation of an ApeiroRA operator (CRDs, reconciler, provider contract, kubeconfig lifecycle).
- **Local:** `k8s/helm/ai-trust-platform/templates/_helpers.tpl` (wait-for patterns), `k8s/README.md` → "Per-revision Job names".

---

## Summary Table

| # | Requirement | Status | ApeiroRA Reference |
|---|---|---|---|
| 1 | OCM component packaging | ✅ Implemented | [SBoD/OCM docs](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) |
| 2 | Gardener + Flux deploy pipeline | ✅ Implemented | [Showroom scenarios](https://documentation.apeirora.eu/docs/showroom/scenarios/) |
| 3 | Platform Mesh tenancy model | ✅ App; partial operator | [Platform Mesh account model](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model) |
| 4 | Gardener single-host shoot install | ✅ Implemented | `k8s/SHOOT-INSTALL.md` |
| 5 | SBoD / OCM integrity (digest-pinned) | ✅ Implemented; signing gap | [SBoD docs](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) |
| 6 | Authorization via OpenFGA | ✅ Implemented | [openfga.dev](https://openfga.dev) |
| 7 | Authentication via Keycloak + oauth2-proxy | ✅ Implemented | [Platform Mesh security](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/security) |
| 8 | Micro-frontend shell (Luigi/OpenMFP) | ✅ Implemented | [Micro-frontends docs](https://documentation.apeirora.eu/docs/best-practices/micro-frontends/) |
| 9 | CI quality gates | ✅ Implemented | [Konfidence](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) |
| 10 | REUSE / licensing compliance | ✅ Implemented | [reuse.software](https://reuse.software) |
| 11 | Observability | ⚠️ Partial (GenAI stack MVP-off) | [Observability docs](https://documentation.apeirora.eu/docs/best-practices/observability/) |
| 12 | Konfidence / immutable vectors | ⚠️ Partial (SHA-tagged OCM, no full Konfidence) | [Konfidence](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) |
| 13 | Operator-based LCM | ⚠️ Partial (operator exists, not all LCM shifted) | [LCM config](https://documentation.apeirora.eu/docs/best-practices/lcm/config/) |
