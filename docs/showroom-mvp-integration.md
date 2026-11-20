# ApeiroRA Showroom MVP Integration Audit

Maps each MVP release requirement for the ai-trust-platform as a showroom product in the [ApeiroRA (Apeiro Reference Architecture)](https://apeirora.eu/) EU initiative (IPCEI-CIS, BMWK + EU co-funding; governance under [NeoNephos](https://neonephos.org/) / Linux Foundation Europe). Each requirement links the upstream ApeiroRA best-practice doc or GitHub source that defines it.

The platform runs as a live showroom reference app on Gardener shoot clusters: production `ai-trust-platform-main.ai-trust-1.ai-trust.shoot.gardener.cc-one.showroom.apeirora.eu`, test/PR `<namespace>.ai-trust-test…`. EU/BMWK funding is acknowledged in `README.md`.

## Summary

| # | Requirement | Status | ApeiroRA reference |
|---|---|---|---|
| 1 | OCM component packaging | ⚠️ **Partial** — 11 service images not in OCM | [SBoD / OCM](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) |
| 2 | Gardener + Flux deploy pipeline | ✅ Implemented | [Showroom scenarios](https://documentation.apeirora.eu/docs/showroom/scenarios) |
| 3 | Platform Mesh tenancy model | ✅ App; partial operator | [Account model](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model) |
| 4 | Gardener single-host shoot install | ✅ Implemented | [Showroom scenarios](https://documentation.apeirora.eu/docs/showroom/scenarios) |
| 5 | SBoD / OCM integrity (digest-pinned) | ⚠️ Partial — signing gap | [SBoD / OCM](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) |
| 6 | Authorization via OpenFGA | ✅ Implemented | [Security](https://documentation.apeirora.eu/docs/best-practices/security/) |
| 7 | Authentication via Keycloak + oauth2-proxy | ✅ Implemented | [Security](https://documentation.apeirora.eu/docs/best-practices/security/) |
| 8 | Micro-frontend shell (Luigi / OpenMFP) | ✅ Implemented | [Micro-frontends w/ OpenMFP](https://documentation.apeirora.eu/docs/best-practices/micro-frontends/openmfp) |
| 9 | CI quality gates | ✅ Implemented | [Konfidence](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) |
| 10 | REUSE / licensing compliance | ✅ Implemented | [reuse.software](https://reuse.software) |
| 11 | Observability | ⚠️ Partial — GenAI stack MVP-off | [Observability](https://documentation.apeirora.eu/docs/best-practices/observability/) |
| 12 | Konfidence / immutable vectors | ⚠️ Partial — SHA-tagged OCM only | [Konfidence](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) |
| 13 | Operator-based LCM | ⚠️ Partial — operator exists | [LCM config](https://documentation.apeirora.eu/docs/best-practices/lcm/config/) |

> **ADR note:** `docs/adr/adr-001-tenancy.md` cites "ApeiroRA ADR-004". No upstream ApeiroRA ADR-004 about tenancy exists — Platform Mesh ADRs live at [`platform-mesh/architecture/adr`](https://github.com/platform-mesh/architecture/tree/main/adr) where ADR-004 is "Shared CI Workflow Strategy" (unrelated). The account model is documented at [`apeirora/documentation` account-model.md](https://github.com/apeirora/documentation/blob/main/docs/best-practices/platform-mesh/account-model.md), with a proposed ADR at [`platform-mesh/platform-mesh` adr-01-account-model.md](https://github.com/platform-mesh/platform-mesh/blob/main/contrib/adr/adr-01-account-model.md). The ADR-001 cross-reference should be corrected accordingly.

---

## 1 — OCM Component Packaging · ⚠️ Partial

**Reference:** [SBoD / OCM best practice](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) · [open-component-model](https://github.com/open-component-model)

Every showroom product must be packaged as an **Open Component Model (OCM)** component (`.ocm/component-constructor.yaml`) — one `helmChart` resource plus every built `ociImage`, published to an OCI registry by digest. Strict parity: every image in `docker-bake.hcl` `group "default"` must appear in OCM, and vice versa — a listed-but-unbuilt image aborts `ocm add` with `cannot determine digest`.

**Why partial:** 24 MVP images are in OCM and match the bake list exactly. But **11 service images that exist in the repo are deliberately excluded** (`[MVP-off]`, commented out across `docker-bake.hcl`, `.ocm/component-constructor.yaml`, `shell/nginx.conf`, `values.yaml`): `monitoring-{backend,frontend}`, `alerts-{backend,frontend}`, `decision-trace-analyzer-{backend,frontend}`, `policy-checker-worker`, `otel-rmq-bridge`, `otel-clickhouse-consumer`, `ai-test-bed-{backend,frontend}` — plus the `cognee-eval/graph-image` data artifact (built only by `promote-graph.yml`). So OCM packaging is complete *within the reduced MVP scope* but not for the whole platform.

**Local:** `.ocm/component-constructor.yaml`, `k8s/ocm/manifests.yaml`, `CLAUDE.md` → "MVP scope".

## 2 — Gardener + Flux Deployment Pipeline · ✅ Implemented

**Reference:** [Showroom scenario — sovereign workload hosting](https://documentation.apeirora.eu/docs/showroom/scenarios/simplecluster-sovereign-workloads) · [ocm-controller](https://github.com/open-component-model/ocm-controller) · [fluxcd.io](https://fluxcd.io) · [gardener.cloud](https://gardener.cloud)

`build-push-deploy.yml` builds/pushes images + Helm chart (OCI) to `ghcr.io`, publishes a digest-referenced OCM component, then applies `k8s/ocm/manifests.yaml` CRs. The OCM controller reconciles `ComponentVersion → Resource → FluxDeployer → Flux HelmRelease → helm upgrade --install`. Namespace-scoped: `ai-trust-main` → `ai-trust`; PR/developer → `<github-username>`.

**Local:** `k8s/README.md`, `.github/workflows/build-push-deploy.yml`, `.github/actions/`.

## 3 — Platform Mesh Tenancy Model · ✅ App; partial operator

**Reference:** [Platform Mesh account model](https://documentation.apeirora.eu/docs/best-practices/platform-mesh/account-model) · [kcp-dev/kcp](https://github.com/kcp-dev/kcp) · [ai-trust-platform-operator](https://github.com/AI-Trust-Services/ai-trust-platform-operator)

`TENANCY_MODE=single` (default) runs one organization; `jwt` resolves the tenant from the `tenant_id` OIDC claim and gives physical isolation (schema-per-tenant Postgres, DB-per-tenant ClickHouse, bucket-per-tenant MinIO), fail-closed on forged tokens. The separate multi-tenant operator provisions isolated tenants on demand. **Deferred:** Platform Mesh CRDs (APIExport/APIBinding), per-tenant OpenFGA stores, K8s-resource-level isolation — all deploy-bundle concerns, not the app repo.

**Local:** `docs/adr/adr-001-tenancy.md`, `libs/tenancy/`, `CLAUDE.md` → "Tenancy mode".

## 4 — Gardener Single-Host Shoot Install · ✅ Implemented

**Reference:** [Showroom scenario — sovereign workload hosting](https://documentation.apeirora.eu/docs/showroom/scenarios/simplecluster-sovereign-workloads) · [gardener.cloud/docs](https://gardener.cloud/docs/) · [gateway-api.sigs.k8s.io](https://gateway-api.sigs.k8s.io/)

The platform runs behind one public HTTPS host via the shared gateway, with Keycloak path-mounted at `/keycloak` on the same host. A `render → transform → apply` pipeline (`helm template | python3 transform.py | kubectl apply`) applies six shoot deltas a values override cannot express (image names, node pinning, `PGDATA` subdir, Keycloak path, oauth2-proxy args, `storageClassName`). DNS/TLS managed by Gardener (never install cert-manager manually).

**Local:** `k8s/SHOOT-INSTALL.md`, `k8s/gardener_init/shoot-cluster-init.sh`.

## 5 — SBoD / OCM Integrity · ⚠️ Partial (signing gap)

**Reference:** [SBoD / OCM](https://documentation.apeirora.eu/docs/best-practices/lcm/sbod/) · [ocm-spec](https://github.com/open-component-model/ocm-spec) · [ocm CLI](https://github.com/open-component-model/ocm)

All component resources are referenced **by digest** (not mutable tag); the OCM component version (`0.0.0-<namespace>-<sha>`) is a unique correlation ID, pushed over authenticated HTTPS to `ghcr.io`, with a machine-readable technology-agnostic descriptor. **Gap:** OCM component **signing** (cosign/notary) is not configured — required for the full SBoD integrity guarantee.

**Local:** `.ocm/component-constructor.yaml`, `.github/actions/publish-ocm/`.

## 6 — Authorization via OpenFGA · ✅ Implemented

**Reference:** [ApeiroRA security best practices](https://documentation.apeirora.eu/docs/best-practices/security/) · [openfga.dev](https://openfga.dev) · [openfga/openfga](https://github.com/openfga/openfga)

OpenFGA is the sole source of truth for roles/permissions (`libs/authorization`): flat RBAC (users → roles → permissions on `platform:global`), `require_permission("resource:action")` as a fail-closed `Depends()`, model generated from `constants.py` and uploaded by `openfga-provision`. Hard separation from authentication — Keycloak realm roles never gate app features.

**Local:** `libs/authorization/`, `docs/auth-flow.md`, `CLAUDE.md` → "Authorization — RBAC via OpenFGA".

## 7 — Authentication via Keycloak + oauth2-proxy · ✅ Implemented

**Reference:** [ApeiroRA security best practices](https://documentation.apeirora.eu/docs/best-practices/security/) · [keycloak.org](https://keycloak.org) · [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy)

All traffic enters through oauth2-proxy → Keycloak login → JWT in encrypted cookie → `Authorization: Bearer` + `X-Forwarded-Preferred-Username` forwarded to backends. Idempotent `keycloak-provision` Job seeds realm, OIDC client, bootstrap admin. On shoot clusters Keycloak is path-mounted at `/keycloak` (see #4).

**Local:** `infra/keycloak/`, `docs/auth-flow.md`, `CLAUDE.md` → "Authentication".

## 8 — Micro-Frontend Shell (OpenMFP pattern) · ✅ Implemented

**Reference:** [Micro-frontends with OpenMFP](https://documentation.apeirora.eu/docs/best-practices/micro-frontends/openmfp) · [openmfp](https://github.com/openmfp) · [SAP/luigi](https://github.com/SAP/luigi)

A `shell/` serves Luigi config and reverse-proxies all MFE/backend traffic; each MFE is an independently built iframe-embedded React app (`HashRouter`, Luigi `addInitListener`), composed via `shell/public/luigi-config.js`. Requires `X-Frame-Options: ALLOWALL` + `Content-Security-Policy: frame-ancestors *` and a `base` path per MFE in `vite.config.ts`. Luigi is the upstream project OpenMFP builds on.

**Local:** `shell/`, `CLAUDE.md` → "Shell", "Frontend stacks".

## 9 — CI Quality Gates · ✅ Implemented

**Reference:** [Konfidence](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) — stage promotion (DEV → TEST → PROD); CI gates are its per-PR expression.

**PR gates:** `microservice-e2e-tests.yml` (12 backend e2e suites), `pr-unit-tests.yml` (14 unit suites), `pr-lint.yml` (ruff check + format), `pr-typecheck.yml` (tsc on 8 frontends). **Post-deploy (non-blocking):** `integration-tests.yml`, `e2e-system-tests.yml`, `playwright-frontend-tests.yml`, `langfuse-benchmark.yml` (339 ground-truth scenarios).

**Local:** `.github/workflows/`, `docs/tests.md`.

## 10 — REUSE / Licensing Compliance · ✅ Implemented

**Reference:** [reuse.software](https://reuse.software) · [apeirora/showroom-msp-simple-cluster](https://github.com/apeirora/showroom-msp-simple-cluster) · [neonephos.org](https://neonephos.org)

Per-file SPDX / `REUSE.toml` coverage, Apache 2.0 `LICENSE`, REUSE status badge in `README.md`, Conventional Commits — consistent with Linux Foundation Europe / NeoNephos governance for ApeiroRA showroom repos.

**Local:** `REUSE.toml`, `LICENSE`, `README.md` (REUSE badge).

## 11 — Observability · ⚠️ Partial (GenAI stack MVP-off)

**Reference:** [Observability best practices](https://documentation.apeirora.eu/docs/best-practices/observability/) · [apeirora/opentelemetry-demo](https://github.com/apeirora/opentelemetry-demo) · [apeirora/audit-log-poc-for-otel](https://github.com/apeirora/audit-log-poc-for-otel)

**Present:** immutable audit trail (Postgres → ClickHouse via `audit-flush-worker`, queryable via `audit-backend`); ClickHouse deployed unconditionally; Langfuse LLM-trace scoring per deployed namespace. **MVP-off:** OpenTelemetry pipeline (`otel-collector`, `otel-rmq-bridge`, `otel-clickhouse-consumer`) and the GenAI-observability stack (monitoring, alerts, DTA) — re-enablable with no code change. No HPA / resource limits yet.

**Local:** `audit/`, `otel-pipeline/`, `CLAUDE.md` → "MVP scope".

## 12 — Konfidence / Immutable Delivery Vectors · ⚠️ Partial

**Reference:** [Konfidence overview](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/) · [Konfidence core concepts](https://documentation.apeirora.eu/docs/best-practices/lcm/konfidence/core-concepts) · [konfidence.cloud](https://konfidence.cloud)

Konfidence specifies Artifact → Vector → Stage → Landscape immutable delivery. The platform uses a simplified SHA-tagged OCM scheme (`0.0.0-<namespace>-<sha>`): **Artifact** ✅ (digest-pinned images), **Vector** partial (OCM version acts as one, not managed by Konfidence tooling), **Stage** partial (`ai-trust-test` → `ai-trust-main` is manual, no automated gate), **Landscape** / automated cleanup / feature toggles ❌.

**Local:** `k8s/README.md` → "Version isolation", `.github/workflows/build-push-deploy.yml`.

## 13 — Operator-Based LCM · ⚠️ Partial

**Reference:** [LCM config / operator principles](https://documentation.apeirora.eu/docs/best-practices/lcm/config/) · [Controller pattern](https://documentation.apeirora.eu/docs/best-practices/digital-twins/controller) · [ai-trust-platform-operator](https://github.com/AI-Trust-Services/ai-trust-platform-operator) · [apeirora/showroom-msp-simple-cluster](https://github.com/apeirora/showroom-msp-simple-cluster)

`ai-trust-platform-operator` handles multi-tenant provisioning; Helm initContainers + one-shot Jobs handle startup ordering and migrations. **Gap:** no application-level operator managing the platform's own reconciliation loop (upgrade readiness, migration gating, automatic rollback). Per ApeiroRA docs, "not all Apeiro components have adopted operator-based installation yet" — this platform is in that category.

**Local:** `k8s/helm/ai-trust-platform/templates/_helpers.tpl`, `k8s/README.md` → "Per-revision Job names".
